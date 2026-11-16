
"""Background worker for processing uploaded research papers."""

import logging
import os
import tempfile
import threading
import time

from database.ingestion_jobs import (
    get_next_ingestion_job,
    update_ingestion_job,
    update_ingestion_job_heartbeat,
    complete_ingestion_job,
    fail_ingestion_job,
)
from database.supabase_client import get_admin_supabase_client
from Graph_Rag.ingestion import process_paper


HEARTBEAT_INTERVAL = 10
MAX_ATTEMPTS = 3
IDLE_WAIT = 2

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)


def send_heartbeats(job_id, claim_token, stop_event, ownership_lost):
    """Keep the processing job alive while the paper is being processed."""

    while not stop_event.wait(HEARTBEAT_INTERVAL):
        try:
            updated = update_ingestion_job_heartbeat(
                job_id,
                claim_token,
            )

            if not updated:
                logger.error("Worker lost ownership of job %s.", job_id)
                ownership_lost.set()
                return

        except Exception:
            logger.exception("Heartbeat failed for job %s. Will retry.", job_id)


def process_job(job):
    job_id = job["id"]
    paper_id = job["paper_id"]
    user_id = job["user_id"]
    claim_token = job["claim_token"]
    attempts = job["attempts"]

    temp_pdf_path = None
    stop_event = threading.Event()
    ownership_lost = threading.Event()
    heartbeat_thread = None

    try:
        if not claim_token:
            raise ValueError("Claim token is missing.")

        client = get_admin_supabase_client()

        # Start heartbeat while downloading and processing.
        heartbeat_thread = threading.Thread(
            target=send_heartbeats,
            args=(job_id, claim_token, stop_event, ownership_lost),
            daemon=True,
        )
        heartbeat_thread.start()

        # Retrieve the paper belonging to this user.
        response = (
            client.table("papers")
            .select("storage_path")
            .eq("paper_id", paper_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )

        paper = response.data

        if not paper:
            raise ValueError("Paper not found for this user.")

        # Download the PDF from private Supabase Storage.
        pdf_data = (
            client.storage
            .from_("papers")
            .download(paper["storage_path"])
        )

        # Save temporarily for the Graph RAG pipeline.
        with tempfile.NamedTemporaryFile(
            suffix=".pdf",
            delete=False,
        ) as temp_file:
            temp_file.write(pdf_data)
            temp_pdf_path = temp_file.name

        # Process vectors and graph for this user and paper.
        result = process_paper(
            temp_pdf_path,
            paper_id,
            user_id,
        )

        if not result.get("graph_complete", False):
            raise RuntimeError("Graph extraction is incomplete.")

        # Stop heartbeat before finalizing.
        stop_event.set()
        heartbeat_thread.join()

        if ownership_lost.is_set():
            logger.warning("Skipping finalization of reclaimed job %s.", job_id)
            return

        # Complete the job and mark the paper ready atomically.
        updated = complete_ingestion_job(job_id, claim_token)

        if not updated:
            logger.warning(
                "Could not complete job %s because ownership was lost.",
                job_id,
            )
            return

        logger.info("Paper %s processed successfully.", paper_id)

    except Exception as error:
        logger.exception("Processing failed for paper %s.", paper_id)

        stop_event.set()

        if heartbeat_thread:
            heartbeat_thread.join()

        if ownership_lost.is_set():
            logger.warning("Skipping failure update for reclaimed job %s.", job_id)
            return

        try:
            if attempts < MAX_ATTEMPTS:
                # Queue the job for another attempt.
                updated = update_ingestion_job(
                    job_id,
                    claim_token,
                    "queued",
                    str(error),
                )

                if updated:
                    logger.warning(
                        "Job %s queued for retry (%s/%s).",
                        job_id,
                        attempts,
                        MAX_ATTEMPTS,
                    )
                else:
                    logger.warning("Could not requeue job %s.", job_id)

            else:
                # Fail the job and paper atomically.
                updated = fail_ingestion_job(
                    job_id,
                    claim_token,
                    str(error),
                )

                if updated:
                    logger.error(
                        "Paper %s failed after %s attempts.",
                        paper_id,
                        attempts,
                    )
                else:
                    logger.warning(
                        "Could not fail job %s because ownership was lost.",
                        job_id,
                    )

        except Exception:
            logger.exception("Could not update failure status for job %s.", job_id)

    finally:
        stop_event.set()

        if heartbeat_thread and heartbeat_thread.is_alive():
            heartbeat_thread.join()

        if temp_pdf_path and os.path.exists(temp_pdf_path):
            try:
                os.remove(temp_pdf_path)
            except OSError:
                logger.exception(
                    "Could not remove temporary PDF: %s",
                    temp_pdf_path,
                )


def run_worker():
    """Continuously claim and process ingestion jobs."""

    logger.info("PaperPilot ingestion worker started.")

    while True:
        try:
            job = get_next_ingestion_job()

            if job is None:
                time.sleep(IDLE_WAIT)
                continue

            process_job(job)

        except KeyboardInterrupt:
            logger.info("PaperPilot worker stopped.")
            break

        except Exception:
            logger.exception("Worker encountered an unexpected error.")
            time.sleep(IDLE_WAIT)


if __name__ == "__main__":
    run_worker()

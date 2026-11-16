
"""Manage paper ingestion jobs using Supabase."""

import uuid

from database.supabase_client import get_admin_supabase_client


VALID_JOB_STATUSES = {
    "queued",
    "processing",
    "completed",
    "failed",
}


def create_ingestion_job(paper_id: str, user_id: str):
    """Create an ingestion job for a paper."""

    if not paper_id or not user_id:
        raise ValueError("paper_id and user_id are required.")

    client = get_admin_supabase_client()

    response = (
        client.table("ingestion_jobs")
        .insert({
            "id": str(uuid.uuid4()),
            "paper_id": paper_id,
            "user_id": user_id,
            "status": "queued",
        })
        .select("id")
        .single()
        .execute()
    )

    return response.data["id"]


def get_next_ingestion_job():
    """Atomically claim the next available ingestion job."""

    client = get_admin_supabase_client()

    response = client.rpc("claim_ingestion_job").execute()

    if not response.data:
        return None

    return response.data[0]


def update_ingestion_job_heartbeat(job_id: str, claim_token: str):
    """Refresh the heartbeat if this worker still owns the job."""

    client = get_admin_supabase_client()

    response = client.rpc(
        "update_ingestion_job_heartbeat",
        {
            "p_job_id": job_id,
            "p_claim_token": claim_token,
        },
    ).execute()

    return response.data is True


def update_ingestion_job(
    job_id: str,
    claim_token: str,
    status: str,
    error_message: str | None = None,
):
    """Update a job only if this worker still owns it."""

    if not job_id or not claim_token:
        raise ValueError("job_id and claim_token are required.")

    if status not in VALID_JOB_STATUSES:
        raise ValueError(f"Invalid ingestion job status: {status}")

    client = get_admin_supabase_client()

    response = (
        client.table("ingestion_jobs")
        .update({
            "status": status,
            "error_message": error_message[:2000] if error_message else None,
            "claim_token": None if status in {"completed", "failed", "queued"} else claim_token,
        })
        .eq("id", job_id)
        .eq("claim_token", claim_token)
        .eq("status", "processing")
        .select("id")
        .execute()
    )

    return bool(response.data)


def complete_ingestion_job(job_id, claim_token):
    """Atomically complete the job and mark its paper as ready."""

    client = get_admin_supabase_client()

    response = client.rpc(
        "complete_ingestion_job",
        {
            "p_job_id": job_id,
            "p_claim_token": claim_token,
        },
    ).execute()

    return response.data is True
def fail_ingestion_job(job_id, claim_token, error_message):
    """Atomically fail the job and mark its paper as failed."""

    client = get_admin_supabase_client()

    response = client.rpc(
        "fail_ingestion_job",
        {
            "p_job_id": job_id,
            "p_claim_token": claim_token,
            "p_error_message": str(error_message)[:2000],
        },
    ).execute()

    return response.data is True



def retry_ingestion_job(paper_id: str, user_id: str):
    """Retry a failed ingestion job for a user's paper."""

    if not paper_id or not user_id:
        raise ValueError("paper_id and user_id are required.")

    client = get_admin_supabase_client()

    response = client.rpc(
        "retry_ingestion_job",
        {
            "p_paper_id": paper_id,
            "p_user_id": user_id,
        },
    ).execute()

    return response.data is True
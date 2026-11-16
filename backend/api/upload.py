
import ipaddress
import logging
import re
import socket
import uuid

import requests

from pathlib import Path
from urllib.parse import urljoin, urlparse, unquote

from requests.adapters import HTTPAdapter
from fastapi import HTTPException, UploadFile

from database.supabase_client import get_user_supabase_client
from Graph_Rag.paper_registry import (
    add_paper,
    update_paper_status,
)
from database.ingestion_jobs import create_ingestion_job


logger = logging.getLogger(__name__)

MAX_PDF_SIZE = 50 * 1024 * 1024
MAX_REDIRECTS = 5
REDIRECT_CODES = {301, 302, 303, 307, 308}


class PinnedIPAdapter(HTTPAdapter):

    def __init__(self, hostname, ip_address, scheme, port):
        self.hostname = hostname
        self.ip_address = ip_address
        self.scheme = scheme
        self.port = port
        super().__init__()

    def get_pinned_connection(self):
        pool_options = {}

        if self.scheme == "https":
            pool_options["assert_hostname"] = self.hostname
            pool_options["server_hostname"] = self.hostname

        return self.poolmanager.connection_from_host(
            self.ip_address,
            scheme=self.scheme,
            port=self.port,
            pool_kwargs=pool_options,
        )

    def get_connection(self, url, proxies=None):
        return self.get_pinned_connection()

    def get_connection_with_tls_context(
        self, request, verify, proxies=None, cert=None
    ):
        return self.get_pinned_connection()

    def send(self, request, **kwargs):
        host = self.hostname

        if self.port not in (80, 443):
            host = f"{host}:{self.port}"

        request.headers["Host"] = host

        return super().send(request, **kwargs)
def _resolve_public_ip(hostname, port):
    """Resolve a hostname and reject private or internal IP addresses."""

    try:
        ipaddress.ip_address(hostname)
        addresses = [hostname]
    except ValueError:
        try:
            results = socket.getaddrinfo(
                hostname,
                port,
                type=socket.SOCK_STREAM,
            )
        except socket.gaierror as error:
            raise ValueError("Could not resolve the URL hostname.") from error

        addresses = list({result[4][0] for result in results})

    if not addresses:
        raise ValueError("The URL hostname has no valid IP address.")

    for address in addresses:
        try:
            ip = ipaddress.ip_address(address.split("%")[0])
        except ValueError as error:
            raise ValueError("Invalid destination IP address.") from error

        if not ip.is_global:
            raise ValueError(
                "URLs pointing to private or internal networks are not allowed."
            )

    return addresses[0]


def _validate_public_url(url):
    """Validate a public HTTP or HTTPS URL and pin its destination IP."""

    if not url or len(url) > 2048:
        raise ValueError("Invalid or excessively long PDF URL.")

    parsed = urlparse(url)

    if parsed.scheme.lower() not in ("http", "https"):
        raise ValueError("Only HTTP and HTTPS URLs are allowed.")

    if not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Invalid PDF URL.")

    hostname = parsed.hostname.encode("idna").decode("ascii").lower()

    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("Invalid URL port.") from error

    if port is None:
        port = 443 if parsed.scheme.lower() == "https" else 80

    if port not in (80, 443):
        raise ValueError("Only standard HTTP and HTTPS ports are allowed.")

    scheme = parsed.scheme.lower()

    # Resolve once and use this exact IP for the connection.
    ip_address = _resolve_public_ip(hostname, port)

    return hostname, ip_address, scheme, port


def _download_public_pdf(url):
    """Download a PDF safely, validating every redirect destination."""

    current_url = url

    for redirect_count in range(MAX_REDIRECTS + 1):
        hostname, ip_address, scheme, port = _validate_public_url(
            current_url
        )

        adapter = PinnedIPAdapter(
            hostname,
            ip_address,
            scheme,
            port,
        )

        try:
            with requests.Session() as session:
                session.trust_env = False
                session.mount(f"{scheme}://", adapter)

                with session.get(
                    current_url,
                    headers={"User-Agent": "PaperPilot/1.0"},
                    timeout=(10, 30),
                    stream=True,
                    allow_redirects=False,
                ) as response:

                    if response.status_code in REDIRECT_CODES:
                        location = response.headers.get("Location")

                        if not location:
                            raise ValueError(
                                "The PDF server returned an invalid redirect."
                            )

                        if redirect_count >= MAX_REDIRECTS:
                            raise ValueError("Too many URL redirects.")

                        current_url = urljoin(current_url, location)
                        continue

                    response.raise_for_status()

                    content_length = response.headers.get("Content-Length")

                    if content_length:
                        try:
                            if int(content_length) > MAX_PDF_SIZE:
                                raise HTTPException(
                                    status_code=413,
                                    detail="PDF size must not exceed 50 MB.",
                                )
                        except ValueError as error:
                            raise ValueError(
                                "Invalid PDF content length."
                            ) from error

                    content = bytearray()

                    for chunk in response.iter_content(chunk_size=8192):
                        if not chunk:
                            continue

                        content.extend(chunk)

                        if len(content) > MAX_PDF_SIZE:
                            raise HTTPException(
                                status_code=413,
                                detail="PDF size must not exceed 50 MB.",
                            )

                    return bytes(content), current_url

        finally:
            adapter.close()

    raise ValueError("Could not download the PDF.")


def _upload_to_storage(content: bytes, storage_path: str, access_token: str):
    """Upload a PDF to the user's private Supabase Storage folder."""

    client = get_user_supabase_client(access_token)

    client.storage.from_("papers").upload(
        storage_path,
        content,
        file_options={
            "content-type": "application/pdf",
            "upsert": "false",
            "authorization": f"Bearer {access_token}",
        },
    )


def _remove_from_storage(storage_path: str, access_token: str):
    """Remove a PDF from Supabase Storage."""

    client = get_user_supabase_client(access_token)
    client.storage.from_("papers").remove([storage_path])


def _register_paper(
    paper_id: str,
    user_id: str,
    filename: str,
    storage_path: str,
    access_token: str,
):
    """Register a paper and create its ingestion job."""

    add_paper(
        paper_id=paper_id,
        user_id=user_id,
        filename=filename,
        storage_path=storage_path,
        status="processing",
        access_token=access_token,
    )

    try:
        create_ingestion_job(paper_id, user_id)

    except Exception:
        try:
            update_paper_status(
                paper_id,
                user_id,
                "failed",
                access_token,
            )
        except Exception:
            logger.exception(
                "Could not mark paper %s as failed",
                paper_id,
            )

        raise


def _cleanup_unregistered_paper(
    paper_id,
    user_id,
    storage_path,
    access_token,
):
    """Remove the uploaded PDF only if its database record was not created."""

    try:
        paper = get_user_supabase_client(access_token).table(
            "papers"
        ).select("paper_id").eq(
            "paper_id", paper_id
        ).eq(
            "user_id", user_id
        ).execute()

        if not paper.data:
            _remove_from_storage(storage_path, access_token)

    except Exception:
        logger.exception(
            "Could not clean up uploaded PDF %s",
            paper_id,
        )


async def upload_paper(
    file: UploadFile,
    user_id: str,
    access_token: str,
):
    try:
        if not file.filename or Path(file.filename).suffix.lower() != ".pdf":
            raise HTTPException(
                status_code=400,
                detail="Please upload a PDF file.",
            )

        content = await file.read(MAX_PDF_SIZE + 1)

        if len(content) > MAX_PDF_SIZE:
            raise HTTPException(
                status_code=413,
                detail="PDF size must not exceed 50 MB.",
            )

        if not content.startswith(b"%PDF-"):
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is not a valid PDF.",
            )

        paper_id = str(uuid.uuid4())
        filename = Path(file.filename).name
        storage_path = f"{user_id}/{paper_id}.pdf"

        _upload_to_storage(content, storage_path, access_token)

        try:
            _register_paper(
                paper_id,
                user_id,
                filename,
                storage_path,
                access_token,
            )
        except Exception:
            _cleanup_unregistered_paper(
                paper_id,
                user_id,
                storage_path,
                access_token,
            )
            raise

        return {
            "message": "Paper uploaded and queued for processing",
            "paper_id": paper_id,
            "filename": filename,
            "status": "processing",
        }

    except HTTPException:
        raise

    except Exception as error:
        logger.exception("Paper upload failed")

        raise HTTPException(
            status_code=500,
            detail="Could not upload and queue the paper.",
        ) from error

    finally:
        await file.close()


async def import_paper_from_url(
    pdf_url: str,
    user_id: str,
    access_token: str,
):
    try:
        pdf_url = get_pdf_url(pdf_url)

        content, final_url = _download_public_pdf(pdf_url)

        if not content.startswith(b"%PDF-"):
            raise HTTPException(
                status_code=400,
                detail="The provided URL does not contain a valid PDF.",
            )

        parsed_url = urlparse(final_url)
        filename = Path(unquote(parsed_url.path)).name or "paper.pdf"

        if not filename.lower().endswith(".pdf"):
            filename = "paper.pdf"

        paper_id = str(uuid.uuid4())
        storage_path = f"{user_id}/{paper_id}.pdf"

        _upload_to_storage(content, storage_path, access_token)

        try:
            _register_paper(
                paper_id,
                user_id,
                filename,
                storage_path,
                access_token,
            )
        except Exception:
            _cleanup_unregistered_paper(
                paper_id,
                user_id,
                storage_path,
                access_token,
            )
            raise

        return {
            "message": "Paper imported and queued for processing",
            "paper_id": paper_id,
            "filename": filename,
            "status": "processing",
        }

    except HTTPException:
        raise

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error

    except requests.RequestException as error:
        logger.exception("PDF URL download failed")

        raise HTTPException(
            status_code=502,
            detail="Could not download the PDF from the provided URL.",
        ) from error

    except Exception as error:
        logger.exception("PDF URL import failed")

        raise HTTPException(
            status_code=500,
            detail="Could not import and queue the PDF.",
        ) from error


def get_pdf_url(url: str):
    """Convert arXiv abstract links into PDF links."""

    parsed_url = urlparse(url)

    if parsed_url.netloc.lower() in (
        "arxiv.org",
        "www.arxiv.org",
    ):
        match = re.match(
            r"^/(?:abs|pdf)/([a-zA-Z0-9.]+(?:v\d+)?)",
            parsed_url.path,
        )

        if not match:
            raise ValueError("Invalid arXiv URL.")

        paper_id = match.group(1)
        return f"https://arxiv.org/pdf/{paper_id}.pdf"

    return url

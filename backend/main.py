
import logging

from contextlib import asynccontextmanager
from typing import Annotated
from urllib.parse import quote
from database.ingestion_jobs import retry_ingestion_job

from fastapi import (
    FastAPI,
    Depends,
    File,
    HTTPException,
    UploadFile,
)
from fastapi.responses import Response
from pydantic import BaseModel

from conversations.routes import router as conversations_router
from api.upload import upload_paper, import_paper_from_url
from api.questions import answer_paper_question, get_user_papers

from Graph_Rag.paper_registry import get_paper_for_user
from database.supabase_client import get_user_supabase_client

from auth.routes import router as auth_router
from auth.dependencies import get_current_user


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(lifespan=lifespan)

app.include_router(auth_router)
app.include_router(conversations_router)


# Request models

class QuestionRequest(BaseModel):
    question: str


class PDFUrlRequest(BaseModel):
    pdf_url: str


# General endpoints

@app.get("/")
async def root():
    return {"message": "PaperPilot API is running"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}


# Paper endpoints

@app.get("/papers/")
async def get_papers(
    current_user: dict = Depends(get_current_user),
):
    try:
        return get_user_papers(
            user_id=current_user["id"],
            access_token=current_user["access_token"],
        )

    except Exception as error:
        logger.exception("Failed to retrieve user papers")

        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve papers.",
        ) from error


@app.post("/papers/{paper_id}/retry")
async def retry_paper_processing(
    paper_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    access_token = current_user["access_token"]

    paper = get_paper_for_user(
        paper_id,
        user_id,
        access_token,
    )

    if not paper:
        raise HTTPException(
            status_code=404,
            detail="Paper not found.",
        )

    try:
        retried = retry_ingestion_job(paper_id, user_id)

        if not retried:
            raise HTTPException(
                status_code=400,
                detail="No failed ingestion job found for this paper.",
            )

        return {
            "paper_id": paper_id,
            "status": "processing",
            "message": "Paper processing has been queued again.",
        }

    except HTTPException:
        raise

    except Exception as error:
        logger.exception("Failed to retry paper %s", paper_id)

        raise HTTPException(
            status_code=500,
            detail="Failed to retry paper processing.",
        ) from error

@app.post("/papers/{paper_id}/ask")
async def ask_question(
    paper_id: str,
    request: QuestionRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    access_token = current_user["access_token"]

    paper = get_paper_for_user(
        paper_id,
        user_id,
        access_token,
    )

    if not paper:
        raise HTTPException(
            status_code=404,
            detail="Paper not found.",
        )

    question = request.question.strip()

    if not question:
        raise HTTPException(
            status_code=400,
            detail="Question cannot be empty.",
        )

    try:
        answer = answer_paper_question(
            question=question,
            user_id=user_id,
            paper_id=paper_id,
        )

        return {
            "paper_id": paper_id,
            "question": question,
            "answer": answer,
        }

    except Exception as error:
        logger.exception(
            "Paper question answering failed for paper %s",
            paper_id,
        )

        raise HTTPException(
            status_code=500,
            detail="Failed to answer question.",
        ) from error


@app.post("/uploadfile/")
async def create_upload_file(
    file: Annotated[UploadFile, File()],
    current_user: dict = Depends(get_current_user),
):
    return await upload_paper(
        file=file,
        user_id=current_user["id"],
        access_token=current_user["access_token"],
    )


@app.get("/papers/{paper_id}/pdf")
def get_paper_pdf(
    paper_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    access_token = current_user["access_token"]

    paper = get_paper_for_user(
        paper_id,
        user_id,
        access_token,
    )

    if not paper:
        raise HTTPException(
            status_code=404,
            detail="Paper not found.",
        )

    try:
        client = get_user_supabase_client(access_token)

        pdf_content = client.storage.from_("papers").download(
            paper["storage_path"]
        )

        if not pdf_content:
            raise HTTPException(
                status_code=404,
                detail="PDF not found.",
            )

        filename = quote(paper["filename"], safe="")

        return Response(
            content=pdf_content,
            media_type="application/pdf",
            headers={
                "Content-Disposition": (
                    f"inline; filename*=UTF-8''{filename}"
                )
            },
        )

    except HTTPException:
        raise

    except Exception as error:
        logger.exception(
            "Failed to download PDF for paper %s",
            paper_id,
        )

        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve PDF.",
        ) from error


@app.post("/import-url/")
async def import_pdf_url(
    request: PDFUrlRequest,
    current_user: dict = Depends(get_current_user),
):
    return await import_paper_from_url(
        pdf_url=request.pdf_url,
        user_id=current_user["id"],
        access_token=current_user["access_token"],
    )


from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from api.upload import upload_paper
from api.questions import answer_paper_question, get_user_papers


app = FastAPI()


class QuestionRequest(BaseModel):
    question: str
    user_id: str


@app.get("/")
async def root():
    return {"message": "PaperPilot API is running"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/papers/")
async def get_papers(user_id: str):
    try:
        return get_user_papers(user_id)
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve papers: {error}",
        ) from error


@app.post("/papers/{paper_id}/ask")
async def ask_question(paper_id: str, request: QuestionRequest):
    try:
        answer = answer_paper_question(
            question=request.question,
            user_id=request.user_id,
            paper_id=paper_id,
        )

        return {
            "paper_id": paper_id,
            "question": request.question,
            "answer": answer,
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to answer question: {error}",
        ) from error


@app.post("/uploadfile/")
async def create_upload_file(
    file: Annotated[UploadFile, File()],
    user_id: Annotated[str, Form()],
):
    return await upload_paper(file, user_id)

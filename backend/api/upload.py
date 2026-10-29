#Upload files
import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from Graph_Rag.metadata import process_paper
from Graph_Rag.paper_registry import add_paper, update_paper_status


UPLOAD_DIR = Path("uploaded_papers")
UPLOAD_DIR.mkdir(exist_ok=True)


async def upload_paper(file: UploadFile, user_id: str):
    if not file.filename or Path(file.filename).suffix.lower() != ".pdf":
        raise HTTPException(
            status_code=400,
            detail="Please upload a PDF file.",
        )

    paper_id = str(uuid.uuid4())
    pdf_path = UPLOAD_DIR / f"{paper_id}.pdf"

    try:
        with pdf_path.open("wb") as saved_file:
            shutil.copyfileobj(file.file, saved_file)

        add_paper(
            paper_id,
            user_id,
            file.filename,
            str(pdf_path),
            "processing",
        )

        result = process_paper(str(pdf_path), paper_id, user_id)

        update_paper_status(paper_id, user_id, "ready")

        return {
            "message": "Paper processed successfully",
            "filename": file.filename,
            **result,
        }

    
    except HTTPException:
        raise

    except Exception as error:
        if pdf_path.exists():
            pdf_path.unlink()

        try:
            update_paper_status(paper_id, user_id, "failed")
        except Exception:
            pass

        raise HTTPException(
            status_code=500,
            detail=f"Paper processing failed: {error}",
        ) from error

    finally:
        await file.close()

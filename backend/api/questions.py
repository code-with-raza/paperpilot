
from Graph_Rag.answer_generator import ask_paper
from Graph_Rag.paper_registry import list_papers


def answer_paper_question(
    question: str,
    user_id: str,
    paper_id: str,
):
    return ask_paper(
        question=question,
        user_id=user_id,
        paper_id=paper_id,
    )


def get_user_papers(user_id: str):
    papers = list_papers(user_id)

    return {
        "user_id": user_id,
        "papers": papers,
        "count": len(papers),
    }

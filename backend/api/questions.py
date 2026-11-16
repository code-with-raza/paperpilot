
from Graph_Rag.answer_generator import ask_paper
from Graph_Rag.paper_registry import list_papers


def answer_paper_question(
    question: str,
    user_id: str,
    paper_id: str | None = None,
    conversation_history: list | None = None,
    retrieved_memories: list | None = None,
):
    return ask_paper(
        question=question,
        user_id=user_id,
        paper_id=paper_id,
        conversation_history=conversation_history,
        retrieved_memories=retrieved_memories,
    )


def get_user_papers(user_id: str, access_token: str):
    papers = list_papers(user_id, access_token)

    return {
        "user_id": user_id,
        "papers": papers,
        "count": len(papers),
    }

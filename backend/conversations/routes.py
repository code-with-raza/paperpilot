
import logging

from fastapi import APIRouter, Depends, HTTPException

from auth.dependencies import get_current_user
from Graph_Rag.paper_registry import get_paper_for_user
from Graph_Rag.memory_store import (
    search_memories,
    store_memory,
    delete_conversation_memories,
)
from api.questions import answer_paper_question

from conversations.conversation import (
    create_conversation,
    get_user_conversations,
    get_conversation,
    delete_conversation,
)
from conversations.message import (
    get_conversation_messages,
    save_message,
)
from conversations.schemas import (
    CreateConversationRequest,
    SendMessageRequest,
    MessageResponse,
    ConversationResponse,
    ConversationDetailResponse,
)


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/conversations",
    tags=["Conversations"],
)


@router.post(
    "/",
    response_model=ConversationResponse,
    status_code=201,
)
def create_new_conversation(
    request: CreateConversationRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    access_token = current_user["access_token"]

    if request.paper_id:
        paper = get_paper_for_user(
            request.paper_id,
            user_id,
            access_token,
        )

        if not paper:
            raise HTTPException(
                status_code=404,
                detail="Paper not found.",
            )

    return create_conversation(
        user_id=user_id,
        title=request.title,
        paper_id=request.paper_id,
        access_token=access_token,
    )


@router.get(
    "/",
    response_model=list[ConversationResponse],
)
def list_conversations(
    current_user: dict = Depends(get_current_user),
):
    return get_user_conversations(
        user_id=current_user["id"],
        access_token=current_user["access_token"],
    )


@router.get(
    "/{conversation_id}",
    response_model=ConversationDetailResponse,
)
def get_conversation_details(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    access_token = current_user["access_token"]

    conversation = get_conversation(
        conversation_id,
        user_id,
        access_token,
    )

    if not conversation:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found.",
        )

    conversation["messages"] = get_conversation_messages(
        conversation_id,
        user_id,
        access_token,
    )

    return conversation


@router.post(
    "/{conversation_id}/messages",
    response_model=list[MessageResponse],
)
def send_message(
    conversation_id: str,
    request: SendMessageRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    access_token = current_user["access_token"]

    conversation = get_conversation(
        conversation_id,
        user_id,
        access_token,
    )

    if not conversation:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found.",
        )

    paper_id = conversation.get("paper_id")

    if paper_id:
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

    history = get_conversation_messages(
        conversation_id,
        user_id,
        access_token,
    )

    user_message_id = save_message(
        conversation_id=conversation_id,
        user_id=user_id,
        role="user",
        content=question,
        access_token=access_token,
    )

    if not user_message_id:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found.",
        )

    # Retrieve relevant memories from this user's previous conversations.
    try:
        memories = search_memories(
            query=question,
            user_id=user_id,
            current_conversation_id=conversation_id,
        )
    except Exception:
        logger.exception(
            "Memory retrieval failed for conversation %s",
            conversation_id,
        )
        memories = []

    try:
        answer = answer_paper_question(
            question=question,
            user_id=user_id,
            paper_id=paper_id,
            conversation_history=history,
            retrieved_memories=memories,
        )

    except Exception as error:
        logger.exception(
            "Answer generation failed for conversation %s",
            conversation_id,
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Failed to generate an answer. "
                "Your question has been saved; please try again."
            ),
        ) from error

    assistant_message_id = save_message(
        conversation_id=conversation_id,
        user_id=user_id,
        role="assistant",
        content=answer,
        access_token=access_token,
    )

    if not assistant_message_id:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found.",
        )

    # Store the completed exchange without interrupting the answer if indexing fails.
    try:
        store_memory(
            user_id=user_id,
            conversation_id=conversation_id,
            user_message_id=user_message_id,
            assistant_message_id=assistant_message_id,
            question=question,
            answer=answer,
        )
    except Exception:
        logger.exception(
            "Memory storage failed for conversation %s",
            conversation_id,
        )

    messages = get_conversation_messages(
        conversation_id,
        user_id,
        access_token,
    )

    return [
        message
        for message in messages
        if message["id"] in (
            user_message_id,
            assistant_message_id,
        )
    ]


@router.delete("/{conversation_id}")
def remove_conversation(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    access_token = current_user["access_token"]

    conversation = get_conversation(
        conversation_id,
        user_id,
        access_token,
    )

    if not conversation:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found.",
        )

    # Delete the conversation's memories before deleting the conversation.
    try:
        delete_conversation_memories(
            user_id=user_id,
            conversation_id=conversation_id,
        )
    except Exception as error:
        logger.exception(
            "Memory deletion failed for conversation %s",
            conversation_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to delete conversation memories.",
        ) from error

    deleted = delete_conversation(
        conversation_id,
        user_id,
        access_token,
    )

    if not deleted:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found.",
        )

    return {
        "message": "Conversation deleted successfully."
    }

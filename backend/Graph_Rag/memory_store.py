
"""Store and search long-term conversation memories."""

from datetime import datetime, timezone

from Graph_Rag.embeddings import embed_query
from Graph_Rag.vector_store import client, EMBEDDING_DIMENSION


collection = client.get_or_create_collection(
    name="paperpilot_memories",
    metadata={"hnsw:space": "cosine"},
)


def store_memory(
    user_id,
    conversation_id,
    user_message_id,
    assistant_message_id,
    question,
    answer,
):
    """Store one completed conversation exchange."""

    if not all((
        user_id,
        conversation_id,
        user_message_id,
        assistant_message_id,
    )):
        raise ValueError("Memory identifiers are required.")

    if not isinstance(question, str) or not question.strip():
        raise ValueError("Question cannot be empty.")

    if not isinstance(answer, str) or not answer.strip():
        raise ValueError("Answer cannot be empty.")

    memory_text = (
        f"User asked: {question.strip()}\n"
        f"PaperPilot answered: {answer.strip()}"
    )

    embedding = embed_query(memory_text)

    if len(embedding) != EMBEDDING_DIMENSION:
        raise ValueError("Invalid memory embedding dimension.")

    collection.upsert(
        ids=[str(user_message_id)],
        embeddings=[embedding],
        documents=[memory_text],
        metadatas=[{
            "user_id": str(user_id),
            "conversation_id": str(conversation_id),
            "user_message_id": str(user_message_id),
            "assistant_message_id": str(assistant_message_id),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }],
    )

    return str(user_message_id)


def search_memories(
    query,
    user_id,
    current_conversation_id,
    top_k=5,
):
    """Search relevant memories from other conversations of one user."""

    if not user_id or not current_conversation_id:
        raise ValueError(
            "user_id and current_conversation_id are required."
        )

    if not isinstance(query, str) or not query.strip():
        raise ValueError("Memory search query cannot be empty.")

    if (
        not isinstance(top_k, int)
        or isinstance(top_k, bool)
        or top_k <= 0
    ):
        raise ValueError("top_k must be a positive integer.")

    if collection.count() == 0:
        return []

    query_embedding = embed_query(query)

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        where={
            "$and": [
                {"user_id": str(user_id)},
                {
                    "conversation_id": {
                        "$ne": str(current_conversation_id)
                    }
                },
            ]
        },
        include=["documents", "metadatas", "distances"],
    )

    memories = []

    for document, metadata, distance in zip(
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0],
    ):
        memories.append({
            "text": document,
            "conversation_id": metadata["conversation_id"],
            "created_at": metadata["created_at"],
            "distance": distance,
        })

    return memories

def delete_conversation_memories(user_id, conversation_id):
    """Delete memories belonging to one user's conversation."""

    if not user_id or not conversation_id:
        raise ValueError(
            "user_id and conversation_id are required."
        )

    collection.delete(
        where={
            "$and": [
                {"user_id": str(user_id)},
                {"conversation_id": str(conversation_id)},
            ]
        }
    )

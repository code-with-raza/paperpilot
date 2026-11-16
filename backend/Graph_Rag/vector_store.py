
"""Store and search paper chunks using ChromaDB."""


import math

import chromadb

client = chromadb.HttpClient(host="127.0.0.1", port=8001)

collection = client.get_or_create_collection(
    name="paperpilot_chunks"
)

EMBEDDING_DIMENSION = 384

def store_chunks(chunks, user_id):
    """Save document chunks and their embeddings."""

    if not user_id:
        raise ValueError("user_id is required.")

    if not chunks:
        return 0

    ids = []
    embeddings = []
    documents = []
    metadatas = []

    required_fields = (
        "chunk_id",
        "paper_id",
        "section",
        "page_start",
        "page_end",
        "text",
        "embedding",
    )

    for chunk in chunks:
        for field in required_fields:
            if field not in chunk:
                raise ValueError(
                    f"Chunk is missing required field: {field}"
                )

        chunk_id = chunk["chunk_id"]
        paper_id = chunk["paper_id"]
        text = chunk["text"]
        embedding = chunk["embedding"]

        if not isinstance(paper_id, str) or not paper_id:
            raise ValueError("Invalid paper_id.")

        # Chunk IDs are namespaced by the globally unique paper UUID.
        if not isinstance(chunk_id, str) or not chunk_id.startswith(
            f"{paper_id}_chunk_"
        ):
            raise ValueError(
                f"Chunk ID does not belong to paper {paper_id}."
            )

        if chunk_id in ids:
            raise ValueError(f"Duplicate chunk ID: {chunk_id}")

        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"Chunk {chunk_id} has empty text.")

        if (
            not isinstance(embedding, (list, tuple))
            or len(embedding) != EMBEDDING_DIMENSION
        ):
            raise ValueError(
                f"Chunk {chunk_id} must have a "
                f"{EMBEDDING_DIMENSION}-dimensional embedding."
            )

        if not all(
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
            for value in embedding
        ):
            raise ValueError(
                f"Chunk {chunk_id} has an invalid embedding."
            )

        if not isinstance(chunk["section"], str):
            raise ValueError(f"Chunk {chunk_id} has an invalid section.")

        if not isinstance(chunk["page_start"], int) or not isinstance(
            chunk["page_end"], int
        ):
            raise ValueError(f"Chunk {chunk_id} has invalid page numbers.")

        if chunk["page_start"] < 1 or chunk["page_end"] < chunk["page_start"]:
            raise ValueError(f"Chunk {chunk_id} has an invalid page range.")

        ids.append(chunk_id)
        embeddings.append(list(embedding))
        documents.append(text)

        metadatas.append({
            "user_id": str(user_id),
            "paper_id": paper_id,
            "section": chunk["section"],
            "page_start": chunk["page_start"],
            "page_end": chunk["page_end"],
        })

    # Store all chunks in one database operation.
    collection.upsert(
        ids=ids,
        embeddings=embeddings,
        documents=documents,
        metadatas=metadatas,
    )

    return len(chunks)


def search_chunks(query_embedding, user_id, paper_id, top_k=8):
    """Find relevant chunks belonging to one user's selected paper."""

    if not user_id or not paper_id:
        raise ValueError("user_id and paper_id are required.")

    if (
        not isinstance(query_embedding, (list, tuple))
        or len(query_embedding) != EMBEDDING_DIMENSION
    ):
        raise ValueError(
            f"Query embedding must have "
            f"{EMBEDDING_DIMENSION} dimensions."
        )

    if not all(
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        for value in query_embedding
    ):
        raise ValueError("Query embedding contains invalid values.")

    if (
        not isinstance(top_k, int)
        or isinstance(top_k, bool)
        or top_k <= 0
    ):
        raise ValueError("top_k must be a positive integer.")

    results = collection.query(
        query_embeddings=[list(query_embedding)],
        n_results=top_k,
        where={
            "$and": [
                {"user_id": str(user_id)},
                {"paper_id": str(paper_id)},
            ]
        },
    )

    return results

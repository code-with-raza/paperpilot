
"""Convert document chunks and questions into vector embeddings."""

import math

from sentence_transformers import SentenceTransformer


# Load the model once and reuse it.
MODEL_NAME = "all-MiniLM-L6-v2"
EMBEDDING_DIMENSION = 384

model = SentenceTransformer(MODEL_NAME)

if model.get_embedding_dimension() != EMBEDDING_DIMENSION:
    raise RuntimeError(
        f"{MODEL_NAME} must produce {EMBEDDING_DIMENSION}-dimensional embeddings."
    )


def _validate_embedding(embedding):
    """Check that an embedding contains valid numeric values."""

    if len(embedding) != EMBEDDING_DIMENSION:
        raise ValueError("The generated embedding has an incorrect dimension.")

    if not all(
        math.isfinite(float(value))
        for value in embedding
    ):
        raise ValueError("The generated embedding contains invalid values.")


def embed_chunks(chunks):
    """Convert document chunks into embeddings."""

    if not chunks:
        return []

    texts = []

    for chunk in chunks:
        text = chunk.get("text", "")

        if not isinstance(text, str) or not text.strip():
            raise ValueError(
                f"Chunk {chunk.get('chunk_id', 'unknown')} has no valid text."
            )

        texts.append(text.strip())

    embeddings = model.encode(
        texts,
        batch_size=32,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )

    embedded_chunks = []

    for chunk, embedding in zip(chunks, embeddings):
        embedding = embedding.tolist()
        _validate_embedding(embedding)

        embedded_chunks.append({
            **chunk,
            "embedding": embedding,
        })

    return embedded_chunks


def embed_query(query):
    """Convert a user's question into an embedding."""

    if not isinstance(query, str) or not query.strip():
        raise ValueError("The query must be a non-empty string.")

    embedding = model.encode(
        query.strip(),
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )

    embedding = embedding.tolist()
    _validate_embedding(embedding)

    return embedding

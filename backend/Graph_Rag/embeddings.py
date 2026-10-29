##Convert chunks into vectors

from sentence_transformers import SentenceTransformer

# Load the model once
model = SentenceTransformer("all-MiniLM-L6-v2")


def embed_chunks(chunks):
    """Convert document chunks into embeddings."""

    texts = [chunk["text"] for chunk in chunks]

    if not texts:
        return []

    embeddings = model.encode(
        texts,
        normalize_embeddings=True
    )

    return [
        {**chunk, "embedding": embedding.tolist()}
        for chunk, embedding in zip(chunks, embeddings)
    ]


def embed_query(query):
    """Convert a user's question into an embedding."""

    embedding = model.encode(
        query,
        normalize_embeddings=True
    )

    return embedding.tolist()

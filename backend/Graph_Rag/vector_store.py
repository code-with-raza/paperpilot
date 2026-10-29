## Store and search vectors
import chromadb

# Create a local database
client = chromadb.PersistentClient(path="./chroma_data")

# Create a collection for PaperPilot
collection = client.get_or_create_collection(
    name="paperpilot_chunks"
)


def store_chunks(chunks, user_id):
    """Save document chunks and their embeddings."""

    for chunk in chunks:
        metadata = {
            "user_id": user_id,
            "paper_id": chunk["paper_id"],
            "section": chunk["section"],
            "page_start": chunk["page_start"],
            "page_end": chunk["page_end"]
        }

        collection.upsert(
            ids=[chunk["chunk_id"]],
            embeddings=[chunk["embedding"]],
            documents=[chunk["text"]],
            metadatas=[metadata]
        )

    return len(chunks)


def search_chunks(query_embedding, user_id, paper_id, top_k=8):
    """Find the most relevant chunks for a question."""

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        where={
            "$and": [
                {"user_id": user_id},
                {"paper_id": paper_id}
            ]
        }
    )

    return results

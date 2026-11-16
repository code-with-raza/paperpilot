
"""Process PDFs for vector search and graph-based retrieval."""

from Graph_Rag.chunker import detect_sections, chunk_section
from Graph_Rag.embeddings import embed_chunks
from Graph_Rag.vector_store import store_chunks

from Graph_Rag.graph_store import (
    save_graph,
    load_graph,
    load_processed_chunks,
    save_processed_chunks,
)

from Graph_Rag.graph_relationship import (
    extract_relationships,
    add_relationships,
)


def process_paper(pdf_path, paper_id, user_id):
    """Process a PDF for one user and one paper."""

    if not pdf_path or not paper_id or not user_id:
        raise ValueError("PDF path, paper_id, and user_id are required.")

    # 1. Extract sections and split them into chunks.
    sections = detect_sections(pdf_path)
    chunks = chunk_section(sections, paper_id)

    if not chunks:
        raise ValueError("No text chunks were extracted from the PDF.")

    # 2. Generate embeddings and store chunks.
    embedded_chunks = embed_chunks(chunks)
    store_chunks(embedded_chunks, user_id)

    # 3. Load this user's graph and processing progress.
    graph = load_graph(user_id, paper_id)
    processed_chunks = load_processed_chunks(user_id, paper_id)

    # Only count progress belonging to the current chunks.
    valid_chunk_ids = {chunk["chunk_id"] for chunk in chunks}
    processed_chunks.intersection_update(valid_chunk_ids)

    # 4. Extract relationships from unprocessed chunks.
    for index, chunk in enumerate(chunks, start=1):
        chunk_id = chunk["chunk_id"]

        if chunk_id in processed_chunks:
            print(f"Skipping completed chunk {index}/{len(chunks)}")
            continue

        print(f"Extracting relationships from chunk {index}/{len(chunks)}")

        # Provider fallback is handled inside extract_relationships().
        # If both providers fail, the error reaches the worker.
        extracted_data = extract_relationships(chunk["text"])

        add_relationships(
            graph,
            extracted_data,
            chunk["page_start"],
            chunk["page_end"],
            chunk["section"],
        )

        # Save graph before recording the chunk as completed.
        save_graph(graph, user_id, paper_id)

        processed_chunks.add(chunk_id)
        save_processed_chunks(user_id, paper_id, processed_chunks)

    # 5. Save the final graph.
    graph_path = save_graph(graph, user_id, paper_id)

    graph_complete = valid_chunk_ids.issubset(processed_chunks)

    return {
        "paper_id": paper_id,
        "sections": len(sections),
        "chunks": len(chunks),
        "processed_graph_chunks": len(processed_chunks),
        "graph_complete": graph_complete,
        "graph_path": graph_path,
    }

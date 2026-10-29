##Track paper, section, page and chunk IDs
## Process a paper and store its chunks and graph

from Graph_Rag.chunker import detect_sections, chunk_section
from Graph_Rag.embeddings import embed_chunks
from Graph_Rag.vector_store import store_chunks
import time
from groq import RateLimitError, BadRequestError

from Graph_Rag.graph_relationship import (
    create_graph,
    extract_relationships,
    add_relationships,
)
from Graph_Rag.graph_store import save_graph


def process_paper(pdf_path, paper_id, user_id):
    """Process a PDF for retrieval and graph-based question answering."""

    # 1. Split the PDF into sections and chunks
    sections = detect_sections(pdf_path)
    chunks = chunk_section(sections, paper_id)

    if not chunks:
        raise ValueError("No text chunks were extracted from the PDF.")

    # 2. Generate embeddings and store the chunks
    embedded_chunks = embed_chunks(chunks)
    store_chunks(embedded_chunks, user_id)

    # 3. Extract relationships from each actual chunk
    
    # 3. Extract relationships from every chunk
    graph = create_graph()

    for index, chunk in enumerate(chunks, start=1):
        print(f"Extracting relationships from chunk {index}/{len(chunks)}")

        extracted_data = {"entities": [], "relationships": []}

        for attempt in range(3):
            try:
                extracted_data = extract_relationships(chunk["text"])
                break

            except RateLimitError:
                if attempt == 2:
                    print(f"Skipping graph extraction for chunk {index}: rate limit.")
                    break

                print("Groq rate limit reached. Waiting 10 seconds...")
                time.sleep(10)

            except BadRequestError as error:
                print(f"Skipping graph extraction for chunk {index}: {error}")
                break
        add_relationships(
            graph,
            extracted_data,
            chunk["page_start"],
            chunk["page_end"],
            chunk["section"],
        )

    # 4. Save the paper's graph
    graph_path = save_graph(graph, paper_id)

    return {
        "paper_id": paper_id,
        "sections": len(sections),
        "chunks": len(embedded_chunks),
        "graph_path": graph_path,
    }


"""Combine vector, keyword, and graph retrieval."""

import re

from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder

from Graph_Rag.embeddings import embed_query
from Graph_Rag.vector_store import collection, search_chunks
from Graph_Rag.graph_store import load_graph


reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

STOP_WORDS = {
    "who", "what", "where", "when", "why", "how",
    "is", "are", "was", "were", "the", "a", "an",
    "of", "in", "on", "to", "for", "and", "or",
    "this", "that", "do", "does", "did", "during",
    "explain", "describe", "paper", "please",
}


def tokenize(text):
    """Convert text into searchable words."""
    words = re.findall(r"\b[a-z0-9]+\b", text.lower())
    return [word for word in words if word not in STOP_WORDS]


def clean_section_name(section):
    """Remove Markdown formatting from section names."""
    section = re.sub(r"^#+\s*", "", section or "")
    return section.replace("*", "").strip() or "Unknown"


def _format_chunk(chunk):
    """Include section and page metadata in reranking context."""
    return (
        f"Section: {chunk.get('section', 'Unknown')}\n"
        f"Pages: {chunk.get('page_start', 'Unknown')}-"
        f"{chunk.get('page_end', 'Unknown')}\n"
        f"Content: {chunk.get('text', '')}"
    )


def _reciprocal_rank_fusion(rankings, constant=60):
    """Combine ranked lists without adding unmatched chunks."""
    scores = {}

    for ranking in rankings:
        seen = set()

        for rank, chunk_id in enumerate(ranking, start=1):
            if chunk_id in seen:
                continue

            seen.add(chunk_id)
            scores[chunk_id] = scores.get(chunk_id, 0.0) + (
                1.0 / (constant + rank)
            )

    return scores


def retrieve_information(question, user_id, paper_id, top_k=5):
    """Retrieve relevant paper evidence and graph relationships."""

    if (
        not isinstance(question, str)
        or not question.strip()
        or not isinstance(top_k, int)
        or isinstance(top_k, bool)
        or top_k < 1
    ):
        return {"chunks": [], "relationships": []}

    # 1. Load chunks belonging only to this user and paper.
    stored = collection.get(
        where={
            "$and": [
                {"user_id": user_id},
                {"paper_id": paper_id},
            ]
        },
        include=["documents", "metadatas"],
    )

    ids = stored.get("ids") or []
    documents = stored.get("documents") or []
    metadatas = stored.get("metadatas") or []

    chunks_by_id = {}

    for chunk_id, document, metadata in zip(
        ids, documents, metadatas
    ):
        metadata = metadata or {}

        if not document or not document.strip():
            continue

        chunks_by_id[chunk_id] = {
            "chunk_id": chunk_id,
            "paper_id": paper_id,
            "text": document,
            "section": metadata.get("section", "Unknown"),
            "page_start": metadata.get("page_start", "Unknown"),
            "page_end": metadata.get("page_end", "Unknown"),
        }

    if not chunks_by_id:
        return {"chunks": [], "relationships": []}

    # 2. Retrieve keyword candidates using BM25.
    chunk_ids = list(chunks_by_id)
    tokenized_documents = [
        tokenize(f"{chunk['section']} {chunk['text']}")
        for chunk in chunks_by_id.values()
    ]
    query_words = tokenize(question)
    bm25_ranking = []

    if query_words and any(tokenized_documents):
        bm25 = BM25Okapi(tokenized_documents)
        bm25_scores = bm25.get_scores(query_words)

        bm25_order = sorted(
            range(len(bm25_scores)),
            key=lambda index: bm25_scores[index],
            reverse=True,
        )

        bm25_ranking = [
            chunk_ids[index]
            for index in bm25_order
            if bm25_scores[index] > 0
        ]

    # 3. Retrieve semantic candidates from the vector database.
    candidate_limit = min(
        max(top_k * 5, 20),
        len(chunks_by_id),
    )

    vector_results = search_chunks(
        embed_query(question),
        user_id,
        paper_id,
        top_k=candidate_limit,
    )

    vector_ids = (vector_results.get("ids") or [[]])[0]
    vector_ranking = [
        chunk_id
        for chunk_id in vector_ids
        if chunk_id in chunks_by_id
    ]

    # 4. Fuse actual keyword and vector rankings.
    fused_scores = _reciprocal_rank_fusion(
        [bm25_ranking, vector_ranking]
    )

    if not fused_scores:
        return {"chunks": [], "relationships": []}

    ranked_ids = sorted(
        fused_scores,
        key=lambda chunk_id: fused_scores[chunk_id],
        reverse=True,
    )

    # Rerank a broad but bounded pool of actual retrieval candidates.
    candidate_chunks = [
        chunks_by_id[chunk_id]
        for chunk_id in ranked_ids[:candidate_limit]
    ]

    # 5. Rerank using question, section, page range, and content.
    pairs = [
        (question, _format_chunk(chunk))
        for chunk in candidate_chunks
    ]

    reranker_scores = reranker.predict(pairs)

    for chunk, score in zip(candidate_chunks, reranker_scores):
        chunk["reranker_score"] = float(score)

    chunks = sorted(
        candidate_chunks,
        key=lambda chunk: chunk["reranker_score"],
        reverse=True,
    )[:top_k]

    # 6. Load graph relationships for the selected paper.
    graph = load_graph(paper_id)
    unique_relationships = []
    seen_relationships = set()

    if graph is not None:
        for source, target, data in graph.edges(data=True):
            item = {
                "source": source,
                "relation": data.get("relation", "related to"),
                "target": target,
                "section": data.get("section", "Unknown"),
                "page_start": data.get("page_start", "Unknown"),
                "page_end": data.get("page_end", "Unknown"),
            }

            key = (
                item["source"],
                item["relation"],
                item["target"],
                item["section"],
                item["page_start"],
                item["page_end"],
            )

            if key not in seen_relationships:
                seen_relationships.add(key)
                unique_relationships.append(item)

    # 7. Rank relationships against the question.
    if unique_relationships:
        relationship_pairs = [
            (
                question,
                (
                    f"Relationship: {item['source']} "
                    f"{item['relation']} {item['target']}\n"
                    f"Section: {item['section']}\n"
                    f"Pages: {item['page_start']}-"
                    f"{item['page_end']}"
                ),
            )
            for item in unique_relationships
        ]

        relationship_scores = reranker.predict(relationship_pairs)

        relationships = [
            item
            for score, item in sorted(
                zip(relationship_scores, unique_relationships),
                key=lambda pair: float(pair[0]),
                reverse=True,
            )[:top_k]
        ]
    else:
        relationships = []

    # 8. Normalize section names for citations.
    for chunk in chunks:
        chunk["section"] = clean_section_name(chunk["section"])

    for item in relationships:
        item["section"] = clean_section_name(item["section"])

    return {
        "chunks": chunks,
        "relationships": relationships,
    }

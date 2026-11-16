
"""Combine vector, keyword, and graph retrieval."""

import re
import json
from groq import Groq
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder
from dotenv import load_dotenv

load_dotenv()

from Graph_Rag.embeddings import embed_query
from Graph_Rag.vector_store import collection, search_chunks
from Graph_Rag.graph_store import load_graph


reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")



QUERY_EXPANSION_MODEL = "openai/gpt-oss-120b"
MAX_CANDIDATES = 30

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

    return [
        word for word in words
        if word not in STOP_WORDS
    ]

def _expand_query(question):
    """Generate alternative search queries without changing the original intent."""

    prompt = f"""
Generate exactly 2 alternative search queries for the user's question.

The alternatives must:
- Preserve the original question's meaning.
- Use different terminology or phrasing.
- Help retrieve relevant passages from academic papers.
- Avoid introducing new topics or assumptions.

Return only valid JSON in this format:
{{"queries": ["alternative 1", "alternative 2"]}}

Original question:
{question}
"""

    try:
        query_client = Groq()
        response = query_client.chat.completions.create(
            model=QUERY_EXPANSION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            temperature=0.2,
            max_tokens=150,
            response_format={"type": "json_object"},
        )

        result = json.loads(
            response.choices[0].message.content
        )

        alternatives = result.get("queries", [])

        if not isinstance(alternatives, list):
            return [question]

        queries = [question]

        for query in alternatives:
            if (
                isinstance(query, str)
                and query.strip()
                and query.strip().lower() not in {
                    item.lower() for item in queries
                }
            ):
                queries.append(query.strip())

            if len(queries) == 3:
                break

        return queries

    except Exception:
             
             return [question]


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
        or not user_id
        or not paper_id
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

        # Verify ownership even though Chroma already applies the filter.
        if (
            metadata.get("user_id") != user_id
            or metadata.get("paper_id") != paper_id
        ):
            continue

        if not isinstance(document, str) or not document.strip():
            continue

        chunks_by_id[chunk_id] = {
            "chunk_id": chunk_id,
            "paper_id": paper_id,
            "text": document,
            "section": metadata.get("section", "Unknown"),
            "page_start": metadata.get("page_start", "Unknown"),
            "page_end": metadata.get("page_end", "Unknown"),
        }

    # 2. Generate alternative search queries.
    search_queries = _expand_query(question)

    # Prepare BM25 once for all queries.
    chunk_ids = list(chunks_by_id)

    tokenized_documents = [
        tokenize(f"{chunk['section']} {chunk['text']}")
        for chunk in chunks_by_id.values()
    ]

    bm25 = None

    if tokenized_documents and any(tokenized_documents):
        bm25 = BM25Okapi(tokenized_documents)

    # 3. Retrieve candidates using every search query.
    candidate_limit = min(
        max(top_k * 5, 1),
        MAX_CANDIDATES,
    )

    rankings = []

    for search_query in search_queries:

        # Keyword retrieval.
        query_words = tokenize(search_query)

        if bm25 is not None and query_words:
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

            rankings.append(bm25_ranking)

        # Semantic retrieval.
        vector_results = search_chunks(
            embed_query(search_query),
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

        rankings.append(vector_ranking)

    # 4. Merge and deduplicate candidates using RRF.
    fused_scores = _reciprocal_rank_fusion(rankings)

    ranked_ids = sorted(
        fused_scores,
        key=lambda chunk_id: fused_scores[chunk_id],
        reverse=True,
    )

    candidate_chunks = [
        chunks_by_id[chunk_id]
        for chunk_id in ranked_ids[:candidate_limit]
    ]

    # 5. Rerank candidates against every search query.
    chunks = []

    if candidate_chunks:

        chunk_scores = {
            chunk["chunk_id"]: []
            for chunk in candidate_chunks
        }

        for search_query in search_queries:

            pairs = [
                (search_query, _format_chunk(chunk))
                for chunk in candidate_chunks
            ]

            scores = reranker.predict(pairs)

            for chunk, score in zip(candidate_chunks, scores):
                chunk_scores[chunk["chunk_id"]].append(
                    float(score)
                )

        # Keep the strongest relevance score for each chunk.
        for chunk in candidate_chunks:
            chunk["reranker_score"] = max(
                chunk_scores[chunk["chunk_id"]]
            )

        chunks = sorted(
            candidate_chunks,
            key=lambda chunk: chunk["reranker_score"],
            reverse=True,
        )[:top_k]
    
    # 6. Load graph relationships for the selected paper.
    graph = load_graph(user_id, paper_id)

    unique_relationships = []
    seen_relationships = set()

    if graph is not None:
        for source, target, data in graph.edges(data=True):

            try:
                evidence_records = json.loads(
                    data.get("evidence_records", "[]")
                )
            except (json.JSONDecodeError, TypeError):
                evidence_records = []

            # Support older graph edges without evidence_records.
            if not evidence_records:
                evidence_records = [{
                    "relation": data.get("relation", "related to"),
                    "evidence": data.get("evidence", ""),
                    "section": data.get("section", "Unknown"),
                    "page_start": data.get("page_start", "Unknown"),
                    "page_end": data.get("page_end", "Unknown"),
                }]

            for record in evidence_records:
                if not isinstance(record, dict):
                    continue

                item = {
                    "source": source,
                    "relation": record.get(
                        "relation",
                        data.get("relation", "related to"),
                    ),
                    "target": target,
                    "evidence": record.get("evidence", ""),
                    "section": record.get("section", "Unknown"),
                    "page_start": record.get("page_start", "Unknown"),
                    "page_end": record.get("page_end", "Unknown"),
                }

                key = (
                    item["source"],
                    item["relation"],
                    item["target"],
                    item["evidence"],
                    item["section"],
                    item["page_start"],
                    item["page_end"],
                )

                if key not in seen_relationships:
                    seen_relationships.add(key)
                    unique_relationships.append(item)

    # 7. Rank relationships against the question.
    relationships = []

    if unique_relationships:
        relationship_pairs = [
            (
                question,
                (
                    f"Relationship: {item['source']} "
                    f"{item['relation']} {item['target']}\n"
                    f"Evidence: {item['evidence']}\n"
                    f"Section: {item['section']}\n"
                    f"Pages: {item['page_start']}-"
                    f"{item['page_end']}"
                ),
            )
            for item in unique_relationships
        ]

        scores = reranker.predict(relationship_pairs)

        ranked_relationships = sorted(
            zip(scores, unique_relationships),
            key=lambda pair: float(pair[0]),
            reverse=True,
        )

        for score, item in ranked_relationships[:top_k]:
            relationships.append({
                **item,
                "relevance_score": float(score),
            })

    # 8. Normalize section names for citations.
    for chunk in chunks:
        chunk["section"] = clean_section_name(chunk["section"])

    for item in relationships:
        item["section"] = clean_section_name(item["section"])

    return {
        "chunks": chunks,
        "relationships": relationships,
    }

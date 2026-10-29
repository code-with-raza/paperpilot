# Project Decisions

Short record of the main technical choices for PaperPilot.

| Area | Decision | Reason |
|---|---|---|
| PDF extraction | PyMuPDF4LLM | Extract paper text in a structure suitable for chunking. |
| Embeddings | Sentence Transformers | Convert text into numeric vectors for semantic search. |
| Vector database | ChromaDB | Store chunk embeddings and search them locally during development. |
| Keyword search | BM25 | Find relevant text when the question shares important words with the paper. |
| Hybrid retrieval | Vector search + BM25 + Reciprocal Rank Fusion (RRF) | Combine semantic and keyword results. |
| Reranking | CrossEncoder | Re-score retrieved question-and-chunk pairs for relevance. |
| Knowledge graph | NetworkX | Represent extracted entities and their relationships as a graph. |
| Answer generation | Groq API | Generate responses from retrieved paper evidence. |
| Citations | Section and page metadata on chunks | Help users trace answers back to the paper. |

## Current Principle

Prefer general retrieval improvements over question-specific hardcoded rules. Keep answers grounded in the selected paper and avoid inventing facts or citations.

These decisions may change as testing and evaluation provide evidence for a better approach.

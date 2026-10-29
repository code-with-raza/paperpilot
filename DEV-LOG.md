# Development Log

## Current Progress

- PDF section detection and chunking are implemented.
- Chunk metadata includes section and page information.
- Sentence Transformer embeddings are used for chunks and questions.
- ChromaDB stores chunks and supports filtered vector search.
- BM25 keyword retrieval and vector retrieval are combined in the retriever.
- Reciprocal Rank Fusion (RRF) and CrossEncoder reranking are part of the retrieval approach.
- A NetworkX graph is used to represent extracted relationships.
- Groq is used for answer generation.

## Testing Notes

- A sample paper produced 9 detected sections and 10 chunks in the current local test.
- Chunks were stored in ChromaDB and vector search returned results.
- Retrieval and answer quality are still being tested.
- Known areas to improve include retrieving the most relevant evidence for some questions, preserving the paper's meaning, and ensuring citations accurately support each claim.

## Next Steps

1. Test different question types against the same paper.
2. Check retrieval results before evaluating generated answers.
3. Verify every citation against the original section and page.
4. Improve unsupported-answer handling.
5. Add clear installation and run instructions after the project setup is finalized.

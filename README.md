# PaperPilot

PaperPilot is a research-paper Q&A project. It lets users ask questions about a paper and aims to answer using relevant paper content with section and page citations.

## Current Approach

- **PDF processing:** Extract text and organize it into sections and chunks.
- **Embeddings:** Convert chunks and questions into vectors using Sentence Transformers.
- **Vector search:** Store and retrieve chunks with ChromaDB.
- **Hybrid retrieval:** Combine vector search with BM25 keyword search.
- **Reranking:** Use a CrossEncoder to reorder relevant chunks.
- **Knowledge graph:** Use NetworkX to store relationships extracted from paper text.
- **Answer generation:** Use the Groq API to generate answers grounded in retrieved evidence.

## Project Status

The backend is under development and testing. Retrieval accuracy, citation quality, and answer faithfulness are still being improved.

## Backend Setup

1. Create and activate a Python virtual environment.
2. Install the packages required by the project.
3. Add your Groq API key as `GROQ_API_KEY` in a local `.env` file.
4. Run the backend using the project's entry point.

Exact install and run commands should be added once the dependency file and API entry point are finalized.

## Important

- Do not commit `.env`, API keys, uploaded private papers, virtual environments, or local vector-store data.
- Answers should use evidence from the selected paper and cite the relevant section and page.
- If the answer is not supported by the paper, the system should say it could not find the answer in the provided paper.

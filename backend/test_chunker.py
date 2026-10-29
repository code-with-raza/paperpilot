
from pathlib import Path

import tiktoken

from Graph_Rag.chunker import detect_sections, chunk_section

PDF_PATH = Path("test_paper.pdf")
PAPER_ID = "test_paper_001"

# 1. Check that the PDF exists
if not PDF_PATH.exists():
    raise FileNotFoundError(f"PDF not found: {PDF_PATH.resolve()}")

# 2. Detect sections
sections = detect_sections(str(PDF_PATH))

print("\n========== SECTIONS ==========")
print("Total sections:", len(sections))

for section in sections:
    print(
        f"\nSection: {section['section']}"
        f"\nPages: {section['page_start']} - {section['page_end']}"
        f"\nText length: {len(section['text'])} characters"
        f"\nPreview: {section['text'][:200]!r}"
    )

# 3. Generate chunks
chunks = chunk_section(
    sections,
    paper_id=PAPER_ID,
    chunk_size=700,
    overlap=100,
)


encoding = tiktoken.get_encoding("cl100k_base")

# Find chunks that exceed the configured token limit
print("\n========== TOKEN LIMIT CHECK ==========")

for chunk in chunks:
    token_count = len(encoding.encode(chunk["text"]))

    if token_count > 700:
        print(
            f"Chunk index: {chunk['chunk_index']}"
            f"\nSection: {chunk['section']}"
            f"\nToken count: {token_count}"
            f"\nPage range: {chunk['page_start']} - {chunk['page_end']}"
        )

print("\nToken limit diagnostic complete.")


# 4. Basic validation
assert all(chunk["paper_id"] == PAPER_ID for chunk in chunks)
assert all(chunk["text"].strip() for chunk in chunks)
assert all(
    len(encoding.encode(chunk["text"])) <= 700
    for chunk in chunks
)
assert all(
    chunk["chunk_index"] == i
    for i, chunk in enumerate(chunks)
)

print("\nBasic validation passed!")

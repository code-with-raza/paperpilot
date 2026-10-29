## Split text into manageable chunks
import pymupdf.layout
import pymupdf4llm
import tiktoken
import re

encoding=tiktoken.get_encoding("cl100k_base")
def detect_sections(pdf_path):
    page_chunks=pymupdf4llm.to_markdown(
        pdf_path,
        page_chunks=True
    )
    
    sections=[]
    current_section="Introduction"
    for page in page_chunks:
        page_number=page["metadata"] ["page_number"]
        page_text=page["text"]

        for box in page["page_boxes"]:
            start, end=box["pos"]
            text=page_text[start:end].strip()

            if box["class"] in ("section-header","title"):
                current_section=text
                sections.append(
                    {
                    "section":current_section,
                    "page_start":page_number,
                    "page_end":page_number,
                    "page_texts":{page_number:""},
                    "text":""
                    })

            elif text and sections:
                sections[-1]["text"]+= text +"\n"
                sections[-1]["page_end"]=page_number
                sections[-1]["page_texts"].setdefault(page_number,"")
                sections[-1]["page_texts"][page_number]+=text + "\n"
    
    return sections
                                                    

                


def chunk_section(sections, paper_id, chunk_size=700, overlap=100):
    chunks = []
    chunk_index = 0

    for section in sections:
        tokens = []
        tokens_pages = []

        # Collect tokens and their page numbers
        for page_number, page_text in sorted(section["page_texts"].items()):
            page_tokens = encoding.encode(page_text)
            tokens.extend(page_tokens)
            tokens_pages.extend([page_number] * len(page_tokens))

        if not tokens:
            continue

        start = 0

        while start < len(tokens):
            # Leave a small margin for tokenization differences
            end = min(start + chunk_size - 10, len(tokens))

            chunk_tokens = tokens[start:end]
            chunk_text = encoding.decode(chunk_tokens).strip()

            # Find the pages covered by this chunk
            while len(encoding.encode(chunk_text)) > chunk_size and end > start + 1:
                end -= 1
                chunk_tokens = tokens[start:end]
                chunk_text = encoding.decode(chunk_tokens).strip()

            if chunk_text:
                chunk_page_numbers = tokens_pages[start:end]

                chunks.append({
                    "chunk_id":f"{paper_id}_chunk_{chunk_index}",
                    "paper_id": paper_id,
                    "section": section["section"],
                    "page_start": min(chunk_page_numbers),
                    "page_end": max(chunk_page_numbers),
                    "chunk_index": chunk_index,
                    "text": chunk_text
                })

                chunk_index += 1

            if end >= len(tokens):
                break

            
            start = end - overlap

    return chunks

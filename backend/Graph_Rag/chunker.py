
## Split text into manageable chunks

import pymupdf.layout
import pymupdf4llm
import tiktoken
import re

encoding = tiktoken.get_encoding("cl100k_base")


def detect_sections(pdf_path):
    """Extract PDF text and organize it into sections with page information."""

    page_chunks = pymupdf4llm.to_markdown(
        pdf_path,
        page_chunks=True
    )

    sections = []
    front_matter = {
        "section": "Front Matter",
        "page_start": None,
        "page_end": None,
        "page_texts": {},
        "text": ""
    }

    common_sections = {
        "abstract", "introduction", "background",
        "related work", "literature review", "method",
        "methods", "methodology", "materials and methods",
        "results", "discussion", "conclusion",
        "references", "acknowledgements", "acknowledgments",
        "appendix"
    }

    for page in page_chunks:
        page_number = page["metadata"]["page_number"]
        page_text = page["text"]

        for box in page["page_boxes"]:
            start, end = box["pos"]
            text = page_text[start:end].strip()

            if not text:
                continue

            # Skip the document title; it is not section body text.
            if box["class"] == "title":
                continue

            if box["class"] == "section-header":
                heading = re.sub(r"^#+\s*", "", text).strip()
                heading = heading.strip("* ").strip()
                normalized = heading.lower().rstrip(".")

                numbered_heading = bool(
                    re.match(r"^\d+(?:\.\d+)*\.?\s+\S", heading)
                )

                is_known_section = (
                    normalized in common_sections
                    or numbered_heading
                )

                # Before the first recognized section, collect author,
                # affiliation, and other introductory information.
                if not sections and not is_known_section:
                    if front_matter["page_start"] is None:
                        front_matter["page_start"] = page_number

                    front_matter["page_end"] = page_number
                    front_matter["text"] += text + "\n"
                    front_matter["page_texts"].setdefault(page_number, "")
                    front_matter["page_texts"][page_number] += text + "\n"
                    continue

                if front_matter["text"].strip():
                    sections.append(front_matter)
                    front_matter = {
                        "section": "Front Matter",
                        "page_start": None,
                        "page_end": None,
                        "page_texts": {},
                        "text": ""
                    }

                # Preserve every heading recognized as a section.
                sections.append({
                    "section": heading,
                    "page_start": page_number,
                    "page_end": page_number,
                    "page_texts": {page_number: ""},
                    "text": ""
                })
                continue

            # Preserve regular text before the first section heading.
            if not sections:
                if front_matter["page_start"] is None:
                    front_matter["page_start"] = page_number

                front_matter["page_end"] = page_number
                front_matter["text"] += text + "\n"
                front_matter["page_texts"].setdefault(page_number, "")
                front_matter["page_texts"][page_number] += text + "\n"
                continue

            current = sections[-1]
            current["text"] += text + "\n"
            current["page_end"] = page_number
            current["page_texts"].setdefault(page_number, "")
            current["page_texts"][page_number] += text + "\n"

    if front_matter["text"].strip():
        sections.insert(0, front_matter)

    return sections



def chunk_section(sections, paper_id, chunk_size=700, overlap=100):
    """Split sections into chunks while preserving page information."""

    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than zero")

    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("overlap must be smaller than chunk_size")

    chunks = []
    chunk_index = 0

    for section in sections:
        tokens = []
        token_pages = []

        # Convert each page's text into tokens and track their pages.
        for page_number, page_text in sorted(section["page_texts"].items()):
            page_tokens = encoding.encode(page_text)
            tokens.extend(page_tokens)
            token_pages.extend([page_number] * len(page_tokens))

        if not tokens:
            continue

        start = 0

        while start < len(tokens):
            end = min(start + chunk_size, len(tokens))

            # Decode the selected tokens into readable text.
            chunk_text = encoding.decode(tokens[start:end]).strip()

            if chunk_text:
                pages = token_pages[start:end]

                chunks.append({
                    "chunk_id": f"{paper_id}_chunk_{chunk_index}",
                    "paper_id": paper_id,
                    "section": section["section"],
                    "page_start": min(pages),
                    "page_end": max(pages),
                    "chunk_index": chunk_index,
                    "text": chunk_text
                })

                chunk_index += 1

            if end == len(tokens):
                break

            # Start the next chunk before the previous one ends.
            start = end - overlap

    return chunks

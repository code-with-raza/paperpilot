
## Generate evidence-grounded answers with citations

import re
import json
import os

from dotenv import load_dotenv
from groq import Groq

from Graph_Rag.retriever import retrieve_information


load_dotenv()
MIN_CONFIDENCE = 70
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

MODEL = "openai/gpt-oss-120b"

UNRELATED_MESSAGE = (
    "Your question doesn't appear to be related to "
    "the research paper you uploaded."
)

NOT_FOUND_MESSAGE = (
    "I couldn't find the answer to your question "
    "in the provided paper."
)


def clean_section_name(section):
    """Remove Markdown formatting from a section name."""
    section = re.sub(r"^#+\s*", "", section or "")
    section = section.replace("*", "")
    return section.strip() or "Unknown"




def calculate_confidence(answer, chunks):
    """Estimate evidence support and explain confidence-check failures."""

    if not answer or not chunks:
        return None, "No answer or evidence was provided."

    # Collect valid section and page citations.
    valid_citations = set()

    for chunk in chunks:
        section = clean_section_name(chunk.get("section"))
        page_start = chunk.get("page_start", "Unknown")
        page_end = chunk.get("page_end", page_start)

        pages = (
            str(page_start)
            if page_start == page_end
            else f"{page_start}-{page_end}"
        )

        citation = (
            f"Section: {section}, "
            f"Page{'s' if '-' in pages else ''}: {pages}"
        )

        valid_citations.add(citation)

    # Check citations displayed in the answer.
    displayed_citations = [
        line.strip()
        for line in answer.splitlines()
        if line.strip().startswith("Section:")
    ]

    if not displayed_citations:
        return 0, "The answer contains no recognizable section citations."

    citation_score = round(
        100 * sum(
            citation in valid_citations
            for citation in displayed_citations
        ) / len(displayed_citations)
    )

    evidence = "\n\n".join(
        f"Section: {clean_section_name(chunk.get('section'))}\n"
        f"Pages: {chunk.get('page_start', 'Unknown')}-"
        f"{chunk.get('page_end', chunk.get('page_start', 'Unknown'))}\n"
        f"Text: {chunk.get('text', '')}"
        for chunk in chunks
    )

    prompt = f"""
Evaluate how strongly the paper evidence supports the answer.

Return only one integer from 0 to 100.
Do not return JSON, explanations, or Markdown.

100 = All factual claims are supported by the evidence.
80 = The answer is well supported with minor gaps.
60 = Some claims lack evidence.
30 = Most claims are unsupported.
0 = No claims are supported.

PAPER EVIDENCE:
{evidence}

ANSWER:
{answer}
"""

    try:
        response = client.chat.completions.create(
            model=MODEL,
            temperature=0,
            max_completion_tokens=300,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Evaluate the answer using only the supplied "
                        "paper evidence. Return one integer from 0 to 100."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        )

        choice = response.choices[0]
        content = (choice.message.content or "").strip()

        print("Confidence model response:", repr(content))
        print("Confidence finish reason:", choice.finish_reason)

        # The model may use its token budget for reasoning
        # without producing the requested numeric score.
        if not content:
            print("Confidence model returned no score; using citation score.")
            return citation_score, None

        # Accept only a plain integer from 0 through 100.
        if not content.isdigit():
             print("Invalid confidence response; using citation score.")
             return citation_score,None

        support_score = int(content)

        if not 0 <= support_score <= 100:
            return None, f"Confidence score is outside 0-100: {support_score}"

        final_score = round(
            0.8 * support_score + 0.2 * citation_score
        )

        return final_score, None

    except Exception as error:
        print(f"Confidence API failed; using citation score: {error}")
        return citation_score,None

def generate_answer(question, retrieved_chunks, relationships=None):
    """Generate an evidence-grounded answer with direct citations."""

    if not retrieved_chunks:
        return NOT_FOUND_MESSAGE

    sources = {}
    evidence = []

    for index, chunk in enumerate(retrieved_chunks, start=1):
        label = f"[{index}]"

        page_start = chunk.get("page_start", "Unknown")
        page_end = chunk.get("page_end", page_start)

        pages = (
            str(page_start)
            if page_start == page_end
            else f"{page_start}-{page_end}"
        )

        sources[label] = {
            "section": clean_section_name(chunk.get("section")),
            "pages": pages,
            "text": chunk.get("text", ""),
        }

        evidence.append(
            f"Source label: {label}\n"
            f"Section: {sources[label]['section']}\n"
            f"Pages: {pages}\n"
            f"Text: {sources[label]['text']}"
        )

    graph_evidence = "\n".join(
        f"{item.get('source', '')} "
        f"{item.get('relation', 'related to')} "
        f"{item.get('target', '')}"
        for item in (relationships or [])
    )

    system_prompt = """
You answer questions using only evidence from a research paper.

Return one valid JSON object with exactly these keys:
- "status": "answered", "unrelated", or "not_found"
- "claims": a list of objects containing "text" and "sources"

Rules:
1. Answer in clear, simple language.
2. Every factual claim must be supported by the provided PDF text.
3. Each claim's "sources" must contain valid source labels from the evidence.
4. Never invent facts, citations, section names, or page numbers.
5. Graph relationships may help locate evidence, but are not proof by themselves.
6. If the user asks what the paper is about, for its purpose, or for a summary,
   give a concise overview based on the available evidence.
7. For general overview questions, use relevant abstract and introduction
   evidence when it is provided. Do not invent missing details.
8. If the question is unrelated to the paper's subject, use "unrelated".
9. If the question concerns the paper but the evidence does not answer it,
   use "not_found".
10. For "unrelated" and "not_found", return an empty claims list.
11. Do not classify a question as unrelated merely because its answer is missing.
12. Do not answer using your general knowledge.
13. Every factual claim must cite at least one supporting source label.
14. Keep the answer concise and address all parts that the evidence supports.
15. Return JSON only, without Markdown fences.

Example:
{
  "status": "answered",
  "claims": [
    {
      "text": "The paper investigates how students define computer science.",
      "sources": ["[1]"]
    }
  ]
}
"""

    try:
        response = client.chat.completions.create(
            model=MODEL,
            temperature=0,
            max_completion_tokens=1200,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": (
                        f"Question:\n{question}\n\n"
                        f"PDF evidence:\n{chr(10).join(evidence)}\n\n"
                        f"Graph relationships for retrieval assistance only:\n"
                        f"{graph_evidence}"
                    ),
                },
            ],
        )

        content = response.choices[0].message.content

        if not content:
            return NOT_FOUND_MESSAGE

        result = json.loads(content)

        status = result.get("status")
        claims = result.get("claims")

        if status == "unrelated":
            return UNRELATED_MESSAGE

        if status != "answered" or not isinstance(claims, list):
            return NOT_FOUND_MESSAGE

        if not claims:
            return NOT_FOUND_MESSAGE

        answer_parts = []
        used_sources = []

        for claim in claims:
            if not isinstance(claim, dict):
                return NOT_FOUND_MESSAGE

            text = claim.get("text")
            labels = claim.get("sources")

            if (
                not isinstance(text, str)
                or not text.strip()
                or not isinstance(labels, list)
                or not labels
            ):
                return NOT_FOUND_MESSAGE

            if any(
                not isinstance(label, str) or label not in sources
                for label in labels
            ):
                return NOT_FOUND_MESSAGE

            # Keep labels internally for mapping, but don't show them to users.
            unique_labels = list(dict.fromkeys(labels))
            answer_parts.append(text.strip())

            for label in unique_labels:
                if label not in used_sources:
                    used_sources.append(label)

        # Display actual section and page metadata, not model-generated details.
        citation_details = []

        for label in used_sources:
            source = sources[label]
            citation = (
                f"Section: {source['section']}, "
                f"Page{'s' if '-' in source['pages'] else ''}: "
                f"{source['pages']}"
            )

            if citation not in citation_details:
                citation_details.append(citation)

        return (
            "\n\n".join(answer_parts)
            + "\n\n"
            + "\n".join(citation_details)
        )

    except (json.JSONDecodeError, TypeError, AttributeError, KeyError):
        return NOT_FOUND_MESSAGE



def ask_paper(question, user_id, paper_id, top_k=5):
    """Retrieve evidence, generate an answer, and check confidence."""

    results = retrieve_information(
        question, user_id, paper_id, top_k
    )

    chunks = results.get("chunks", [])
    relationships = results.get("relationships", [])

    if not chunks:
        return NOT_FOUND_MESSAGE

    answer = generate_answer(
        question, chunks, relationships
    )

    # Preserve the existing refusal behavior.
    if answer in (UNRELATED_MESSAGE, NOT_FOUND_MESSAGE):
        return answer

    confidence, confidence_reason = calculate_confidence(
        answer, chunks
    )

    # Handle a failed confidence check separately from a low score.
    if confidence is None:
        print(f"Confidence unavailable: {confidence_reason}")

        return (
            f"{answer}\n\n"
            "Evidence confidence: Unavailable\n"
            f"Reason: {confidence_reason}\n"
            "The answer has not been rejected solely because "
            "the confidence check failed. Please verify its "
            "supporting evidence and citations."
        )

    # Reject answers only when a confidence score was actually obtained
    # and it falls below the configured threshold.
    if confidence < MIN_CONFIDENCE:
        return (
            f"{NOT_FOUND_MESSAGE}\n\n"
            f"Evidence confidence: {confidence}/100 "
            f"(minimum required: {MIN_CONFIDENCE}/100)"
        )

    return (
        f"{answer}\n\n"
        f"Evidence confidence: {confidence}/100"
    )

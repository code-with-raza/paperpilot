"""Generate answers using paper evidence and long-term conversation memories."""

import json
import os
import re

from dotenv import load_dotenv
from groq import Groq, RateLimitError
from openai import OpenAI

from Graph_Rag.retriever import retrieve_information

load_dotenv()

MODEL = "openai/gpt-oss-120b"
MIN_CONFIDENCE = 70

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

openrouter_client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
)

NOT_FOUND_MESSAGE = (
    "I couldn't find the answer to your question "
    "in the provided paper."
)

MEMORY_NOT_FOUND_MESSAGE = (
    "I couldn't find relevant information in your previous conversations."
)

CLARIFICATION_PREFIX = "Clarification needed: "


def clean_section_name(section):
    """Remove Markdown formatting from section names."""

    section = re.sub(r"^#+\s*", "", section or "")
    section = section.replace("*", "")
    section = section.replace("<u>", "").replace("</u>", "")

    return section.strip() or "Unknown"


def format_pages(page_start, page_end):
    """Format a page range for citations."""

    if page_end is None:
        page_end = page_start

    if str(page_start) == str(page_end):
        return str(page_start)

    return f"{page_start}-{page_end}"


def calculate_confidence(answer, chunks, relationships=None):
    """Check whether paper citations match retrieved evidence."""

    if not answer or (not chunks and not relationships):
        return 0, "No answer or evidence available."

    valid_citations = set()

    for item in chunks:
        section = clean_section_name(item.get("section"))
        pages = format_pages(
            item.get("page_start", "Unknown"),
            item.get("page_end"),
        )

        valid_citations.add(
            f"Section: {section}, Page: {pages}"
        )

    for item in relationships or []:
        section = clean_section_name(item.get("section"))
        pages = format_pages(
            item.get("page_start", "Unknown"),
            item.get("page_end"),
        )

        valid_citations.add(
            f"Section: {section}, Page: {pages}"
        )

    cited_lines = [
        line.strip()
        for line in answer.splitlines()
        if line.strip().startswith("Section:")
    ]

    if not cited_lines:
        return 0, "No paper citations were found."

    valid_count = sum(
        citation in valid_citations
        for citation in cited_lines
    )

    return round(100 * valid_count / len(cited_lines)), None


def generate_answer(
    question,
    retrieved_chunks,
    relationships=None,
    conversation_history=None,
    retrieved_memories=None,
):
    """Generate an answer using paper evidence and conversation memories."""

    retrieved_chunks = retrieved_chunks or []
    relationships = relationships or []
    retrieved_memories = retrieved_memories or []

    history = []

    for message in (conversation_history or [])[-10:]:
        role = message.get("role")
        content = message.get("content", "")

        if role in ("user", "assistant") and content:
            history.append(f"{role.capitalize()}: {content}")

    history_text = (
        "\n".join(history)
        if history
        else "No previous messages."
    )

    if not retrieved_chunks and not relationships and not retrieved_memories:
        return NOT_FOUND_MESSAGE

    sources = {}
    evidence = []

    # Prepare paper chunk sources.
    for index, chunk in enumerate(retrieved_chunks, start=1):
        label = f"[{index}]"

        page_start = chunk.get("page_start", "Unknown")
        page_end = chunk.get("page_end", page_start)
        pages = format_pages(page_start, page_end)

        source_text = chunk.get("text", "")

        sources[label] = {
            "section": clean_section_name(chunk.get("section")),
            "pages": pages,
            "text": source_text,
            "type": "paper",
        }

        evidence.append(
            f"Source label: {label}\n"
            f"Section: {sources[label]['section']}\n"
            f"Pages: {pages}\n"
            f"Text: {source_text}"
        )

    # Prepare graph relationships.
    graph_evidence = []

    for index, item in enumerate(
        relationships,
        start=len(sources) + 1,
    ):
        label = f"[{index}]"

        page_start = item.get("page_start", "Unknown")
        page_end = item.get("page_end", page_start)
        pages = format_pages(page_start, page_end)

        section = clean_section_name(item.get("section"))
        quote = item.get("evidence", "").strip()

        sources[label] = {
            "section": section,
            "pages": pages,
            "text": quote,
            "type": "paper",
        }

        graph_evidence.append(
            f"Source label: {label}\n"
            f"Relationship: {item.get('source', '')} "
            f"{item.get('relation', 'related to')} "
            f"{item.get('target', '')}\n"
            f"Evidence: {quote}\n"
            f"Section: {section}\n"
            f"Pages: {pages}"
        )

    # Prepare long-term conversation memories.
    memory_sources = {}
    memory_evidence = []

    for index, memory in enumerate(retrieved_memories, start=1):
        if not isinstance(memory, dict):
            continue

        memory_text = memory.get("text", "")

        if not isinstance(memory_text, str) or not memory_text.strip():
            continue

        label = f"M{index}"

        memory_sources[label] = {
            "created_at": memory.get("created_at"),
            "conversation_id": memory.get("conversation_id"),
            "text": memory_text.strip(),
        }

        memory_evidence.append(
            f"Memory label: {label}\n"
            f"Previous conversation:\n{memory_text.strip()}"
        )

    system_prompt = """
You are PaperPilot, an assistant that can answer questions using
uploaded paper evidence and the user's previous conversations.

Return one valid JSON object with exactly these keys:

{
    "status": "answered",
    "claims": [
        {
            "text": "A factual statement.",
            "sources": ["[1]"],
            "memories": ["M1"]
        }
    ],
    "clarification_question": ""
}

VALID STATUSES:
- "answered"
- "not_found"
- "clarification"

EVIDENCE TYPES:

1. PAPER EVIDENCE:
- Paper sources use labels such as [1] and [2].
- Use paper sources to answer questions about uploaded documents.
- Every paper-based factual claim must cite valid paper source labels.
- Graph relationships are retrieval assistance only.
- Graph relationships are not proof by themselves.
- Never invent section names or page numbers.

2. CONVERSATION MEMORIES:
- Memory sources use labels such as M1 and M2.
- Memories contain information from the user's previous conversations.
- Use memories to answer questions about previous discussions,
  decisions, preferences, and ongoing work.
- Every memory-based factual claim must cite valid memory labels.
- Never present a conversation memory as evidence from an uploaded paper.
- Never invent details that are not present in the memories.

3. KEEP EVIDENCE SEPARATE:
- Paper evidence and conversation memories are different sources.
- Use paper evidence for claims about what a paper contains.
- Use memories for claims about what the user previously discussed.
- Do not use conversation memories to prove claims about a paper.
- Do not use conversation history as factual evidence.

4. CONVERSATION HISTORY:
- Use recent conversation history only to understand follow-up questions
  and references to the current discussion.
- It is not an evidence source.
- Do not cite conversation history.

UNDERSTANDING QUESTIONS:
- Accept informal language, spelling mistakes, and short questions.
- Understand the intended meaning of the user's question.
- Do not reject a question simply because it is broad.
- If the question has materially different possible meanings,
  ask for clarification.

ANSWERING:
- Answer only when the supplied evidence supports the claims.
- Answer partially when only part of the question is supported.
- Every factual claim must have at least one valid paper source
  or memory source.
- A claim may use both types when both genuinely support it.
- Do not invent facts or fill gaps with general knowledge.

OUTPUT RULES:
- Return JSON only, without Markdown fences.
- For "answered", provide a non-empty claims list.
- Every claim must contain non-empty text.
- Every claim must contain valid source labels in "sources",
  valid memory labels in "memories", or both.
- Use an empty list when a claim does not use that evidence type.
- For "not_found", return an empty claims list.
- For "clarification", return an empty claims list and
  a non-empty clarification_question.
- For "answered", clarification_question must be empty.
"""

    user_prompt = (
        f"Conversation history:\n{history_text}\n\n"
        f"Current question:\n{question}\n\n"
        f"Paper evidence:\n"
        f"{chr(10).join(evidence) or 'No paper chunks retrieved.'}\n\n"
        f"Graph relationships (retrieval assistance only):\n"
        f"{chr(10).join(graph_evidence) or 'No graph relationships retrieved.'}\n\n"
        f"Long-term conversation memories:\n"
        f"{chr(10).join(memory_evidence) or 'No relevant memories retrieved.'}"
    )

    messages = [
        {
            "role": "system",
            "content": system_prompt,
        },
        {
            "role": "user",
            "content": user_prompt,
        },
    ]

    try:
        # Try Groq first.
        try:
            response = client.chat.completions.create(
                model=MODEL,
                temperature=0,
                max_completion_tokens=1500,
                response_format={"type": "json_object"},
                messages=messages,
            )

        # Use OpenRouter if Groq reaches its rate limit.
        except RateLimitError:
            print(
                "Groq rate limit reached. "
                "Switching to OpenRouter..."
            )

            response = openrouter_client.chat.completions.create(
                model="openrouter/free",
                temperature=0,
                max_tokens=4096,
                messages=messages,
            )

        content = response.choices[0].message.content

        if not content:
            print("The model returned an empty answer.")
            return NOT_FOUND_MESSAGE

        result = json.loads(content)

        status = result.get("status")
        claims = result.get("claims")

        if status == "not_found":
            return NOT_FOUND_MESSAGE

        if status == "clarification":
            clarification = result.get("clarification_question", "")

            if isinstance(clarification, str) and clarification.strip():
                return CLARIFICATION_PREFIX + clarification.strip()

            return (
                CLARIFICATION_PREFIX
                + "Could you clarify what you mean?"
            )

        if status != "answered":
            return NOT_FOUND_MESSAGE

        if not isinstance(claims, list) or not claims:
            return NOT_FOUND_MESSAGE

        answer_parts = []
        used_paper_labels = set()
        used_memory_labels = set()

        # Validate every claim's evidence labels.
        for claim in claims:
            if not isinstance(claim, dict):
                continue

            claim_text = claim.get("text")
            claim_sources = claim.get("sources", [])
            claim_memories = claim.get("memories", [])

            if (
                not isinstance(claim_text, str)
                or not claim_text.strip()
            ):
                continue

            if not isinstance(claim_sources, list):
                continue

            if not isinstance(claim_memories, list):
                continue

            valid_sources = list(dict.fromkeys(
                label
                for label in claim_sources
                if isinstance(label, str) and label in sources
            ))

            valid_memories = list(dict.fromkeys(
                label
                for label in claim_memories
                if isinstance(label, str) and label in memory_sources
            ))

            if not valid_sources and not valid_memories:
                continue

            answer_parts.append(
                claim_text.strip()
                + (
                    " " + " ".join(valid_sources)
                    if valid_sources
                    else ""
                )
            )

            used_paper_labels.update(valid_sources)
            used_memory_labels.update(valid_memories)

        if not answer_parts:
            return NOT_FOUND_MESSAGE

        # Build paper citations from actual retrieved metadata.
        for label in sorted(
            used_paper_labels,
            key=lambda value: int(value.strip("[]")),
        ):
            source = sources[label]

            answer_parts.append(
                f"\nSection: {source['section']}, "
                f"Page: {source['pages']}"
            )

        # Attribute memory-based claims to previous conversations.
        for label in sorted(
            used_memory_labels,
            key=lambda value: int(value[1:]),
        ):
            memory = memory_sources[label]
            created_at = memory.get("created_at")

            if isinstance(created_at, str) and created_at:
                date = created_at.split("T")[0]
                attribution = f"Previous conversation ({date})"
            else:
                attribution = "Previous conversation"

            answer_parts.append(
                f"\nMemory: {attribution}"
            )

        return "\n\n".join(answer_parts)

    except json.JSONDecodeError as error:
        print("Invalid JSON returned by the model:", error)
        return NOT_FOUND_MESSAGE

    except Exception as error:
        print("Answer generation failed:", repr(error))
        return NOT_FOUND_MESSAGE


def ask_paper(
    question,
    user_id,
    paper_id=None,
    top_k=5,
    conversation_history=None,
    retrieved_memories=None,
):
    """Retrieve paper evidence and generate an answer."""

    try:
        results = {
            "chunks": [],
            "relationships": [],
        }

        # Retrieve paper evidence only when a paper is selected.
        if paper_id:
            results = retrieve_information(
                question,
                user_id,
                paper_id,
                top_k=top_k,
            )

        retrieved_chunks = results.get("chunks", [])
        relationships = results.get("relationships", [])

        answer = generate_answer(
            question=question,
            retrieved_chunks=retrieved_chunks,
            relationships=relationships,
            conversation_history=conversation_history,
            retrieved_memories=retrieved_memories,
        )

        if answer in (NOT_FOUND_MESSAGE, MEMORY_NOT_FOUND_MESSAGE):
            if not paper_id:
                return MEMORY_NOT_FOUND_MESSAGE

            return answer

        if answer.startswith(CLARIFICATION_PREFIX):
            return answer

        # Only calculate confidence when paper evidence was retrieved.
        # Memory-only answers do not receive a paper confidence score.
        if not retrieved_chunks and not relationships:
            return answer

        confidence, reason = calculate_confidence(
            answer,
            retrieved_chunks,
            relationships,
        )

        if reason:
            print("Citation confidence unavailable:", reason)
            return answer

        print("Confidence Score:", confidence)

        return (
            f"{answer}\n\n"
            f"Confidence Score: {confidence}/100"
        )

    except Exception as error:
        print("Paper question failed:", repr(error))

        if not paper_id:
            return MEMORY_NOT_FOUND_MESSAGE

        return NOT_FOUND_MESSAGE
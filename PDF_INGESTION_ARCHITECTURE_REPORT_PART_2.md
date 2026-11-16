# PaperPilot: PDF Ingestion Architecture Report - Part 2

**Reliability, multi-tenancy, dependency map, problems, and recommendations**

**Source review date:** 4 November 2026 (Asia/Karachi)  
**Project root:** `F:\paper pilot\project`

Covers original sections 7-14. Section numbers are preserved. For the ingestion stages, diagrams, function hierarchy, provider calls, and investigation scope, see Part 1. Findings and recommendations are retained from the original read-only source review; this split introduces no code changes.

[Read Part 1](PDF_INGESTION_ARCHITECTURE_REPORT_PART_1.md) | [Original complete report](PDF_INGESTION_ARCHITECTURE_REPORT.md)

## 7. Failure, crash, and recovery behavior

### 7.1 Failure matrix

| Failure point | What remains | Status/response in ordinary path |
|---|---|---|
| Authentication missing/invalid | No new ingestion work | HTTP 401 from auth dependency. |
| Invalid upload suffix | No paper registration | HTTP 400. |
| Malformed/missing multipart body or URL JSON shape | No valid route execution | FastAPI validation response, normally HTTP 422. |
| Upload copy or registry insert fails | Possibly partial file; paper row may not exist | Wrapper attempts PDF deletion and best-effort `failed`; HTTP 500. |
| Text extraction fails or produces no chunks | Paper row exists; no vector stage yet | PDF deleted, best-effort `failed`; upload 500 / URL import generally 400. |
| Embedding or vector upsert fails | Registry exists; exact vector atomicity/partial write depends on Chroma | PDF deleted and status failure attempted. No app rollback of vectors. |
| Graph/progress load fails | Earlier vector upsert already ran; pre-existing graph/progress may remain | Same ordinary failure cleanup. |
| Both extraction providers fail | Vectors and previously completed graph/progress remain | `RuntimeError` propagates; PDF deleted; status `failed` attempted; upload 500 / import generally 400. |
| Current graph save fails | Prior persisted graph/progress may remain; current in-memory edits can be lost | Ordinary failure handling. |
| Progress save fails after graph replace | Graph can include a chunk not marked complete | Retry will attempt that chunk again. Ordinary failure handling still deletes PDF. |
| Final graph save or ready-status update fails | Considerable or complete processing may already exist | Ordinary failure branch can mark `failed` and delete PDF despite usable data. |
| Process killed mid-ingestion | Last committed stores/checkpoints remain; no cleanup handler runs | Row may stay `processing` indefinitely; no response or startup reconciliation. |
| Process killed after ready commit but before response | Ready row and artifacts may exist | Client cannot know success from the lost response; a new upload allocates a different ID. |

Durability of an individual Chroma operation, crash timing, and filesystem power-loss behavior were not experimentally tested. No cross-store transaction or rollback is implemented in application code.

### 7.2 Exception mismatch in graph extraction

`ingestion.process_paper()` catches:

```python
except RateLimitError:
    break
except BadRequestError:
    continue
```

But `graph_relationship.extract_relationships()` catches provider exceptions internally and raises `RuntimeError` after both fail. JSON/validation failures follow the same wrapper path.

Therefore the ingestion comments/log messages suggesting “stop on rate limit” or “skip on API bad request” do not describe the effective normal provider-failure path. The upload does not normally finish a partial graph gracefully after provider exhaustion.

### 7.3 Cleanup is not fully protected

Upload's `except HTTPException: raise` bypasses its ordinary file/status cleanup. Current `process_paper()` does not intentionally raise HTTPException, so this is an exception-contract asymmetry rather than proof of a common observed failure.

In both wrappers, deleting a PDF is not itself protected against a deletion error. A failing `unlink()` can interrupt the failure-status update and intended response. URL import's HTTPException branch also calls `update_paper_status()` without its own protective try/except. Consequently, even failure recording is not guaranteed.

Raw exception text is included in upload/import error details. That exposes implementation/provider error descriptions to clients; whether any particular error body contains sensitive content was not tested.

### 7.4 What can resume today?

There is **limited graph-level replay support**, not an operational resume workflow:

- If the caller invokes `process_paper()` with the same owner, paper ID, PDF content, compatible chunking, and intact files, stored graph chunk IDs are skipped.
- An upload retry through the public endpoint generates a new paper UUID, so it does not use the old progress set.
- On an ordinary caught ingestion failure the PDF is deleted, removing the original source needed for a straightforward resume.
- On a process crash the PDF may survive and the progress files may be useful, but there is no endpoint/worker/startup scan that resumes it.
- Embedding/vector work is always repeated before graph skip checks.
- If content or chunking changes but IDs are reused, checkpoint IDs can incorrectly suppress new extraction for changed text.
- Graph and progress are not bound by a shared generation/hash. A missing graph paired with existing progress can skip chunks into an empty graph and still report completion when counts match.
- A missing progress file with an existing graph causes repeated extraction. Exact evidence dictionaries are deduplicated, but differently worded model output or relation overwrites prevent a general exactly-once guarantee.

### 7.5 Large-document and concurrency effects

**Confirmed bottlenecks:** all sections/chunks/texts and embedding outputs are retained as whole-document lists; one vector upsert covers the entire document; graph extraction is serial; the full growing GraphML graph and full progress JSON are rewritten after each handled chunk.

If each chunk adds a roughly constant amount of graph data, repeatedly rewriting growing graph contents leads to cumulative work approximately quadratic in the number of processed chunks. This is a growth analysis, not a measured runtime.

The URL branch buffers the whole capped PDF. Upload copy itself streams from the upload file rather than accumulating a second application-level bytearray, but the parser and subsequent data structures still scale with document size. `page_texts` and `text` duplicate section content, and token-page arrays keep one entry per token. Converting vectors to Python lists adds memory overhead.

Chroma receives one unbounded application batch; no application code queries a backend maximum or splits at it. The inspected Chroma package exposes batch-size validation and a backend maximum, but the maximum accepted by this deployment was not queried. A specific failing PDF size/batch threshold is not established.

Multiple users can submit requests, but this is not controlled concurrent ingestion:

- Blocking work in a single async worker can stall other async endpoints while it runs.
- Some synchronous FastAPI routes can run in framework-managed threads; this does not make the ingestion handler parallel.
- Multiple server workers or threads can introduce actual simultaneous processing, shared storage contention, and separate per-process provider preferences.
- Different generated paper UUIDs normally separate PDF/graph targets. Same-paper internal retries have no lease/lock and reuse the same temporary paths.
- Auth/chat SQLite config requests WAL and a 30-second busy timeout. Registry connections use plain `sqlite3.connect(DB_PATH)` without those explicit settings. WAL may apply when both modules open the same initialized database, but it does not make SQLite an unlimited multi-writer store.
- Throughput, supported worker count, and local Chroma multi-process deployment behavior were not load-tested.

## 8. Multi-tenancy verification

| Layer | Owner/paper handling | Verified protection and remaining boundary |
|---|---|---|
| Upload/import endpoints | Owner comes from `get_current_user()`; server generates paper UUID | No client-controlled owner selection in these route signatures. |
| Authentication | JWT subject validated; account reloaded from `users` | Owner is the DB user ID, created as UUID by registration. Secret values were not inspected. |
| Paper registration | `add_paper()` writes owner; `list_papers()` filters owner; `get_paper_for_user()` and updates filter both IDs | Parameterized SQL. Table has no user foreign key, so helper correctness depends on validated callers. |
| Embeddings | Model receives chunk text; no user-specific learned state is changed by these calls | Global model instance is shared; no per-user fine-tuning/cache is implemented. |
| Chroma writes | Each metadata record has both IDs | Shared collection; record key is paper/chunk, not owner/paper/chunk. UUID generation protects normal API uniqueness; lower-level helper does not independently verify ownership of an existing record ID. |
| Chroma reads | `search_chunks()` and `retrieve_information().collection.get()` both use AND filters for owner and paper | No unfiltered fallback found in these retrieval paths. |
| Graph | File path includes owner directory and paper ID | Graph nodes themselves have no owner attributes, relying on separate files. No graph object is global. |
| Progress | Same owner/paper path scheme | No cross-user shared progress set; no content/version binding. |
| PDF download | Registry owner check and resolved-path containment check | Good owner/path checks. Relative upload versus backend-anchored read can break preview when launch CWD differs. |
| Conversation routes | Owner-check conversation, then paper | DB helpers fetch messages by conversation ID alone, but inspected HTTP callers first authorize the conversation. This helper is a trust boundary, not a confirmed HTTP leak. |
| Provider routing | Global `use_openrouter`; global clients and account keys | One user's success/failure changes another user's preferred provider. Shared quota/availability coupling is confirmed; shared prompt history or cross-user evidence mixing was not found. |
| Logs | IDs, retrieved text excerpts and raw generated answer content can be printed | Application logs may contain document-derived data. Their access, retention, and redaction controls were not examined. |
| External providers | Chunk text is transmitted for graph extraction; evidence/history is transmitted for answering | This is an explicit data egress path, separate from tenant filtering. Provider retention policies were not investigated. |

**Conclusion:** No direct cross-user document retrieval leak is confirmed in the inspected owner-checked public paths. There are confirmed shared-resource dependencies and helper-level trust boundaries. It would be inaccurate to equate a shared Chroma collection or global provider preference, by itself, with a demonstrated cross-user data leak.

Path helpers do not validate/sanitize arbitrary user/paper path components themselves. Normal HTTP paths pass server-created IDs after authentication/ownership checks; no path-traversal exploit was established for those routes. Future internal callers must preserve that contract.

## 9. Processing statuses and frontend observability

### 9.1 Actual stored statuses

| Status | Assignment | Meaning actually guaranteed |
|---|---|---|
| `processing` | Registry insert after local file save, before `process_paper()` | The wrapper started processing; not a durable active-job lease or reliable progress indicator. |
| `ready` | Wrapper after `process_paper()` returns | Pipeline returned and status update committed; no independent artifact consistency or graph-quality verification. |
| `failed` | Best-effort update in failure cleanup | A caught failure occurred, if the status write succeeds. Partial vectors/graph may still exist. |

No enum/CHECK constraint restricts the status column. The source assignments in the ingestion wrappers use only those three strings. `queued`, `uploaded`, `parsing`, `embedding`, `completed`, and `partial` are not implemented ingestion transitions.

### 9.2 What the frontend can see

`GET /papers/` returns paper ID, filename, status, and created time through `get_user_papers()`. It does not return graph counts, errors, current stage, attempt number, or heartbeat.

The upload/import success response includes `sections`, `chunks`, `processed_graph_chunks`, and `graph_complete`; `frontend/src/api.ts` does not declare those in `PaperResult`, and `App.tsx` does not display them. JavaScript object spreading can retain extra response properties temporarily; this is not durable or presented partial-state support.

`App.tsx:paperStatus()` knows labels for ready, failed, processing, uploaded, parsing, embedding, and queued. Only three are emitted by the reviewed ingestion wrappers. The UI polls when papers are in a non-ready/non-failed state, but a blocking single-worker ingestion handler can delay those requests.

Therefore:

- Processing versus ready versus failed: distinguishable when the API response is available.
- Fully indexed vectors versus partial vectors: not distinguishable.
- Complete versus partial graph: not durably distinguishable in the library.
- A crashed worker versus a genuinely running paper: not distinguishable from `processing` alone.
- A failure with usable vectors versus no usable data: not distinguishable.
- The original failure cause: not available after refreshing the paper list.

## 10. Complete file inventory and dependency map

### 10.1 Core ingestion files

| Exact project-relative file; important functions | Responsibility and callers | Functions/dependencies called | Input -> output; storage/services |
|---|---|---|---|
| `backend/main.py`: `lifespan():26`, `create_upload_file():111`, `import_pdf_url():161`, `get_papers():61`, `get_paper_pdf():122`, `ask_question():75`; `PDFUrlRequest`, `QuestionRequest` | FastAPI composition, startup and HTTP boundaries; called by FastAPI | Auth dependency; upload/import wrappers; registry ownership lookup; question/list wrappers; DB initializer; FileResponse | Upload/URL + authenticated user -> processing response. Later lists/PDF/chat. Indirect SQLite, Chroma, files and providers. |
| `backend/api/upload.py`: `upload_paper():22`, `import_paper_from_url():77`, `get_pdf_url():189` | Save/download PDFs, register, invoke pipeline, set final status, cleanup. Called by main upload/import routes | `copyfileobj`, UUID, URL parser/regex, `requests.get`; `add_paper`, `update_paper_status`, `process_paper` | UploadFile or URL + user ID -> response dictionary/HTTPException. PDF files, SQLite via registry, publisher/arXiv HTTP. |
| `backend/Graph_Rag/ingestion.py`: `process_paper():20` | Coordinates all processing stages. Called only by the two upload wrappers in the inspected code | Both chunker functions; `embed_chunks`; `store_chunks`; graph/progress loads/saves; `extract_relationships`, `add_relationships` | PDF path + paper/user IDs -> section/chunk/progress counts, complete flag, graph path. Indirect local models, vector/filesystem/provider services. |
| `backend/Graph_Rag/chunker.py`: `detect_sections():12`, `chunk_section():123` | Layout extraction, heuristic sections, token windows/page provenance. Called by ingestion and standalone chunker diagnostic | PyMuPDF layout/PyMuPDF4LLM Markdown; tiktoken; regex | PDF path -> sections; sections + paper ID -> chunk dictionaries. Reads PDF locally; no hosted completion call. |
| `backend/Graph_Rag/embeddings.py`: global `model`, `embed_chunks():10`, `embed_query():46` | Shared local embedding model. Called by ingestion and retriever | SentenceTransformer constructor, `model.encode` | Chunks -> embedded chunks; question -> vector. Local model/cache; possible cold model download. |
| `backend/Graph_Rag/vector_store.py`: globals `client/collection`, `store_chunks():19`, `search_chunks():66` | Persistent vector collection. Store called by ingestion; search and direct collection reads used by retriever | Chroma PersistentClient, collection creation, upsert/query | Embedded chunks + owner -> count; query vector + owner/paper/top_k -> Chroma results. Absolute `backend/chroma_data`. |
| `backend/Graph_Rag/graph_relationship.py`: `extract_relationships():109`, nested provider functions at 138/161, `validate_relationship_result():65`, `add_relationships():219`, unused `create_graph():28`; `RELATIONSHIP_SCHEMA` | Provider extraction, schema checks, edge/evidence construction. Extract/add called by ingestion; validate called by both nested provider functions | Groq/OpenAI SDK completions, JSON parsing, NetworkX edge operations; dotenv/env names | Text -> validated entities/relationships; graph + extraction + metadata -> modified graph. Groq and OpenRouter; no DB writes here. |
| `backend/Graph_Rag/graph_store.py`: `save_graph():11`, `load_graph():26`, `load_processed_chunks():38`, duplicate `save_processed_chunks():50/64` | Graph/progress persistence. Called by ingestion; graph load also by retrieval | NetworkX GraphML, JSON, filesystem mkdir/exists/replace | User/paper IDs -> graph/set; graph/set -> files/path. Relative per-user `graph_data`. |
| `backend/Graph_Rag/paper_registry.py`: `connect_db():8`, `initialize_db():12`, `add_paper():26`, `list_papers():39`, `update_paper_status():59`, `get_paper_for_user():70` | Paper ownership, status and source-file metadata. Called by upload, main, questions wrapper, conversation routes. Initializes at import | sqlite3 connect/execute; row conversion | IDs/filename/path/status -> insert/update; owner -> list; owner+paper -> filename/path or None. Relative `paperpilot.db`. |

### 10.2 Authentication, initialization, and chat-handoff files

| Exact file; functions/classes | Callers and dependencies | Data, return values, storage/services |
|---|---|---|
| `backend/database/connection.py`: `get_connection():8` | Called by auth, conversation/message helpers and DB initializer; calls sqlite3 and PRAGMA setup | No arguments -> configured connection with row factory, foreign keys, 30-second timeout. Absolute `backend/paperpilot.db`. Registry does not call this helper. |
| `backend/database/initialize.py`: `initialize_database():5` | Called by main lifespan; calls `get_connection`, PRAGMA WAL, schema/index creation, commit/rollback | Creates users/conversations/messages schema; no ingestion/progress tables and no papers-table initialization here. |
| `backend/auth/dependencies.py`: `get_current_user():17`; `APIKeyCookie` | FastAPI dependency for paper/conversation routes; calls token decode and `get_user_by_id` | Cookie -> validated user dict or HTTP 401. Auth SQLite via helper. |
| `backend/auth/security.py`: `decode_access_token():55`, `get_secret_key():18`; also hash/verify/create token helpers | Decode called by auth dependency; other helpers called by account flows | Validates signed HS256 JWT, required fields, expiry/token type; returns payload. Reads configured secret internally; no value disclosed here. |
| `backend/auth/auth.py`: `get_user_by_id():74`; also `register_user`, `authenticate_user`, `EmailAlreadyRegistered` | User lookup called by dependency; account functions called by auth routes; uses security and `get_connection` | User ID -> public user dict/None. Registration creates UUID owner IDs; account operations use SQLite. No PDF/graph work. |
| `backend/auth/routes.py`: register/login/me/logout, `set_auth_cookie` | Router included by main; calls account/security functions and dependency | Produces/clears session cookie and public user responses. Entry prerequisite, not an ingestion processing stage. |
| `backend/auth/schemas.py`: `RegisterRequest`, `LoginRequest`, `UserResponse` | Used by auth routes; Pydantic validation | Credential request/public user schema. No ingestion storage or provider calls. |
| `backend/api/questions.py`: `answer_paper_question():6`, `get_user_papers():19` | Main and conversation routes call these; forwards to `ask_paper` and registry `list_papers` | Question/IDs/history -> answer string; owner -> papers/count wrapper. |
| `backend/Graph_Rag/retriever.py`: `retrieve_information():66`, `tokenize`, `clean_section_name`, `_format_chunk`, `_reciprocal_rank_fusion`; global `reranker` | Called by `ask_paper`; calls Chroma reads/search, query embedding, graph load, BM25 and CrossEncoder | Question/owner/paper/top_k -> chunks and relationships with evidence metadata. Local retrieval/reranking; no Groq/OpenRouter call. |
| `backend/Graph_Rag/answer_generator.py`: `ask_paper():400`, `generate_answer():94`, `calculate_confidence():53`, section/page formatting helpers | Called by question wrapper; calls retriever then provider completion and citation formatting | Evidence/history -> cited answer/clarification/not-found string. Groq, OpenRouter. Not called during PDF ingestion. |
| `backend/conversations/routes.py`: `create_new_conversation():42`, `list_conversations():68`, `get_conversation_details():78`, `send_message():103`, `remove_conversation():213` | FastAPI router; auth, paper ownership lookup, conversation/message helpers, question wrapper | Owned conversation CRUD and saved question/answer requests. Uses SQLite plus downstream retrieval/providers. |
| `backend/conversations/conversation.py`: `create_conversation`, `get_user_conversations`, `get_conversation`, `delete_conversation` | Called by conversation routes; uses `get_connection` and UUID | Owner-scoped conversation dictionaries, lists or deletion boolean. SQLite; paper association is nullable and has no papers foreign key. |
| `backend/conversations/message.py`: `save_message():7`, `get_conversation_messages():65` | Called by conversation routes; uses `get_connection`, UUID and JSON | Save is conditional on owner/conversation match and updates conversation timestamp. Read returns ordered messages with parsed sources; caller must already authorize conversation. |
| `backend/conversations/schemas.py`: `CreateConversationRequest`, `SendMessageRequest`, `MessageResponse`, `ConversationResponse`, `ConversationDetailResponse` | Used by conversation routes | Pydantic request/response types; no direct stores/providers. |
| `backend/test_chunker.py` | Standalone top-level diagnostic; not imported by main/ingestion. Calls both chunker functions and tiktoken | Reads `test_paper.pdf`, prints section/chunk diagnostics, performs assertions. Not executed in this investigation. |

The inspected `backend/api/__init__.py`, `backend/auth/__init__.py`, and `backend/database/__init__.py` do not add ingestion behavior. Earlier filenames such as `Graph_Rag/parser.py` or `metadata.py` are not part of the current source call chain.

### 10.3 Persistent artifact map

| Artifact | Actual path basis | Writer -> reader |
|---|---|---|
| Paper registry | `<CWD>/paperpilot.db` | Registry helpers -> paper listing/owner lookup. |
| Auth/chat DB | `<backend>/paperpilot.db` | DB/auth/conversation/message helpers -> auth/chat endpoints. Usually same physical DB as registry only when CWD is backend. |
| Source PDFs | `<CWD>/uploaded_papers/<paper_id>.pdf` | Upload/import -> parser. PDF response resolves relative registry paths under backend instead. |
| Vectors | `<backend>/chroma_data` | `store_chunks` -> `search_chunks` and retriever's direct collection get. |
| Graphs | `<CWD>/graph_data/<user>/<paper>.graphml` | `save_graph` -> `load_graph` during ingestion/retrieval. |
| Progress | `<CWD>/graph_data/<user>/<paper>_progress.json` | `save_processed_chunks` -> `load_processed_chunks`. |
| Local model cache | Model/library-resolved cache, not a pipeline artifact | Model initialization -> local inference. The inspected MiniLM cache config has maximum sequence length 256. |

### 10.4 Dependency boundary for future changes

Core ingestion improvements should normally be confined to upload orchestration, ingestion, extraction/chunking/embedding, vector storage, graph construction/persistence, and paper/job persistence.

Files that should not need unrelated changes:

- Auth routes, schemas, credential hashing and JWT security: maintain the existing authenticated-owner contract.
- Conversation list/delete/message storage and their schemas: no need to redesign conversations to add ingestion workers.
- Answer prompt and conversation-history formatting: not required for moving ingestion off the event loop.
- Frontend login/register pages, session gate, branding and main layout: not part of ingestion implementation.
- Existing unrelated PDF/source-preview UI behavior: preserve it.
- Chunker diagnostic: no change required merely to add job orchestration.

Narrow exceptions should be explicit: retrieval needs a compatibility change if the graph representation changes; chat boundaries need an explicit readiness/error contract if desired; frontend API/status presentation needs small additions if new stages/partial readiness become visible. These are targeted dependency adjustments, not a rebuild.

## 11. Confirmed architectural problems and recommendations

The list separates confirmed implementation defects from scale limits and optional improvements. Conditional consequences are identified rather than reported as observed production incidents.

### 11.1 Critical correctness, recovery, and boundary problems

| ID | Affected file/function | Confirmed current behavior and why it is problematic | Recommended improvement |
|---|---|---|---|
| C1 | `api/upload.py:upload_paper/import_paper_from_url`; `ingestion.py:process_paper` | Blocking pipeline is called directly from async HTTP handlers. Provider wait/retry sleeps and CPU work occupy the event-loop path, coupling document processing to request lifetime and service responsiveness. | Persist a job and source file, return 202, process in a small dedicated worker with bounded concurrency. |
| C2 | `graph_relationship.py:extract_relationships`; `ingestion.py:process_paper` | Both-provider errors become RuntimeError, bypassing the loop's RateLimitError/BadRequestError handlers. A transient graph failure fails the whole wrapper after vectors were stored. | Use one explicit extraction error contract; record retryable/permanent failure and preserve vector readiness/source PDF. |
| C3 | `api/upload.py` failure cleanup; registry schema | Ordinary graph failure deletes the source PDF while leaving partial durable artifacts and only a failed status. No same-paper resume API or reconciler exists. | Keep accepted source PDFs for retry; record stage/errors/checkpoints; resume the same authorized paper/job. Use deliberate cleanup/retention separately. |
| C4 | `graph_store.py` and `ingestion.py` | Graph/progress are independent files with no shared generation/content hash. Missing graph plus existing progress can falsely skip work. Reusing IDs after text changes skips obsolete extraction. | Checkpoint structured per-chunk extraction plus input/pipeline hashes transactionally; rebuild graph from those records or bind snapshots to a verified generation. |
| C5 | `graph_relationship.py:add_relationships` | DiGraph relation overwrite combines evidence from different relations under one final label. Proven by the edge key and assignment logic. | Key by normalized source, relation, target, or store a MultiDiGraph/explicit relation records; retain original display labels and per-chunk evidence. |
| C6 | Registry/upload/graph paths versus `database.connection`/`main.get_paper_pdf` | Some paths are CWD-relative and others backend-anchored. Launching with a different CWD can split registries and make an uploaded PDF unreadable by the download route. | Use one resolved application-data root and one shared SQLite connection/schema policy. |
| C7 | `api/upload.py:upload_paper` | Backend upload branch enforces suffix only; URL size/signature controls are not applied to multipart files. Upload resources are not bounded by the frontend check. | Enforce server-side byte, parse/page and processing budgets consistently; validate signature/readability, not extension alone. |
| C8 | `api/upload.py:import_paper_from_url` | HTTP(S)+hostname validation allows arbitrary reachable hosts and default redirects without network-target restriction. Missing SSRF boundary is confirmed; exploitation was not tested. | Validate resolved destinations and every redirect; deny private/loopback/link-local targets; apply download byte/deadline limits. |
| C9 | Upload wrappers; registry; frontend status consumption | Ready/failed hides vector-versus-graph state; graph counts are not durable. Crashes can leave processing forever. Failure errors are not persisted. | Persist stage, readiness, counts, error code, retry time and lease heartbeat; expose a small status response. |
| C10 | `graph_relationship.py:validate_relationship_result/add_relationships` | “Exact quote” is a prompt rule, not an application check, and malformed relations can be silently dropped before a chunk is marked complete. | Verify quoted text against the stored chunk, preserve stable chunk provenance, and distinguish valid-empty extraction from validation failure. |
| C11 | `answer_generator.py:generate_answer/ask_paper`; conversation `send_message` | Broad catches return NOT_FOUND_MESSAGE for provider/retrieval failures. Conversation endpoint can then save this as an ordinary assistant answer, bypassing its intended generation-failure response. | Separate operational errors from document not-found; preserve the saved question and return a retryable operational status. |
| C12 | `api/upload.py` cleanup paths | An unlink/status-update error can interrupt failure recording. Raw upstream errors are returned to clients. | Protect cleanup independently, persist sanitized error categories, log correlation IDs, and never mask the original failure with cleanup failure. |

C8 is an API security boundary, not a discovered cross-user vector/graph leak. C11 is the chat handoff consequence of ingestion/retrieval failure, not an additional ingestion LLM stage.

### 11.2 Confirmed performance and maintainability limits

| ID | File/function | Current behavior/problem | Recommended improvement |
|---|---|---|---|
| P1 | `ingestion.py:process_paper` | Every unprocessed chunk gets graph extraction, even front matter/references/overlap with little relationship value. No deterministic section/content eligibility or reusable content cache. | Explicit graph-eligibility policy with recorded skip reasons; preserve all text for vector/keyword search. Cache only within authorized scope using content+pipeline version. |
| P2 | `chunker.py:detect_sections/chunk_section`; `embeddings.py:embed_chunks` | Whole-document structures, duplicate section text, per-token page lists and all embedding outputs stay in memory. Model input budget is not reconciled with chunk tokenizer. | Process bounded page/section batches, remove redundant long-lived representations, and size embedding inputs against the actual model tokenizer. |
| P3 | `vector_store.py:store_chunks` | One unbounded upsert and no application batch-limit handling; retries re-embed everything before graph resume. | Bounded idempotent upsert batches with per-chunk content/model-version completion records. |
| P4 | `graph_store.py:save_graph/save_processed_chunks` | Full growing files rewritten after every chunk and graph saved again at end. | Persist per-chunk validated extraction incrementally; checkpoint/materialize graph at bounded intervals or completion. |
| P5 | `graph_relationship.py:use_openrouter` | Last successful provider preference is global across all users; no cooldown or explicit shared quota/concurrency limiter. | Small provider policy with explicit retry budgets, rate cooldown, and bounded shared concurrency. Keep tenant content out of global state. |
| P6 | `paper_registry.py:connect_db/initialize_db` | Separate connection policy and import-time schema creation from auth/chat initialization; no explicit registry busy-timeout policy or status timestamps. | Consolidate initialization and connection handling; add progress/lease fields through explicit migrations. |
| P7 | `retriever.py:retrieve_information` | Rebuilds BM25 and reads/reranks all graph evidence every question. Candidate-limit expression uses max with paper chunk count, contrary to its bounded-pool comment. | Correct candidate budgeting; cache/incrementally build lexical index per artifact generation; shortlist graph evidence before expensive cross-encoder scoring. |
| P8 | `graph_store.py`; `graph_relationship.py` | Duplicate save_processed_chunks definition; unused create_graph; extracted standalone entities are discarded. | Remove duplicate/dead code when implementing an authorized change; either persist meaningful standalone entities or stop requesting unused output. |
| P9 | `api/upload.py` and `vector_store.py` | New upload retries create new IDs; same-ID retries do not delete stale vector IDs when chunk count decreases. | Owner-scoped idempotency key/content digest and versioned artifact replacement/reconciliation. |
| P10 | `answer_generator.py` and `frontend/src/answer.ts` | Backend appends `Confidence Score:`, frontend parses `Evidence confidence:`. Citation-match score is not factual-claim verification; MIN_CONFIDENCE is defined but unused. | Agree on structured evidence/confidence fields and explain the score's actual meaning; do not present it as ingestion quality or factual certainty. |

For P7, the actual expression is `max(1, min(top_k * 5, 20), len(chunks_by_id))`. For a large paper, its length becomes the limit; for a short paper, the requested vector count can exceed the number of stored chunks. This is a source-confirmed mismatch with a “bounded pool” design; exact database behavior/performance was not benchmarked.

### 11.3 Optional optimizations, not prerequisites

- Batch compatible graph inputs only after measuring quality and context/output limits; batching is not automatically cheaper or safer than selective extraction.
- Add sentence/paragraph-aware token packing while maintaining precise page provenance.
- Normalize entity names carefully and preserve original mentions; aggressive merging can introduce false relationships.
- Add content-digest duplicate detection per owner, but keep an explicit “reprocess with newer pipeline” action.
- Prefer structured progress/metrics and redacted logging over raw text/model-output prints.
- Defer model loading or remove the answer/reranker import dependency from ingestion-only workers if cold start/RAM warrants it.
- Cache lexical/reranker candidate data by owner, paper, and immutable ingestion generation.
- Add OCR quality diagnostics only if scanned-document support is a requirement and the OCR engine/dependency configuration has been validated.

These are proposals, not claims that the current implementation already has them.

## 12. Recommended simple, recoverable architecture

### 12.1 Keep the existing core technologies

Retain FastAPI, SQLite, the existing local embedding/reranking models, Chroma, and the current paper/chat API concepts. A distributed queue, Redis, Celery, separate graph database, or service-per-stage architecture is not needed merely to obtain durable single-host processing.

For a single-host deployment, use a small durable jobs table in the existing SQLite database and one separately managed worker process initially. The worker can support a small configured number of active paper tasks. Bound PDF/embedding work and provider calls separately, rather than allowing one thread per chunk without a limit. Avoid multiplying full model instances unnecessarily.

This recommendation assumes a single application host and modest concurrency. Multi-host operation or sustained SQLite write contention would justify revisiting storage/queue choices after measurement; those capabilities are not promised by this design.

### 12.2 Minimal durable records

Use existing `papers` plus straightforward tables/fields, not an elaborate abstraction hierarchy:

```text
papers:
  paper_id, user_id, filename, canonical_file_path
  content_hash, pipeline_version
  status, current_stage
  vector_status, graph_status
  total_chunks, embedded_chunks, graph_done_chunks
  error_code, sanitized_error_message, updated_at

ingestion_jobs:
  id, user_id, paper_id, attempt
  state, next_attempt_at
  lease_owner, lease_expires_at, heartbeat_at
  last_error_code

paper_chunks:
  user_id, paper_id, pipeline_version, chunk_id
  content_hash, section, page_start, page_end, text
  embedding_status, graph_status
  graph_extraction_json, provider, model, attempt_count, error_code
```

Use a uniqueness constraint on the owner/paper/generation/chunk identity and at most one active job for a paper generation. Keep ownership checks at public entry points and in repository methods. Jobs never accept an arbitrary owner from a client payload.

SQLite stays the source of truth for work state and validated extraction records. Chroma remains a derived retrieval index. GraphML can remain a derived export/materialized graph instead of being the only record of completed graph work.

### 12.3 Proposed processing sequence

1. Authenticate; stream an upload/download to a temporary canonical data-root path while enforcing byte/deadline limits.
2. Validate PDF signature and readability/resource budgets; atomically finalize the source file.
3. In a short SQLite transaction, register the owner/paper, content hash and a queued ingestion job.
4. Return HTTP 202 with paper/job IDs; frontend polls the existing library or a small dedicated status endpoint.
5. Worker claims the job with an expiring lease in a short transaction; do not hold a SQLite write transaction during parsing or network calls.
6. Parse sections and chunk with preserved page metadata. Persist chunk text/provenance and pipeline/content hashes.
7. Embed only missing/changed chunks using explicit bounded batches; upsert using deterministic IDs that cannot collide across owners/generations.
8. Mark embeddings complete only after confirmed upsert. If a crash occurs after upsert but before status commit, repeat the same upsert safely.
9. Make vector availability explicit. If product policy permits, enable chat while graph work continues, with a visible “graph enrichment pending/partial” state.
10. Select graph-eligible chunks with a simple documented policy; persist “not eligible” or “valid empty extraction” distinctly from failed extraction.
11. Extract with an explicit per-provider timeout, bounded retry budget, Retry-After-aware scheduling and shared concurrency limit. Do not occupy the API event loop or hold DB locks while waiting.
12. Validate evidence quotes and output schema locally. In a single short transaction, save each chunk's structured extraction and its completion state.
13. Build graph edges keyed by source/relation/target with chunk-linked evidence. Materialize or checkpoint GraphML from committed records at completion or a controlled interval.
14. Update final vector/graph/readiness states and counts; do not delete a valid source PDF because one enrichment provider is unavailable.
15. A startup/recovery scan requeues expired leases. A retry endpoint verifies ownership and resumes the same paper generation, not a new upload ID.
16. Deliberate retention/deletion reconciles PDF, SQLite, vectors, graph exports and chunks using the same owner/paper/generation identity.

### 12.4 Status semantics

Use a small lifecycle plus explicit component readiness:

| Proposed lifecycle | Meaning |
|---|---|
| `queued` | Source accepted; durable job waiting. |
| `processing` | Leased job executing, with stage and heartbeat. |
| `ready` | Required retrieval data is committed and consistent; graph status is separately explicit. |
| `partial` | Required retrieval data is usable but optional graph work exhausted its current retry budget. |
| `failed` | Required parse/chunk/vector preparation failed; sanitized error and retry policy are recorded. |

Keep `graph_status` values such as pending/processing/complete/partial/failed/not_required separate from vector readiness. Product policy should decide whether graph completion is mandatory for “ready.” Do not infer it from successful HTTP response timing or label valid-empty extraction as provider failure.

### 12.5 Retry and provider policy

- Prefer one clear application policy with explicit SDK retry settings to avoid accidentally multiplying budgets.
- Retry transport failures, temporary rate limits and selected server errors within a capped attempt/time budget.
- Treat invalid credentials/configuration and non-retryable request errors differently from temporary overload.
- After rate limiting, persist `next_attempt_at` rather than busy-waiting for long periods in the request path.
- Try the alternate provider within the same capped job budget; record which provider/model actually produced each extraction.
- If both fail, retain committed vectors/extractions, mark the chunk retryable or permanently failed as appropriate, and continue/reschedule according to documented partial-readiness policy.
- Do not automatically retry a schema-invalid successful response indefinitely. Record validation failure; allow a bounded alternate attempt.
- Keep per-paper write ownership/leases to prevent two writers from racing the same graph snapshot.
- Verify model/context/output limits using deployed provider configuration. Token limits in code are request settings, not proof of model capability or sufficient output length.

### 12.6 Evidence preservation rules

Persist section labels, actual page spans, chunk IDs, content hashes, pipeline version and raw validated extraction records before materializing a graph. A relation's quote must be linked to the chunk that contains it and retain its own relation identity.

Do not replace an exact quote location with an invented single page when a chunk spans pages. If finer location is needed, retain page-specific text spans during chunking and map validated quotes back to those spans. Keep page-coordinate highlighting optional unless coordinates are explicitly persisted.

Do not treat a graph edge, a processed flag, or citation-label match percentage as proof that a factual claim is true. Preserve the underlying source text so the answer layer can verify and cite it.

## 13. Practical implementation order, if separately authorized

No implementation is part of this report.

1. Correct exception contracts, source-file retention, path roots, status/error recording, and the DiGraph relation collision.
2. Consolidate SQLite initialization/connection handling; add durable chunk/job checkpoints and ownership constraints.
3. Move ingestion into the bounded worker/lease loop and add a same-paper retry/status API.
4. Add bounded embedding/vector batches, stable generation-aware IDs, and per-chunk extraction persistence.
5. Add provider cooldown/retry limits and evidence validation; make graph materialization recoverable from committed records.
6. Expose accurate readiness/partial progress with small API/frontend status additions, preserving current login, library, chat and PDF interfaces.
7. Measure a few representative large/scanned/research PDFs and concurrent users before adding optional batching, caches or new infrastructure.

## 14. Verification record and open measurements

### Completed in this investigation

- Read all production backend Python modules on the ingestion/auth/storage/chat call chain.
- Enumerated function definitions and callers using static source inspection.
- Verified the four hosted completion call sites and literal model/output settings.
- Read local SDK retry/timeout implementations rather than assuming “no retries.”
- Checked the cached MiniLM sequence-length setting and PyMuPDF4LLM OCR/page-number defaults.
- Compared backend status assignments with the current frontend status/result handling.
- Identified checkpoint, edge-key and storage-root consequences directly from code.
- Did not run application imports, ingestion, external provider requests, model downloads/inference, database writes, or new tests.

### Not established by static review

- A typical real PDF's chunk count, runtime, RAM/GPU use, embedding truncation rate, extraction accuracy or cost.
- Actual provider account quotas, current model availability/JSON-schema support, or live fallback success.
- Installed OCR engine functionality for scanned documents.
- Exact Chroma batch maximum, transactional behavior during a forced crash, or supported concurrent-process topology in this deployment.
- Whether a particular operational failure has occurred; the report identifies code behavior and conditional consequences.
- Multi-host throughput, production worker configuration, log access policy, or provider data-retention policy.

No source changes or “fixes” are implied by this document. The existing backend remains untouched.

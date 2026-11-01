# TASK-f09609fd - Run document indexing in a separate process

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-f9d5ae8d, REQ-FUNC-362ebed9, REQ-FUNC-276a5da8, REQ-REL-6a962d80, REQ-REL-08946818, REQ-UX-f6c347b8, REQ-REL-4761ac1e, REQ-FUNC-5e627a51, REQ-REL-cb8c082d
parent:
branch: master
base: 33e72b8c7611d3c36c287ca49dae0b6474338c8f
opened: 2026-11-01

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [ ] knowledge pages of changed components current with the reviewed code
- [ ] project and environment context reconciled with the candidate
- [ ] requirements re-read: status, prose, verification, paths and links true
- [ ] manual or inspection verification recorded where applicable
- [ ] explicit review approved, when enabled
- [ ] final `check --strict --run` result logged truthfully after the last edit
- [ ] remaining warnings and pre-existing failures explained
- [ ] `report` appended

## Frame

Problem:
- STATED (user, 2026-10-31): indexing should run in a parallel background process; a large
  workbench froze VERA.
- STATED (user, 2026-11-01, TASK-e5310cdb RULING-001): the separate process does scanning,
  extraction, chunking and embeddings (also for search_docs); VERA main receives the results and
  stays the only SQLite writer; an indexer crash only restarts the indexer.
- OBSERVED: per document, the main process hashes the file, re-reads and re-hashes it in
  verifyDocumentSource, reads/writes the extraction cache (sync fsync), extracts text/Markdown/
  HTML and chunks with the tokenizer on its event loop; PDF/office extraction and embeddings run
  in worker threads of the main process (core knowledge/ingest.ts, processor.ts, worker-host.ts,
  embedding.ts). Selection globbing and lstat also run on the main event loop.
- OBSERVED (2026-10-31): terminating the ONNX embedding worker thread mid-call ended the whole
  VERA process (0xE06D7363); fixed by retiring busy workers, but any native crash in a worker
  thread still takes the app down.
- OBSERVED: the DocumentProcessor contract (input root/path/kind/sha256/embeddings/signal;
  result status/pages/reason/chunks/derived) and EmbeddingPort (embed/rank/release) are the seams
  ingest and search use; the CLI composes the same core in one process.
Desired outcome: the heavy indexing work of the desktop app runs in a separate indexer process;
  VERA's main process only coordinates and writes SQLite, stays responsive during indexing, and
  survives an indexer crash, after which indexing resumes.
Actors: the desktop user; the agent's search_docs/read_doc (semantic ranking).
Primary scenario: the user opens a workbench with hundreds of PDFs; the indexer process extracts,
  chunks and embeds them while chats, navigation and the Docs tab stay responsive; if the
  indexer crashes, VERA keeps running, restarts it and continues indexing.
Examples: killing the indexer process during a PDF batch leaves VERA open and the batch is
  indexed after the restart; search_docs ranks results through the indexer's embeddings.
Counterexamples: the CLI keeps its in-process composition; SQLite is never written by the
  indexer process.
In scope: an Electron utility process hosting selection (glob/lstat/sizes), hashing, the document
  processor (verification, cache, extraction with its worker threads, chunking, embeddings) and
  the embedding port for search ranking; a typed message protocol with cancellation; restart
  after a crash; desktop composition switched to the process; tests (protocol, crash/restart,
  native e2e).
Out of scope: the Docs tree explorer (later task); CLI composition; changing SQLite ownership or
  schema; new document types or limits; moving the chat/session engine.
Constraints: on master (default branch); no commits unless asked; packaged and dev builds must
  both start the process; the process gets no network access beyond what extraction needs today
  (none); main-side ownership checks stay authoritative before every SQLite write.
Success signals: a native e2e kills the indexer mid-indexing and VERA stays up and finishes the
  index; the main process event loop stays responsive while a large folder is processed (bounded
  delay probe); unit tests of the protocol (cancellation, crash during a call, restart).
Evidence: core knowledge/ingest.ts, processor.ts, worker-host.ts, embedding.ts; main
  document-processor.ts, index.ts; electron.vite.config.ts rollup inputs; TASK-e5310cdb.
Assumptions: none.
Unknowns: none open.
Decision-blocking questions: none open. Answered by the user (RULING-002, RULING-003).
Proposed behaviors (accepted by RULING-001..003):
- The chokidar watcher stays in main; selection, hashing, processing and embeddings move to the
  indexer (RULING-002).
- An indexer crash restarts it automatically; the document in flight is retried on the next
  reconciliation; after three crashes within a minute indexing stops and Docs shows "Indexing
  stopped" with a Restart action (RULING-003).
Path and reason: full.
  | Criterion | Holds? | Evidence |
  |---|---|---|
  | no new externally observable behavior | no | crash isolation, restart status |
  | no new interface or data format | no | indexer message protocol |
  | no new dependency | yes | Electron utilityProcess is built in |
  | an existing requirement already covers the behavior | no | ingest requirements assume one process |
  | no security or data-handling change | no | file reads move to another process |

## Requirement coverage

| Behavior | Requirement | Source in Frame |
|---|---|---|
| documents are hashed, verified, extracted, chunked and embedded in the indexer; main writes SQLite | REQ-FUNC-f9d5ae8d | RULING-001, desired outcome |
| selection (glob/lstat/sizes) runs in the indexer | REQ-FUNC-362ebed9 | RULING-001, RULING-002 |
| search_docs embeddings and ranking run in the indexer | REQ-FUNC-276a5da8 | RULING-001 |
| a crash keeps VERA running, restarts the indexer and retries in-flight documents | REQ-REL-6a962d80 | RULING-001, RULING-003 |
| three crashes within a minute stop restarts | REQ-REL-08946818 | RULING-003 |
| Docs shows stopped indexing with Restart | REQ-UX-f6c347b8 | RULING-003 |
| close/switch cancels pending indexer work and releases embeddings | REQ-REL-4761ac1e | constraint (abort/drain before storage release) |
| keyword fallback when the indexer cannot rank | REQ-FUNC-5e627a51 | RULING-005 |
| a document that crashed the indexer twice is failed until it changes | REQ-REL-cb8c082d | RULING-006 |

Revised (review round 1 and RULING-004..007): REQ-REL-6a962d80 and REQ-REL-08946818 include a failed start; REQ-REL-4761ac1e states best-effort cache cancellation; verification wording of REQ-FUNC-362ebed9, REQ-FUNC-f9d5ae8d, REQ-FUNC-276a5da8, REQ-UX-f6c347b8. Existing ingest, extraction and embedding requirements keep their behavior; their seams now run behind the indexer protocol in the desktop app, and the CLI keeps the in-process composition.

## Design

**Approach.**
- Core seams (no behavior change for the CLI): `Ingester` gains two optional ports beside the
  existing `process`: `select({root, docs, signal})` and `inspect({root, path, kind, identity,
  signal})`. Their defaults are new pure core functions: `selectDocuments` (the TASK-e5310cdb
  pruned glob, ordinary checks and sizes, reading the .veraignore policy itself through a shared
  `readIgnorePolicy`) in `knowledge/selection.ts`, and `inspectSource` (O_NOFOLLOW open, identity
  re-check, streamed SHA-256, binary probe, size cap, unchanged-after-read check) in
  `knowledge/inspect.ts`. The watcher, the queue, ownership checks, lstat identity checks around
  processing, row decisions and every SQLite write stay in `Ingester` on main.
- Retry instead of failure (REQ-REL-6a962d80): an error carrying `retry: true` (the host's
  "indexer interrupted") makes `ingest()` keep the row pending and request a reconciliation
  instead of storing PROCESSING/IO.
- Indexer process (REQ-FUNC-f9d5ae8d, REQ-FUNC-362ebed9, REQ-FUNC-276a5da8): new desktop entry
  `main/indexer-process.ts`, started with Electron `utilityProcess.fork` (serviceName "VERA
  Indexer"). It composes `createDocumentServices` (document processor with its PDF/office worker
  threads and the EmbeddingHost) plus `selectDocuments`/`inspectSource`, and answers typed
  messages over `process.parentPort`: select, inspect, process, embed, rank, release, cancel. A
  pure `createIndexerHandler(services)` holds the dispatch for unit tests.
- Host (REQ-REL-6a962d80, REQ-REL-08946818, REQ-REL-4761ac1e): `main/indexer-host.ts` owns the
  child: request ids, AbortSignal -> cancel message, results by id, late results ignored. It
  exposes `processor: DocumentProcessor`, `embeddings: EmbeddingPort` (rank sends rows only after
  the indexer answers that the epoch is not cached), `select` and `inspect`. On an unexpected
  exit it rejects pending calls with a retry error, restarts, and emits `running`; a third exit
  within 60 s sets `stopped` and later calls fail until `restart()`. The spawn function and clock
  are injectable for tests.
- Status and UI (REQ-UX-f6c347b8): app event `indexer.status {state: running|stopped}` and IPC
  `indexer.status {} -> {state}`, `indexer.restart {} -> {}` (restart also requests the active
  workbench's reconciliation). Docs shows `[data-indexer-stopped]` with a Restart button.
- Close/switch (REQ-REL-4761ac1e): `Ingester.close` already aborts its signal; the host turns that
  into cancel messages, and a cancelled request's assertWritable throws in the indexer, so it
  writes no cache after close. `release(root)` is posted without waiting (and starts no indexer):
  the indexer's EmbeddingHost retires a busy ONNX worker after its reply (2026-10-31 fix), which
  must not delay closing the workbench (build finding, logged).
- Rejected: a second SQLite writer in the indexer (RULING-001); moving the watcher (RULING-002);
  one worker thread instead of a process (no crash isolation).

**Interfaces and data.**
- Protocol (structured clone over MessagePort): requests `{id, type, ...}`, replies `{id, ok,
  value}` or `{id, ok: false, error: {code, retry?}}`; `cancel {id}`; `release {root}`.
- Shared: app event `indexer.status`; channels `indexer.status`, `indexer.restart`.
- Build: rollup input `indexer-process`; packaging keeps native modules external as today.
- Locales: `documents.indexerStopped`, `documents.indexerRestart`.

**Files and test seams.**
- core knowledge/selection.ts, inspect.ts (+ tests), ingest.ts (ports, retry); ingest tests keep
  using the in-process defaults.
- desktop main indexer-host.ts (+ indexer-host.test.ts with a scripted endpoint and clock),
  indexer-process.ts (+ handler test), document-processor.ts, index.ts (composition, channels,
  status), electron.vite.config.ts; shared ipc.ts/events.ts (+ contract test).
- renderer docs-tab.tsx, locales, mockApi; documents.test.ts.
- native e2e: new indexer.spec kills the indexer pid (exposed only in VERA_TEST builds) during
  indexing and checks VERA stays up and finishes; existing ingest/citations/office specs.

**Risks and open decisions.**
- utilityProcess is created only after app ready; ingest waits for the host to be ready.
- Large rank row sets cross the process boundary once per epoch; acceptable (already serialized
  to a worker thread today).
- No open product decisions.

**Requirement map.** As in the coverage table.

Diagrams: [diagram_TASK-f09609fd.md](diagram_TASK-f09609fd.md)

## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: completed; next specify - scope set by user answers RULING-001..003 (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-01 build: red: vitest knowledge/ingest-ports.test.ts exit 1 - inspect.js and selection.js missing; the Ingester has no select/inspect ports and stores an interrupted processor call as failed (REQ-FUNC-362ebed9, REQ-FUNC-f9d5ae8d, REQ-REL-6a962d80)
- 2026-11-01 build: green (core increment): vitest core knowledge + workbench + integration 236 passed - ingest-ports (select/inspect ports used when supplied, scripted selection respected, retry error keeps the row pending and the requested reconciliation indexes it, in-process inspectSource identity/binary/change); shared helpers moved to knowledge/kinds.ts and re-exported from ingest.ts; selection.ts and inspect.ts hold the defaults (REQ-FUNC-362ebed9, REQ-FUNC-f9d5ae8d, REQ-REL-6a962d80 core part)
- 2026-11-01 build: red: vitest main/indexer-host.test.ts and indexer-handler.test.ts exit 1 - modules missing (REQ-FUNC-f9d5ae8d, REQ-FUNC-362ebed9, REQ-FUNC-276a5da8, REQ-REL-6a962d80, REQ-REL-08946818, REQ-REL-4761ac1e). Design detail: the host starts the indexer on its first call, because utilityProcess.fork is only allowed after app ready while WorkbenchService is composed at module load
- 2026-11-01 build: green (host/handler increment): vitest main indexer-host (process/select/inspect forwarding without functions, two-step rank rows on cache miss, cancel + late reply ignored, release, crash -> retry error + restart, 3 crashes in 60 s -> stopped until restart, slower crashes keep restarting, close kills without restart) and indexer-handler (dispatch, cancel -> aborted reply, needRows protocol, release, unknown -> error) 9 passed; tsc -b exit 0
- 2026-11-01 build: e2e workbench.spec 'New Workbench creates…' timed out: right after create, closing waited ~1 s for the indexer to retire a busy embedding worker, and App's pre-existing close/navigation race then hid the create page. red: indexer-host 'releases…' and 'does not start an indexer only to release' wait 5 s for an answer; indexer-handler cancelled request can still pass assertWritable (cache writes after cancel) (REQ-REL-4761ac1e)
- 2026-11-01 build: green (status/UI + composition + close increment): vitest indexer-host 10 incl. fire-and-forget release and no spawn for release, indexer-handler with cancelled assertWritable, shared documents-ipc indexer channels/event, renderer documents.test 'shows stopped indexing with a Restart action'; tsc -b exit 0; check:i18n exit 0; biome clean; e2e indexer (kill mid-index -> restart, 18 documents indexed, search through the indexer), ingest, workbench (incl. New Workbench), citations, office-documents, documents, pdf-download, sessions pass natively. REQ-REL-4761ac1e and the design note now say release is not awaited and cancelled requests write nothing. Full unit suite: only the 4 pre-existing failures. Note: the full unit suite rebuilds out/ without VERA_TEST, so e2e must go through npm run test:e2e
- 2026-11-01 build: evolution reviewed: the task's 31 05_Software paths (indexer-host/handler/process, selection.ts, inspect.ts, kinds.ts, ingest/embedding/service/index changes, shared contract, Docs UI, locales, mock, build entry, tests) match the design. Not this task's work and left untouched: 00_Planning/* (ADR-0016..0019, plugins plan) and 05_Software/scripts/package.mjs, probe-upgrade.mjs (installer 250 MB budget removed, per ADR-0017), changed concurrently at 04:47-05:02 outside this session's edits. Knowledge: new indexer-process.md; knowledge-ingest.md, document-search.md, ipc-boundary.md updated
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 1 findings: (1) errno codes do not cross the boundary, so ENOENT during inspect/process is stored as failed instead of retried; (2) reindex while stopped clears all rows and then fails - select first, disable Reindex while stopped; (3) rank two-step has a cache-check race - pass a lazy rows function that asks for vectors at execution time; (4) cache ownership is cancel-only (RULING-004: document as best effort); (5) tests: postMessage failure, AbortError mapping, stale endpoint events, e2e kill really mid-index, network guard covers main only (stated, inspection), semantic ranking not exercised natively; (6) ingest-ports should assert chunks and vectors; (7) REQ-FUNC-362ebed9 verification wording; renderer test should start running and receive a stopped event; document-extraction.md and context/project.md routes. New user rulings RULING-004..007 (cache best effort, keyword fallback, per-document crash cap, failed fork = crash). Full e2e before fixes: 7 pre-existing failures plus session-scroll.spec (to check)
- 2026-11-01 validate: returned to build - review round 1 findings and RULING-004..007
- 2026-11-01 build: red (round 1): vitest indexer-handler (lazy rows, error code), indexer-host (crashed flag, code/AbortError restore, failed spawn = crash), core search (keyword fallback), ingest-ports (reindex keeps rows when select fails, per-document crash cap, chunks+vectors persisted), renderer (stopped event, Reindex disabled) - 10 new failures as expected; the in-process ENOENT guard test and stale-endpoint test already pass
- 2026-11-01 build: green (round 1): errno codes cross the boundary; reindex selects before clearing; lazy rank rows remove the cache-check race; per-document crash cap (RULING-006); failed start = crash (RULING-007); keyword fallback (RULING-005); Docs disables Reindex while stopped; tests: indexer-host 14, indexer-handler 4, ingest-ports 7, search fallback, renderer stopped-event test; e2e indexer now kills mid-index (46 docs) and runs the agent's semantic search_docs through the restarted indexer (pass). Full unit suite: only the 4 pre-existing failures; tsc -b exit 0; biome clean. session-scroll.spec 'fixed viewport…' line 147 is a timing flake in the chat transcript rail (passed 2 of 3 alone; mock/browser test unrelated to the indexer). New requirements REQ-FUNC-5e627a51 (keyword fallback) and REQ-REL-cb8c082d (crash cap); knowledge indexer-process.md, document-extraction.md, document-search.md and context/project.md updated
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 2: quality approved (non-blocking: unverified utility-process message size limit for very large rank payloads; a deterministic postMessage failure would retry without the crashed mark; a crash is blamed on the in-flight document, accepted by RULING-006). spec changes_required: (1) the native semantic e2e must show no keyword fallback; (2) docs-tab comment still says reindex empties first, and REQ-UX-f6c347b8 prose must name the disabled Reindex; (3) knowledge-ingest.md: reindex selects first, per-document crash cap; (4) indexer-process.md reply shape lacks code; Q1: REQ-REL-6a962d80 gets 'except as limited by REQ-REL-cb8c082d'. RULING-006 narrows RULING-003's retry-in-flight behavior for a document that crashed the indexer twice (recorded here; the ruling entry says supersedes=none)
- 2026-11-01 validate: returned to build - round 2 spec findings (wording, one e2e assertion)
- 2026-11-01 build: green (round 2 fixes): e2e indexer passes with the assertion that its semantic search_docs is not the keyword fallback; renderer stopped-status test passes; biome clean; docs-tab comment, REQ-UX-f6c347b8 prose (disables Reindex), REQ-REL-6a962d80 (except as limited by REQ-REL-cb8c082d), knowledge-ingest.md (select before clearing, crash cap) and indexer-process.md (reply code) updated
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: final: python .agentic/aegis.py check --task TASK-f09609fd --strict --run exit 0 (lint, typecheck, i18n). Full unit suite on the round-1 candidate: 1085 passed, 4 pre-existing failures (sessions compaction transcript, write/edit registry, documents 'bounds large text DOM', workspace Settings tab count); rounds 2-3 changed only an e2e assertion, a comment and documentation. Native e2e on the final code: indexer (mid-index kill, 46 documents, semantic search_docs not via fallback), ingest, workbench x4, citations, office-documents, documents pass; the earlier full e2e run had the 7 known failures plus the session-scroll timing flake. Evolution also lists concurrent work outside this task (00_Planning, 05_Software READMEs, scripts/package.mjs, probe-upgrade.mjs, tests/packaging/packaging.test.ts: installer size budget removal), left untouched. Remaining check warnings belong to older requirements
- 2026-11-01 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: commit: the user authorized committing all uncommitted work as one local commit on master (2026-11-01)

## Rulings

- RULING-001 | date=2026-11-01 | decision=The indexer process does scanning, extraction, chunking and embeddings (also for search_docs); VERA main keeps the only SQLite writer; an indexer crash only restarts the indexer | reason=user chose 'Munca grea; DB in VERA' (TASK-e5310cdb RULING-001) | source=user | supersedes=none
- RULING-002 | date=2026-11-01 | decision=The chokidar file watcher stays in VERA main; selection (glob/lstat), hashing, extraction, chunking and embeddings move to the indexer process | reason=user chose 'Ramane in VERA' | source=user | supersedes=none
- RULING-003 | date=2026-11-01 | decision=After an indexer crash VERA restarts it automatically and retries the document in flight on the next reconciliation; after three crashes within a minute it stops and Docs shows 'Indexing stopped' with a Restart action | reason=user chose 'Reporneste automat, apoi status' | source=user | supersedes=none
- RULING-004 | date=2026-11-01 | decision=Extraction cache writes in the indexer are stopped by cancellation only (no lock-token check per write); this is best effort, documented, since the cache is content-addressed and verified on read | reason=user chose 'Da, documentat' | source=user | supersedes=none
- RULING-005 | date=2026-11-01 | decision=When semantic ranking is unavailable because the indexer is stopped or interrupted, hybrid/semantic search_docs falls back to keyword results and says semantic ranking is unavailable | reason=user chose 'Revine la cautarea pe cuvinte' | source=user | supersedes=none
- RULING-006 | date=2026-11-01 | decision=A document in flight during two indexer crashes is stored as failed (PROCESSING) and is not retried while the workbench stays open unless its content changes | reason=user chose 'Da: dupa 2 crash-uri devine failed' | source=user | supersedes=none
- RULING-007 | date=2026-11-01 | decision=A failed indexer start (fork error) counts as a crash toward the three-in-a-minute limit | reason=user chose 'Ca un crash' | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-f09609fd.md
changed: design note; diagram_TASK-f09609fd.md
evidence: check --task TASK-f09609fd --strict --run exit 0
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-01)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-f9d5ae8d - Process documents in the indexer process
  - REQ-FUNC-362ebed9 - Select documents in the indexer process
  - REQ-FUNC-276a5da8 - Rank semantic search results through the indexer
  - REQ-REL-6a962d80 - Keep VERA running and resume indexing after an indexer crash
  - REQ-REL-08946818 - Stop restarting the indexer after repeated crashes
  - REQ-UX-f6c347b8 - Show stopped indexing with a restart action
  - REQ-REL-4761ac1e - Cancel indexer work when a workbench closes or switches
  - REQ-FUNC-5e627a51 - Fall back to keyword search when the indexer cannot rank
  - REQ-REL-cb8c082d - Fail a document that crashed the indexer twice
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 33e72b8: 293 file(s) changed, 17974 line(s) added; 7 file(s) not content-scanned
- checks: errors=0 warnings=156 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

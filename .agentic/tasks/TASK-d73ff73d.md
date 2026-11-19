# TASK-d73ff73d - EMB-02 Embedder per model (#300)

stage: done
type: feature
interaction: autopilot
requirements: REQ-DATA-372352ae, REQ-DATA-acfca53d, REQ-DATA-154fb0af, REQ-NFR-f3e0377c, REQ-FUNC-7c394cbe, REQ-FUNC-18573c94, REQ-DATA-1ef1cbb5, REQ-NFR-ef69b1ff, REQ-NFR-d8ac1694
parent:
branch: ddp/epic-298
base: f67dd29f0b9d380bf2b92e7044e1db76d544773e
opened: 2026-11-19

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [x] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [x] knowledge pages of changed components current with the reviewed code
- [x] project and environment context reconciled with the candidate
- [x] requirements re-read: status, prose, verification, paths and links true
- [x] manual or inspection verification recorded where applicable
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: OBSERVED — the desktop indexer and CLI bind the default model at startup and chunk.ts counts BGE tokens for every workbench.
Desired outcome: STATED — indexing and semantic search resolve the configured model and use its prefixes, with a matching passage tokenizer and a worker stopped when idle.
Actors: STATED — workbench users with English or multilingual documents.
Primary scenario: STATED — open and index two workbenches with distinct configured models, then search both in one app session.
Examples: STATED — Romanian and German paraphrases and English queries retrieve E5 documents by meaning.
Counterexamples: STATED — omitted model keeps BGE; exact terms remain searchable through the keyword path.
In scope: STATED — EMB-02 (#300), including model-aware indexing, semantic search and worker lifecycle.
Out of scope: STATED — model-switch confirmation and vector rebuild UX (EMB-03), packaging and licences (EMB-04).
Constraints: STATED — worktree ddp/epic-298 at f67dd29f0b9d380bf2b92e7044e1db76d544773e, version 1, no migrations, focused validation. User authorized one local commit after validation by the coordinator; implementer hands back the unstaged candidate.
Success signals: STATED — EMB-02-A demonstrates real desktop indexing and search per model; EMB-02-B verifies full passage inputs fit each tokenizer's 512-token window.
Evidence: OBSERVED — Gitea #300, multilingual-embeddings.md, indexer-host.ts, indexer-process.ts, processor.ts, embedding-worker.ts, chunk.ts.
Assumptions: INFERRED — the existing utility process remains the isolation boundary; the CLI uses the same core selection logic.
Unknowns: UNKNOWN — multilingual fixture ranking margins before running inference.
Decision-blocking questions: None.
Proposed behaviors: None.

## Requirement coverage

| Behavior | Requirement | Design |
| --- | --- | --- |
| When VERA indexes a workbench document, VERA shall derive its vectors with the configured model and its manifest passage prefix, storing that model's identity with the vectors. | REQ-FUNC-7c394cbe | Use the registry in the indexer and CLI; pass the configured ID to process and coverage checks. |
| When a workbench runs semantic document ranking, VERA shall encode its query with the configured model and its manifest query prefix and rank only vectors identified by that model. | REQ-FUNC-18573c94 | Resolve a bound port from the live workbench config for semantic search and warm-up. |
| When VERA chunks a document for embedding, VERA shall bound each chunk's complete passage input, including the model prefix and special tokens, to the configured model's tokenizer window of 512 tokens. | REQ-DATA-1ef1cbb5 | Load and verify the selected tokenizer in the document processor. Keep common persisted shape validation in main. |
| When a local embedding model receives work, VERA shall start its worker on demand and reuse that worker for queued calls to the same model. | REQ-NFR-ef69b1ff | One serial worker slot per host/model, with a root-qualified cache key. |
| When an embedding worker becomes idle or its last workbench releases it, VERA shall retire the worker while allowing an in-progress native call to drain. | REQ-NFR-d8ac1694 | Schedule inactivity after the queue drains; release retires the last root's worker and preserves the native drain. |

## Design

**Approach**
- OBSERVED — desktop already isolates extraction and inference in the utility indexer; main keeps SQLite ownership.
- INFERRED — share a core document-services factory between CLI and utility process. Resolve model-bound ports from the existing registry, including in main's indexer proxy (REQ-FUNC-7c394cbe, REQ-FUNC-18573c94).
- OBSERVED — the embedding worker already applies each manifest's input prefixes and validates complete inputs.

**Interfaces and data**
- Pass the registered model ID on embed/rank requests and in the existing process input. Use descriptor identity for persisted vector coverage and semantic lookup (REQ-DATA-154fb0af).
- Use a verified local tokenizer and the passage prefix in the extraction process (REQ-DATA-1ef1cbb5); validate persisted chunk structure and vector shape in main.
- Resolve the workbench model from current session configuration and for first-message warm-up (REQ-NFR-f3e0377c). Keep BGE for the default ID and preserve keyword fallback behavior.
- Keep one lazily started serialized worker slot for each used model. Qualify worker cache keys by workbench root. Retire after idle or last-root release and drain busy native calls (REQ-NFR-ef69b1ff, REQ-NFR-d8ac1694).

**Files and test seams**
- Change core embedding, token budget, chunk, processor and ingest, desktop indexer and session composition, and CLI document composition.
- Exercise thread lifecycle with a scripted worker. Verify both models in a single Electron session through workbench IPC, persisted vectors and replay search_docs. Count stored tokens with the independent Transformers tokenizer.

**Risks and open decisions**
- OBSERVED — ONNX may terminate the process if its thread is stopped during inference. Preserve drain, abort and deadline behavior.
- INFERRED — use a 60-second idle interval to retain a warm model across nearby requests and release memory after inactivity.

**Requirement map**
- The requirement coverage table names each design seam. Registered model IDs and manifests already satisfy REQ-DATA-372352ae and REQ-DATA-acfca53d.

Diagrams: [diagram_TASK-d73ff73d.md](diagram_TASK-d73ff73d.md)

## Log

- 2026-11-19 frame: journal opened
- 2026-11-19 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-19 specify: completed; next design
- 2026-11-19 design: completed; next build
- 2026-11-19 build: red: npmw.py npx vitest run embedding.test.ts -t shares a model worker exit 1 - two workers start for the same model (REQ-NFR-ef69b1ff, REQ-NFR-d8ac1694).
- 2026-11-19 build: red: npmw.py npm run test:e2e -- --serial-only embedding-models.spec.ts exit 1 - E5 workbench persists BGE identity before E5 search and budget assertions (REQ-FUNC-7c394cbe, REQ-FUNC-18573c94, REQ-DATA-1ef1cbb5).
- 2026-11-19 build: Windows focused: pinned npmw.py npm run typecheck exit 0. The 16-file Vitest run reported 131 passed and one cold E5 host test hitting the default 5 s timeout. Set the compiled-host cases to 30 s and reran npmw.py npx vitest run tests/integration/document-hosts.test.ts, exit 0 (5 passed). All 132 unique focused assertions passed across the two runs.
- 2026-11-19 build: green: Windows npmw.py npm run test:e2e -- --serial-only embedding-models.spec.ts indexer.spec.ts exit 0 (2 passed). EMB-02-A: one Electron session indexed both models and ranked Romanian, German and English E5 queries; the BGE control missed the English-to-German top result while both found the exact German keyword. EMB-02-B: each dense source exceeded only its selected tokenizer window, and every stored chunk passed its model-specific full passage budget.
- 2026-11-19 build: Anchor recorded at f67dd29 before implementation, and the final build evolution matched the planned source, tests and localized documentation. Scoped check has no errors. The release notes and help paths are required by AGENTS.md and are outside AEGIS layout globs; the remaining ticket reference and old journal warnings refer to other records.
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: WSL2 Ubuntu pinned Node v24.21.0: npmw.py npm run typecheck exit 0; focused embedding, extraction, IndexerHost and compiled host coverage exercised 45 cases. The initial 5 s default caused two compiled-host timeouts; the 30 s affected rerun passed all five host cases (45 unique cases green). npmw.py npm run test:e2e -- --serial-only embedding-models.spec.ts exit 0 (1 passed under Xvfb).
- 2026-11-19 validate: Round 1 independent findings: CHANGELOG new entry exceeds the 120-character release rule. Missing manifest or tokenizer paths leak ENOENT/ENOTDIR into the vanished-source retry branch and can leave a valid source pending.
- 2026-11-19 validate: returned to build - Correct the changelog length and ensure missing local embedding resources yield a processing failure instead of a source retry.
- 2026-11-19 build: review fix red: npmw.py npx vitest run embedding-ingest.test.ts -t reports a missing model exit 1. Both missing-resource cases persisted pending with no error instead of failed/PROCESSING.
- 2026-11-19 build: Review fix green: Windows pinned Vitest embedding-ingest.test.ts, embedding.test.ts, ingest-ports.test.ts and document-hosts.test.ts exit 0 (23 passed). Windows npmw.py npm run test:e2e -- --serial-only embedding-models.spec.ts exit 0 (1 passed). Verified the new Changelog entry fits the 120-character limit.
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: Review fix green on WSL2 Ubuntu: npmw.py npx vitest run src/libraries/core/src/knowledge/embedding-ingest.test.ts exit 0 (4 passed) and npmw.py npm run test:e2e -- --serial-only embedding-models.spec.ts exit 0 (1 passed). Total unique focused coverage across the ticket is 134 cases on Windows and 49 on WSL2.
- 2026-11-19 validate: Round 2 specification finding: model descriptor lookup for an unchanged indexed document could throw before its hash was recorded, publish IO, and delete existing keyword chunks. Implementation quality approved the first resource-error fix.
- 2026-11-19 validate: returned to build - Preserve the existing index for an unchanged source when model identity cannot be resolved.
- 2026-11-19 build: Round 2 fix red: pinned Vitest embedding-ingest.test.ts -t preserves unchanged indexed exit 1. Both an aged file eligible for metadata shortcut and a recent file verified by hash lost indexed status after reopening with no manifest.
- 2026-11-19 build: Round 2 fix green: Windows pin Vitest embedding-ingest.test.ts, ingest.test.ts and ingest-ports.test.ts exit 0 (39 passed, 1 platform skip), including the metadata and hash preservation regression. WSL2 embedding-ingest.test.ts exit 0 (5 passed). The two-model app case passed again on Windows and WSL2, each with npmw.py npm run test:e2e -- --serial-only embedding-models.spec.ts.
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: Round 3 independent reviewers approved the complete unstaged candidate against f67dd29f0b9d380bf2b92e7044e1db76d544773e, including untracked files. The earlier findings are resolved. The Windows-skipped symlink test passed on WSL2 using the focused ingest.test.ts selector.
- 2026-11-19 validate: Validation surfaced one localized release-note format issue after round 3 approvals. Strict AEGIS exited 0, with lint, typecheck, i18n and help green. Separate check:release-notes exited 1 because slash-separated viewer labels in German and French were caught by the path detector.
- 2026-11-19 validate: returned to build - Use plain language in the merged German and French viewer release notes so the release validator accepts them.
- 2026-11-19 build: Fixed the two release-note strings with plain German/French wording. Pinned npm run check:release-notes exited 0 (three files, zero errors). The source and tests recorded in round 3 have the same contents.
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: Round 4 specification and implementation reviewers approved the complete candidate against f67dd29, including the release notes. Focused proof covers 162 distinct passing Vitest cases on Windows, 51 on WSL2 and real per-model Electron indexing and search on each. The POSIX symlink case is covered on WSL2.
- 2026-11-19 validate: Final: python .agentic/aegis.py check --task TASK-d73ff73d --strict --run exit 0. Pinned lint, typecheck, i18n and help passed. The 31 advisory warnings are 25 pre-existing unrelated records and six required help/release/changelog paths outside the AEGIS layout globs. Pinned check:release-notes and explicit Biome check of the new source and native test passed. Removed the task-owned WSL2 scratch workspace and temporary Windows proof inputs; original logs remain under 05_Software/evaluation-outputs/emb-02/.
- 2026-11-19 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-19 | decision=The coordinator may make one local commit after this ticket passes validation; the implementer returns an unstaged candidate. | reason=User-authorized separate-session AEGIS workflow on the existing sibling worktree. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-d73ff73d.md
changed: Per-workbench BGE/E5 indexing and semantic search, model-specific passage budgets, and idle worker cleanup.
evidence: Strict AEGIS and release notes exit 0; 162 Windows and 51 WSL2 focused cases passed; two-model Electron case passed on both; both reviews approved.
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-11-19)

- stage: validate; type: feature; branch: ddp/epic-298
- requirements:
  - REQ-DATA-372352ae - Accept the registered local embedding model IDs
  - REQ-DATA-acfca53d - Pin one valid q8 manifest per registered embedding model
  - REQ-DATA-154fb0af - Atomic local embedding lifecycle
  - REQ-NFR-f3e0377c - Warm the embedding model on the first message of an indexed workbench
  - REQ-FUNC-7c394cbe - Use the workbench model for document indexing
  - REQ-FUNC-18573c94 - Use the workbench model for semantic document search
  - REQ-DATA-1ef1cbb5 - Budget chunks with the selected passage tokenizer
  - REQ-NFR-ef69b1ff - Start a local embedding worker on demand per model
  - REQ-NFR-d8ac1694 - Retire the embedding worker when idle
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base f67dd29: 52 file(s) changed, 1238 line(s) added
- checks: errors=0 warnings=31 notes=38
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

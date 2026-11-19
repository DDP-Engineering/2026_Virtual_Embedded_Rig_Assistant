# TASK-dd7b8f09 - EMB-03 Switching a workbench embedding model (#301)

stage: done
type: feature
interaction: autopilot
requirements: REQ-UX-340c4ce0, REQ-UX-4a792f34, REQ-FUNC-c746b7e9, REQ-DATA-6e0c4376, REQ-DATA-90783aa2, REQ-FUNC-12403e85, REQ-REL-cf1ce2bd
parent:
branch: ddp/epic-298
base: b8e8d0d494d320487d17e9cc4268b9adbd40fe9c
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

Problem: STATED — Gitea #301 and the EMB-03 plan identify an Indexing page with one model and no switch workflow.
Desired outcome: STATED — the user can confirm a switch for a counted set of workbench documents, continue keyword searches, and use the new semantic model after rebuilding.
Actors: STATED — a VERA user editing a writable workbench.
Primary scenario: STATED — Edit workbench > Indexing, select Multilingual E5 Small, Save, confirm, observe background progress, then search a Romanian fixture by meaning.
Examples: STATED — EMB-03-A confirms a real native switch to E5; EMB-03-B cancels and keeps BGE and its vectors.
Counterexamples: STATED — cancel leaves the saved model and vectors intact; other workbenches keep their vectors.
In scope: STATED — both registered choices, confirmation count, background vector replacement and keyword continuity, four-language UI/help/release notes and focused proof.
Out of scope: STATED — EMB-04 packaging, automatic selection, cloud models, and remote ticket changes.
Constraints: STATED — sibling worktree ddp/epic-298 at b8e8d0d494d320487d17e9cc4268b9adbd40fe9c, format 1, pinned tools, targeted validation and independent review. Coordinator owns one authorized local commit.
Success signals: STATED — EMB-03-A/B and the Gitea #301 deliverables.
Evidence: OBSERVED — editor has a disabled one-option selector. Ingester clears all derived rows on embedding configuration change and removes keyword chunks before reprocessing. EMB-02 already routes by model and bounds its passage tokens.
Assumptions: INFERRED — if the new tokenizer changes chunk boundaries, update chunks and their keyword index in one transaction after embedding, while retaining the persisted extraction.
Unknowns: UNKNOWN — availability of a controlled session performance environment for the epic comparison.
Decision-blocking questions: None.
Proposed behaviors: None.

## Requirement coverage

| Behavior | Requirement | Design | Verification |
| --- | --- | --- | --- |
| Choose a registered embedding model | REQ-UX-340c4ce0 | Shared editor selector | Native Electron |
| Confirm the affected document count before switching | REQ-UX-4a792f34 | Counted modal | Native Electron |
| Reject an unconfirmed or stale embedding model switch | REQ-FUNC-c746b7e9 | Validated configuration update | Native Electron |
| Preserve the workbench index when switching is cancelled | REQ-DATA-6e0c4376 | Dismiss before saving | Native Electron |
| Replace vectors for the confirmed workbench model | REQ-DATA-90783aa2 | Persisted extraction and ingest queue | Native Electron and focused core ingest |
| Keep keyword results available during an embedding rebuild | REQ-FUNC-12403e85 | Rebuild marker and lexical ranking | Native Electron and focused core ingest |
| Retain searchable text on embedding rebuild failure | REQ-REL-cf1ce2bd | Preserve rows and report failed progress | Native Electron and focused core ingest |

## Design

**Approach**
- STATED — REQ-UX-340c4ce0 and REQ-UX-4a792f34 use the shared selector and an accessible counted confirmation in the editor.
- INFERRED — REQ-FUNC-c746b7e9 binds confirmation to the existing workbench, source model and indexed count through the config update boundary. The publication queue keeps the count stable during the durable write and vector invalidation.
- STATED — REQ-DATA-6e0c4376 makes dialog cancellation a dismissal before any write.
- INFERRED — REQ-DATA-90783aa2 uses the writable workbench DB, persists rebuild intent and discards old vectors after the config save. Ingest reuses the persisted extraction and publishes vectors and any necessary rechunking in one transaction.
- INFERRED — REQ-FUNC-12403e85 reads persisted rebuild intent before ranking. Keyword search snapshots candidates across asynchronous path checks and uses a source-content revision independent of model-only publication.

**Interfaces and data**
- OBSERVED — YAML is the configuration authority. The existing SQLite indexing fingerprint detects a switch interrupted between YAML and database writes. A per-workbench marker survives close and clears after vector coverage is restored.
- INFERRED — validated extraction can cross the existing process request to reuse the processor. Keep the last good extraction and chunks on processing failures; normal progress records the failing step (REQ-REL-cf1ce2bd).
- OBSERVED — the limit guard continues to govern admission to background processing, source identity is checked before publication, and indexed documents remain owned by the active workbench.

**Files and test seams**
- Native Electron covers both choices, the counted dialog, the IPC rejection, cancellation byte-for-byte, background completion and a real Romanian semantic query.
- Focused core coverage gates the worker and compares extraction and chunks before, during and after rebuilding; test existing rank errors, source freshness, restart and lexical fallback.

**Risks and open decisions**
- INFERRED — newer settings win over in-flight model processing. A stale confirmation must be renewed. Changed sources still follow ordinary source invalidation.
- UNKNOWN — performance proof depends on matching the documented CPU host and completing the isolated measurement.

**Requirement map**
- The coverage table lists the design seam and proof for each requirement.

Diagrams: [diagram_TASK-dd7b8f09.md](diagram_TASK-dd7b8f09.md)

## Log

- 2026-11-19 frame: journal opened
- 2026-11-19 frame: completed; next specify
- 2026-11-19 specify: completed; next design
- 2026-11-19 design: completed; next build
- 2026-11-19 build: red: pinned Vitest embedding-ingest.test.ts -t including a failed rebuild exited 1 because the keyword chunks were empty while vector generation was held. Native embedding-models.spec.ts exited 1 at the model-choice assertion.
- 2026-11-19 build: Windows: pinned Vitest 72 passed and 1 POSIX-only skip across ingest, processor, search and storage. Indexer IPC, bridge consumers and mock 49 passed. Updated embedding-ingest and tooling boundaries 23 passed, including the unrelated failure recovery regression. Pinned Electron embedding-models and indexer passed, then the workbench switch ran again with the final progress, cancellation, stale approval, model isolation and Romanian meaning assertions. Release-note check passed.
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: Windows performance: pinned CLI build and six clean local indexing runs exited 0 on the recorded i5-10210U Windows host. Both models produced 24/24 indexed documents and 24 current vectors per run. BGE median 5.480 s and 333.5 MiB peak working set; E5 8.415 s and 944.4 MiB. Sample timings and method are retained under 06_SoftwareDocu.
- 2026-11-19 validate: Independent review round 1: synchronize indexed count with durable save and vector invalidation; recover interrupted switches before the count guard; scope crash budget per indexing configuration; preserve lexical queries across model-only publication; localize the rebuild ranking message.
- 2026-11-19 validate: returned to build - Correct the two independent review findings under unchanged scope.
- 2026-11-19 build: Review red: Windows pinned Vitest ingest.test.ts -t keeps the confirmed count stable exited 1 because the pending document became indexed while the YAML write was gated. The corresponding fix defers document publication across count validation and vector invalidation.
- 2026-11-19 build: Round 1 repairs: Windows concurrency, guarded reopen, transient inspection failure, crash retry by model and in-flight lexical search regressions passed. Tool detail localization passed all 26 cases. Windows Electron embedding-models and indexer passed. WSL round 1 passed 55 focused cases and native switching under Xvfb; updated final run is in flight.
- 2026-11-19 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-19 validate: Round 2 platform proof: pinned WSL2 Ubuntu/Xvfb embedding-models.spec.ts passed with real E5 semantic retrieval and counted cancellation, and the three focused concurrency/recovery/rechunking regressions passed. Windows pinned typecheck passed with the final test fixture typing.
- 2026-11-19 validate: Round 2 quality review found that the failed publication used a retention decision made before the save acquired the rebuild marker. A superseded worker error could also publish a failed row for the newly selected model. Returning to build to gate those decisions together.
- 2026-11-19 validate: returned to build - Gate failure retention and discard errors from superseded embedding settings.
- 2026-11-19 build: Round 2 repair red: pinned Vitest ingest.test.ts -t when the previous model fails exited 1. A pending document became terminal failed after Save instead of reaching indexed with the new model.
- 2026-11-19 build: Round 2 repair green: pinned Windows Vitest embedding-ingest.test.ts and ingest.test.ts exited 0, with 35 passed and one POSIX-only skip. The gated save covers both completion and failure from the previous model. Superseded errors are discarded within the publication queue, and attempts are tracked by source and embedding settings.
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: Round 3 runtime proof: Windows pinned npm run test:e2e -- --serial-only embedding-models.spec.ts indexer.spec.ts exited 0 (two native cases). WSL2 pinned Vitest gated save success/failure and retained-text recovery exited 0 (three cases). Windows and WSL2 both proved native EMB-03-A/B during validation.
- 2026-11-19 validate: Both independent reviewers approved the complete unstaged candidate against b8e8d0d494d320487d17e9cc4268b9adbd40fe9c in round 3. Prior race and localization findings are resolved.
- 2026-11-19 validate: Final: python .agentic/aegis.py check --task TASK-dd7b8f09 --strict --run exited 0. Pinned lint, typecheck, i18n and help passed. The 35 advisories consist of 25 unrelated record warnings, six required help/release/changelog paths outside AEGIS layout globs, and four adjacent tests also classified as source by the broad globs. Pinned npm run check:release-notes and git diff --check exited 0. Removed the task-owned WSL2 mirror and temporary scripts. The raw benchmark and final check receipts remain under evaluation-outputs/emb-03.
- 2026-11-19 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-19 | decision=The coordinator may make one local commit after validation; this chat returns the complete unstaged candidate. | reason=User-authorized separate-session workflow in the existing sibling worktree. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-dd7b8f09.md
changed: Confirmed per-workbench embedding switch, background vector rebuild, keyword continuity, and four-language UI/help/notes.
evidence: Strict AEGIS and release notes exited 0. Native EMB-03-A/B passed on Windows and WSL2. Focused regressions passed and both independent reviews approved round 3.
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-19)

- stage: validate; type: feature; branch: ddp/epic-298
- requirements:
  - REQ-UX-340c4ce0 - Choose a registered embedding model
  - REQ-UX-4a792f34 - Confirm the affected document count before switching
  - REQ-FUNC-c746b7e9 - Reject an unconfirmed or stale embedding model switch
  - REQ-DATA-6e0c4376 - Preserve the workbench index when switching is cancelled
  - REQ-DATA-90783aa2 - Replace vectors for the confirmed workbench model
  - REQ-FUNC-12403e85 - Keep keyword results available during an embedding rebuild
  - REQ-REL-cf1ce2bd - Retain searchable text on embedding rebuild failure
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base b8e8d0d: 50 file(s) changed, 1385 line(s) added
- checks: errors=0 warnings=35 notes=38
- checklist: 9/9 done

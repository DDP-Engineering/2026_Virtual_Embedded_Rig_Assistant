# TASK-4226b5fe - Make RAG retrieval resilient during partial workbench indexing (#362)

stage: done
type: change
interaction: autopilot
requirements: REQ-FUNC-12403e85, REQ-FUNC-5e627a51, REQ-FUNC-d3cde7ce, REQ-REL-a85542da, REQ-FUNC-b5c2fe1e, REQ-FUNC-9b31930e, REQ-FUNC-edc2e00a
parent:
branch: ddp/epic-338
base: 70b7a0023441aca0768b2d0406f6f5b8d16043ec
opened: 2026-11-21

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

Problem: OBSERVED search.ts rejects any revision change during asynchronous ranking or path checks. WorkbenchService also turns revision changes during Files validation into NOT_FOUND.
Desired outcome: STATED #362 requires a coherent published subset, bounded transient handling and separate coverage and ranking usage.
Actors: STATED #361/#362 agent search_docs, Files search caller, and users chatting during initial indexing.
Primary scenario: STATED #362 a replay-backed turn searches and cites one committed file while another is still processing.
Examples: STATED #362 a newly published file can invalidate ranking; bounded recovery may return coherent results or report search unavailable.
Counterexamples: STATED #361 a complete search with no matches is a different outcome from partial or unavailable retrieval.
In scope: STATED #362 typed per-search coverage and usage including fallback, isolated live phase source, common Files search semantics, cancellation, source checks, tests, and handoff contract for #363.
Out of scope: STATED delegation and #361/#363 final status collection, sidebar and chat turn UI, inactive workbench indexing, #356, migrations, and remote publication.
Constraints: STATED delegated checkout branch ddp/epic-338 at 70b7a0023441aca0768b2d0406f6f5b8d16043ec; only coordinator may make the user-authorized local commit after verifying the complete unstaged candidate. Focused Windows and practical WSL2 checks and two independent reviews. OBSERVED current search/citation guards and keyword model-rebuild behavior.
Success signals: STATED #362 deterministic conflict during ranking and validation, bounded exhaustion and cancellation, actual modes before/between/after publication and during rebuild, replay with citations, Files contract and source safety, and isolation.
Evidence: OBSERVED tea issues #361, #362, #363; search.ts, ingest.ts, WorkbenchService.searchDocuments, docs.search IPC, SessionService and existing tool.done results.
Assumptions: INFERRED #361/#363 require capturing coverage at the time of retrieval; later indexing phase is separate.
Unknowns: UNKNOWN WSL2 dependency readiness until the focused proof is attempted.
Decision-blocking questions: None.
Proposed behaviors: None pending. #362 explicitly permits bounded retry or a validated snapshot.

## Requirement coverage

| Behavior | Requirement | Design |
|---|---|---|
| Recover coherently from document publication during search | REQ-FUNC-d3cde7ce | Revision check encloses ranking and Files validation |
| Report bounded document search conflicts | REQ-REL-a85542da | Bounded retries and typed unavailability |
| Report coverage of the published workbench index | REQ-FUNC-b5c2fe1e | Live phase from the owned Ingester and immutable tool result |
| Report actual retrieval and use keyword fallback | REQ-FUNC-9b31930e | Structured ranking usage with explicit fallback reasons |
| Cancel document search without returning an interrupted result | REQ-FUNC-edc2e00a | Abort checks at asynchronous boundaries |
| Keyword during embedding rebuild | REQ-FUNC-12403e85 | Capture lexical candidates under the source revision |
| Keyword when indexer cannot rank | REQ-FUNC-5e627a51 | Honor the indexer retry signal and preserve genuine errors |

## Design

**Approach.** OBSERVED the ingester publishes each source atomically. REQ-FUNC-d3cde7ce uses optimistic search over synchronous candidate reads, checking the ranking revision on lazy vector admission, after asynchronous rank and after source and Files locator validation. Typed conflicts discard attempts. REQ-REL-a85542da caps searches at three attempts and uses keyword on the last attempt after two requested-mode conflicts. Known unavailable rank switches to keyword earlier. Ingest continues publishing during all waits.

**Interfaces and data.** REQ-FUNC-b5c2fe1e and REQ-FUNC-9b31930e establish strict `coverage: "complete" | "partial" | "unknown"` and `usage` on search JSON and scoped `docs.search`. Usage reports actual `mode: "keyword" | "semantic" | "hybrid" | null`. Keyword may carry `fallbackReason: "embedding-rebuild" | "semantic-unavailable" | "revision-conflict"`. Null mode has `reason: "no-candidates" | "index-not-ready" | "revision-conflict"`. Exhaustion gives empty results, unknown coverage and reason revision-conflict. Empty results after ranking remain successful. Active scan/index, known exceptions or a count guard imply partial coverage. A read-only snapshot and unknown live phase imply unknown coverage. Complete coverage requires a settled selection at admission and result return.

OBSERVED `SessionService` owns a root and DB. The call's `tool.done` event and folded tool item persist validated `documentSearch` metadata alongside the summary, and Agent projection preserves coverage and usage in the tool JSON. Desktop and CLI supply `WorkbenchService.documentIndexPhase(id, db?)`, scoped to the live owner. Core phases are scanning, indexing, settled, settled-with-exceptions, blocked, read-only and unknown. Initial and queued passes stay unsettled. For #363 this signal complements existing volume, guard, document, rebuild and indexer state. #363 owns consolidated snapshots, updates, counts and per-turn display and should read the tool item's `documentSearch` for historical coverage.

**Files and test seams.** Move ranking to knowledge/search-ranking.ts. WorkbenchService supplies DocumentViewer's current-source and locator filter inside the same checked attempt. Files consumes typed availability in its existing result area. The existing localized embedding-rebuild tool detail reads the new usage field. Search tests pause ranking and source checks. Workbench, IPC and renderer tests cover Files bounds and responses. A replay session retrieves and cites a committed file during real blocked ingest.

**Risks and open decisions.** Abort takes priority at asynchronous boundaries (REQ-FUNC-edc2e00a). The keyword revision preserves a captured lexical result during model-only replacement (REQ-FUNC-12403e85). Vector acquisition reads the effective model and checks the attempt revision. Expected interrupted indexer errors and typed embedding deadlines use keyword; unexpected ranking failures still surface (REQ-FUNC-5e627a51, REQ-FUNC-9b31930e). Agent and Display masking protect free text while retaining structural metadata (REQ-FUNC-b5c2fe1e). No persisted format change.

**Requirement map.** The coverage table records each design decision; focused proof attaches to search, workbench, live ingest/replay and shared/desktop Files tests.

Diagrams: [diagram_TASK-4226b5fe.md](diagram_TASK-4226b5fe.md)


## Log

- 2026-11-21 frame: journal opened
- 2026-11-21 frame: Coordinator has user authorization for the local issue commit after verifying the complete unstaged candidate; implementer must leave everything unstaged.
- 2026-11-21 frame: completed; next specify
- 2026-11-21 specify: completed; next design
- 2026-11-21 design: completed; next build
- 2026-11-21 build: red: focused Vitest search and WorkbenchService (windows-red.log), exit 1; five expected failures for revision conflicts, missing live phase and Files NOT_FOUND; two cancellation checks already pass (REQ-FUNC-d3cde7ce, REQ-REL-a85542da, REQ-FUNC-b5c2fe1e, REQ-FUNC-9b31930e, REQ-FUNC-edc2e00a)
- 2026-11-21 build: green: pinned Vitest on Windows, windows-focused.log exit 0 (171/171, nine focused files), windows-ingest-phase.log exit 0 (64/64 on the updated two files), windows-cli-boundaries.log exit 0 (18/18 CLI and boundary checks); all new retrieval requirements plus the existing rebuild and indexer fallback requirements.
- 2026-11-21 build: Scoped advisory exit 0 with no errors. The layout globs classify colocated tests as source despite linked_tests and omit the mandated changelog/release notes; global historical metadata warnings stay outside this candidate.
- 2026-11-21 build: completed; next validate
- 2026-11-21 validate: Review round 1: specification found loss of per-tool coverage/usage when Agent or Display scrubbing matches protocol words; quality found real embedding queue and rank deadlines did not enter safe keyword fallback.
- 2026-11-21 validate: returned to build - Preserve structured retrieval metadata through Agent and Display masking; classify known semantic ranking deadlines for keyword fallback
- 2026-11-21 build: red after round 1: pinned focused Windows Vitest exit 1, windows-review-red.log; four expected failures for raw masked metadata, typed event projection, deadline classification and keyword fallback.
- 2026-11-21 build: green after round 1: pinned focused Windows Vitest exit 0 (256/256, 17 files; windows-final-focused.log), including replay and Display masking collisions, typed active/queued embedding deadlines, IPC propagation, source checks, native CLI and import boundaries.
- 2026-11-21 build: completed; next validate
- 2026-11-21 validate: Round 2 specification and implementation quality approved. Both independently checked the complete candidate and original Windows 256/256 receipt; see reviews.txt. Project profile and component pages reconciled, no environment configuration changed.
- 2026-11-21 validate: WSL2 pinned Node 24.21.0: 141 unique focused cases pass across nine files, combining wsl-final-focused.log (139 passing, including real CLI and replay) and wsl-worker-final.log (7/7, including both rerun cases after building the scratch shared dist). Owned Linux scratch removed; original receipts retained in 02_Tools/runtime/issue-362-proof.
- 2026-11-21 validate: Strict proof exit 1: i18n scanner rejected dynamic lookup arguments in Files and the existing tool detail. Lint, typecheck and help all passed; see windows-strict-before-i18n-fix.log.
- 2026-11-21 validate: returned to build - Use static translation calls for the existing search result branches and rerun affected checks
- 2026-11-21 build: Green: literal i18n lookups pass the pinned check:i18n in en/ro/de/fr; focused Windows Docs tree and tool details 46/46 exit 0, windows-renderer-final.log. Other focused Windows and WSL2 receipts still cover unchanged source/tests.
- 2026-11-21 build: completed; next validate
- 2026-11-21 validate: Round 3 independently approved for both specification and implementation quality after the literal translation-key update; reviewers checked original 46/46 rerun and clean whitespace.
- 2026-11-21 validate: final: python .agentic/aegis.py check --task TASK-4226b5fe --strict --run exit 0; lint, typecheck, i18n and help passed. Pinned npm run check:release-notes exit 0. Forty non-promoted advisories concern historical records and layout classification of tests/changelog/release notes; there are no product-source coverage warnings or strict errors.
- 2026-11-21 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-4226b5fe.md
changed: Issue 362 complete; unstaged candidate for coordinator commit
evidence: Strict AEGIS and release notes exit 0; Windows 256/256 with 46/46 renderer rerun; WSL2 141/141
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-21)

- stage: done; type: change; branch: ddp/epic-338
- requirements:
  - REQ-FUNC-12403e85 - Keep keyword results available during an embedding rebuild
  - REQ-FUNC-5e627a51 - Fall back to keyword search when the indexer cannot rank
  - REQ-FUNC-d3cde7ce - Recover coherently from document publication during search
  - REQ-REL-a85542da - Report bounded document search conflicts
  - REQ-FUNC-b5c2fe1e - Report coverage of the published workbench index
  - REQ-FUNC-9b31930e - Report actual retrieval and use keyword fallback
  - REQ-FUNC-edc2e00a - Cancel document search without returning an interrupted result
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 70b7a00: 53 file(s) changed, 1421 line(s) added
- checks: errors=0 warnings=40 notes=42
- checklist: 9/9 done

# TASK-b6bdee40 - DELEG-01 Create and scope delegated sessions in core (#326)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-5d37a301, REQ-FUNC-a66961fa, REQ-REL-fee9f45e, REQ-REL-2a7d075f, REQ-REL-35d1f9d1, REQ-FUNC-e02ca123, REQ-SEC-1f5f2586, REQ-SEC-9d1e28e5, REQ-DATA-91d2e2ec, REQ-DATA-aeb6319d, REQ-REL-75fa183f
parent:
branch: ddp/epic-298
base: 2041a2729c1787342d8c197fcc2eb1fc9dc1c379
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

Problem: STATED (#326) Sessions lack a durable parent-child relationship and scoped child controls.
Desired outcome: STATED (#326, #325) A same-workbench parent launches an independent inspection-only child with selected model and reasoning, and can inspect or stop its own children.
Actors: STATED (#325) The parent and child agents and the VERA user. Core trusts the host to supply the calling session identity.
Primary scenario: STATED (#326) Replay holds a child turn open while the parent continues.
Examples: STATED (coordinator) Replay a read of a fixture note in an isolated workbench.
Counterexamples: STATED (#326) Reject recursive delegation, unrelated or foreign-workbench access, and persistent mutation by child tools.
In scope: STATED (#326) Core launch, idempotency, model and reasoning, ownership, bounded concurrency, tool policy, durable links and interruption, archival and deletion.
Out of scope: STATED (coordinator and #325) Tool registrations (#327), Desktop UI (#328), remote writes and full suites.
Constraints: STATED (coordinator) Existing sibling checkout at 2041a2729c1787342d8c197fcc2eb1fc9dc1c379 on ddp/epic-298. Coordinator makes the user-authorized local commit after handover. Pre-release format remains 1.
Success signals: STATED (#326) Replay verifies independence and configuration. Focused tests check invalid options, retries, concurrent admission, direct denials and restart.
Evidence: OBSERVED tea issues 326/325 exit 0, Git verified clean worktree and base, SessionService already owns runtime admission and recovery.
Assumptions: STATED (#326) The implementation chooses the documented bound and archive/delete behavior.
Unknowns: UNKNOWN Real provider or UI behavior outside core acceptance.
Decision-blocking questions: None.
Proposed behaviors: INFERRED from #326's requested design choices. Allow three active child turns per workbench. Keep both sides of archived links. Allow child-first deletion and keep the request key until parent deletion. Default to the parent's effective model and the selected provider's normal reasoning default.

## Requirement coverage

| Requirement | Behavior | Design seam |
|---|---|---|
| REQ-FUNC-5d37a301 | Start independent delegated turns | sessions/service.ts, sessions/delegation.ts |
| REQ-FUNC-a66961fa | Reject invalid delegated launch options | sessions/service.ts, sessions/delegation.ts |
| REQ-REL-fee9f45e | Roll back failed delegated turn admission | sessions/service.ts, storage/schema.ts, repos/delegations.ts |
| REQ-REL-2a7d075f | Replay identical delegated launch requests | sessions/service.ts, storage/schema.ts, repos/delegations.ts |
| REQ-REL-35d1f9d1 | Reject reused delegation keys with different input | sessions/service.ts, storage/schema.ts, repos/delegations.ts |
| REQ-FUNC-e02ca123 | Bound concurrent delegated turns | sessions/service.ts |
| REQ-SEC-1f5f2586 | Scope delegated controls to the owning parent | sessions/service.ts, storage/schema.ts, repos/delegations.ts |
| REQ-SEC-9d1e28e5 | Enforce inspection-only delegation tools | sessions/service.ts, tools/registry.ts, tools/context.ts |
| REQ-DATA-91d2e2ec | Preserve archived delegation history | sessions/service.ts, storage/schema.ts, repos/delegations.ts |
| REQ-DATA-aeb6319d | Protect delegation links at deletion | sessions/service.ts, storage/schema.ts, repos/delegations.ts |
| REQ-REL-75fa183f | Recover interrupted delegated turns | sessions/service.ts, storage/schema.ts, repos/delegations.ts |


## Design

### Approach

- REQ-FUNC-5d37a301, REQ-FUNC-a66961fa, REQ-REL-fee9f45e — SessionService resolves and prepares an explicit model or the parent's effective default, checks reasoning against the gateway, then uses the existing runtime and separate child transcript. Initial user and turn events, the child row and request identity are one SQLite transaction. Initial events publish after commit. The persistence barrier holds child runtime metadata preparation, inference and tools until admission. Preparation can be interrupted while the provider is pending. First inference uses the selected effort or settles with an error if refreshed capabilities withdrew it. Rollback detaches and aborts a provisional turn.
- REQ-REL-2a7d075f, REQ-REL-35d1f9d1, REQ-FUNC-e02ca123 — A per-parent request key and digest of the normalized explicit inputs enable exact retries. Alternate input and deleted results conflict. Recheck after asynchronous model preparation, then admit synchronously, with at most three active delegated turns across the workbench, including user turns in an existing child.

### Interfaces and data

- REQ-SEC-1f5f2586 — launchDelegated, listDelegated, inspectDelegated, subscribeDelegated and stopDelegated take the host-supplied caller identity. Resolve IDs only against the captured workbench database. Only a root session can be a parent. delegationParent provides the relationship to the trusted host. The existing user operations continue to apply.
- REQ-SEC-9d1e28e5 — Give the child read-only mode and no extra-folder grants. An explicit canonical built-in inspection list at ToolRegistry bind, execute and prepare rejects unreviewed tools, misleading read classes and replaced names. The service filters provider requests and denies child write/program approvals before preparing any request. PermissionEngine may narrow the remaining tools.
- REQ-DATA-91d2e2ec, REQ-DATA-aeb6319d, REQ-REL-75fa183f — SQLite format 1 adds session_delegations with parent and child foreign keys. Archive retains links. Delete children first. Child deletion nulls the live link and retains the request key until parent deletion. Reopen retains all surviving links and uses normal interrupted-turn recovery.

### Files and test seams

- OBSERVED SessionService owns launch, normal turns, shutdown and archival. Add a focused delegation contract module and repository. ToolContext and ToolRegistry carry and enforce the scope.
- Targeted sessions/delegation.test.ts uses real SQLite, guarded read fixtures, replay with a gated child, a trusted permissive permission seam, and an interrupted database snapshot. Use existing session, approval, tool and storage tests for regressions.

### Risks and open decisions

- Synchronous event persistence and deferred publication protect the crash boundary and prevent observers from seeing a child rolled back at startup. Recheck session ownership after asynchronous model preparation. Aegis pre-release storage policy keeps version 1 and applies the schema change in place.

### Requirement map

- The coverage table maps each requirement to its implementation seam. The focused delegation test asserts the corresponding paths.

Diagrams: [diagram_TASK-b6bdee40.md](diagram_TASK-b6bdee40.md)


## Log

- 2026-11-19 frame: journal opened
- 2026-11-19 frame: User authorizes the coordinator to make the local validated ticket commit. Implementation chat hands over a complete unstaged and uncommitted candidate; remote publication is outside scope.
- 2026-11-19 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-19 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-19 design: completed; next build
- 2026-11-19 build: red: pinned npmw.py npx vitest run src/libraries/core/src/sessions/delegation.test.ts exit 1, eight tests reach missing launchDelegated entry point (REQ-FUNC-5d37a301, REQ-FUNC-a66961fa, REQ-REL-fee9f45e, REQ-REL-2a7d075f, REQ-REL-35d1f9d1, REQ-FUNC-e02ca123, REQ-SEC-1f5f2586, REQ-SEC-9d1e28e5, REQ-DATA-91d2e2ec, REQ-DATA-aeb6319d, REQ-REL-75fa183f).
- 2026-11-19 build: red: focused reentrant case exit 1; a nested bookmark event overtakes a title event already recorded in the initial batch.
- 2026-11-19 build: green: pinned npmw.py npx vitest run explicitly selected sessions, approvals, programs, bypass, storage, replay, registry, folder, import-boundary and Desktop SessionHost consumers, exit 0 (13 files, 162 tests). After test-only assertion refinements the delegation file rerun exited 0 (10 tests).
- 2026-11-19 build: Native Linux x64 (Ubuntu WSL2), pinned Node v24.21.0: npmw.py node ../02_Tools/runtime/deleg-326-proof/wsl-replay.mjs exit 0. Verified actual SQLite/ReplayGateway inspection, unsupported tool denial, selected reasoning, persisted exact retry and interruption recovery. WSL Vitest startup was unavailable with the Windows workspace optional dependency set; Windows ran the focused Vitest cases.
- 2026-11-19 build: Current AEGIS advisory exits 0 with 0 errors; existing repository warnings remain under the ticket scope. Evolution reviewed against the authorized base.
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: Round 1: validate stock replay model names, pin and revalidate first-request reasoning, deny plugin-loading help in child scope, make launch and runtime preparation abortable and defer the runtime preparation until commit, remove duplicated historical changelog note and preserve localized detail.
- 2026-11-19 validate: returned to build - Independent round 1 findings and coordinator documentation correction.
- 2026-11-19 build: red: targeted delegation and replay files exit 1, six confirmed round-1 regressions: stock replay preflight, silent reasoning fallback, pre-commit runtime preparation, pending-launch cancellation, active-child cancellation and plugin help access.
- 2026-11-19 build: Round 2 initial affected Windows check: 120 passed, one existing reasoning-picker test failed because its virtual replay names lacked scenarios. Its unchanged assertions now use actual named fixtures under the stock preflight contract.
- 2026-11-19 build: Round 2 fixes verified. Pinned Windows affected Vitest: nine files passed and the first pass exposed an existing fixture with unconfigured replay references. After using real scenario files, the service rerun exited 0 (35 tests), completing 121 affected tests across ten files. Reused the unaffected database/repository/import-boundary results. Native WSL SQLite and replay smoke exited 0 on rebuilt sources. Release notes check exited 0 (three files).
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: final: python .agentic/aegis.py check --task TASK-b6bdee40 --strict --run exit 0. Lint, typecheck, i18n and help passed. The 31 advisories concern legacy record metadata, mandatory release documents outside AEGIS globs and test files classified as source under a broad AEGIS glob. Relevant tests are linked and were executed. Both independent reviews approved round 2 with no open findings. The reviewed file manifest matches the final non-journal candidate. Original command receipts are under ignored 02_Tools/runtime/deleg-326-proof.
- 2026-11-19 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-b6bdee40.md
changed: DELEG-01 core sessions, storage, inspection policy, replay and final Unreleased documentation.
evidence: AEGIS strict run exit 0. Pinned Windows focused tests, WSL2 native SQLite/replay smoke and release-note check passed.
issues: No open review findings. WSL proof is the native smoke because the checkout has Windows Vitest dependencies.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-19)

- stage: validate; type: feature; branch: ddp/epic-298
- requirements:
  - REQ-FUNC-5d37a301 - Start independent delegated turns
  - REQ-FUNC-a66961fa - Reject invalid delegated launch options
  - REQ-REL-fee9f45e - Roll back failed delegated turn admission
  - REQ-REL-2a7d075f - Replay identical delegated launch requests
  - REQ-REL-35d1f9d1 - Reject reused delegation keys with different input
  - REQ-FUNC-e02ca123 - Bound concurrent delegated turns
  - REQ-SEC-1f5f2586 - Scope delegated controls to the owning parent
  - REQ-SEC-9d1e28e5 - Enforce inspection-only delegation tools
  - REQ-DATA-91d2e2ec - Preserve archived delegation history
  - REQ-DATA-aeb6319d - Protect delegation links at deletion
  - REQ-REL-75fa183f - Recover interrupted delegated turns
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 2041a27: 33 file(s) changed, 1373 line(s) added
- checks: errors=0 warnings=31 notes=38
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

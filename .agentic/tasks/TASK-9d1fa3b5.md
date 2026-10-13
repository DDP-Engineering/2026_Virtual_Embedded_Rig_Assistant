<!--
Copyright (c) 2026 DDP Engineering
This software is licensed under the PolyForm Noncommercial License 1.0.0.
Commercial use requires a separate commercial license.
See the LICENSE.txt in the .agentic folder for full license details.
SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
-->


# TASK-9d1fa3b5 - WP-35 Messages during a running turn

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-63733e2c, REQ-UX-8b320385, REQ-UX-3001bd00, REQ-UX-4bea0003, REQ-REL-384b6464
parent:
branch: master
base: 80a728a755202fc131860cd89a0705f6b2106445
opened: 2026-10-13

## Done checklist (current stage)

- [x] Final reviewed candidate unchanged after strict static proof; exact manifest provided.
- [x] Scope/diff/results/exclusions/authorized next action presented to coordinator.
- [x] Standing local-commit authority recorded; implementer has no staging/commit/publication authority.
- [x] Journal and reusable raw static/review receipts prepared.
- [x] Coordinator verifies unchanged candidate/deviation and confirms standing authorized local ticket commit.
- [x] Coordinator closes before local-only commit outcome; actual SHA stored atomically in cycle/receipt.

## Frame

Problem: STATED WP35 requires steering; OBSERVED active SessionService.send and composer currently refuse it.
Desired outcome: STATED messages queued in a running turn reach the next model call and display pending until delivery.
Actors: User, renderer, shared IPC/projection, core SessionService and ReferenceRuntime.
Primary scenario: Send between tools -> durable queued event -> source-order batch completes -> budgeted next model request includes message -> durable delivered event clears pending.
Examples: User requests a different board pin while two read tools execute.
Counterexamples: Approval wait, stopping/finishing turn, read-only workbench and failed persistence refuse admission.
In scope: Queue admission/delivery, lifecycle/restart, current-turn compaction preservation, shared events, composer/transcript/mock, focused authored scenarios and affected documentation.
Out of scope: Runtime test execution, M4/M5/full/Ubuntu/release builds, refactoring, dependency/model/runtime pins, profiles, historical scratch, cycle/helper/receipts, commit/staging/publication/issue mutation.
Constraints: STATED master/autopilot, base80a728a755202fc131860cd89a0705f6b2106445; only one implementer; two independent read-only reviewers authorized; coordinator owns standing local-commit authorization. Protected optional-companions SHA2562a69f5b335a53e498b1f8e30fa5adb8096e870e7a12bbc05b0727a03cee72c6b.
Success signals: Both planned runtime Done observations, retained as NEEXECUTATE/deferred in this stage; static lint/typecheck/i18n/strict and current independent verdicts.
Evidence: STATED delegated prompt and verificationOverride in02_Tools/cache/implementation-cycle.json; OBSERVED00_Planning/plan/M5-version-1.md WP35, architecture03 section2/8 and06 section3; source agent/runtime.ts, sessions/service.ts, shared/events.ts/session-state.ts and renderer composer/workspace.
Assumptions: INFERRED undelivered queued messages stay durable/pending after abort/limit/restart and enter the next normal request. Delivery means admitted to the bounded normal model request, with durability before external dispatch.
Unknowns: Runtime behavior remains unobserved under the direct test-execution deferral.
Decision-blocking questions: None.
Proposed behaviors: Three coverage rows below; queue order is FIFO, pending recovery precedes a newly submitted idle instruction in the request view.
Path and reason: Full; new externally visible behavior/interface/events/data projection=yes, existing requirement covers exact behavior=no, new dependency=no, data handling changes=yes. One cohesive task; no implementation subagents.

## Requirement coverage

| Outcome | Atomic behavior | Requirement | Positive | Boundary | Verification | Design |
|---|---|---|---|---|---|---|
| Steering | Next normal request includes durable queue | REQ-FUNC-63733e2c | Between two tools | Approval/stop/limit/restart/summary | sessions/service.test.ts; runtime steering test | Host queue snapshot, bounded prospective context, ordered delivered transaction |
| Composer | Running input/send available except approval | REQ-UX-8b320385 | Enter or Send while running | Pending/read-only/approval; model still locked | workspace.test.ts | Text/send lock separate from model lock; retain Stop |
| Pending | Queued marker cleared by delivery | REQ-UX-3001bd00 | Replay/live same user item | Abort/restart retains pending; legacy optional | session-state.test.ts; chat-ui.spec.ts | Durable queued/delivered, optional pending/timestamp fields |
| Existing composer | Retained keyboard/path/model contract | REQ-UX-4bea0003 | Running queue accepted | Approval/model locks | workspace.test.ts (deferred) | Reconcile existing verification/spec |
| Existing stop | One terminal abort and one runtime turn | REQ-REL-384b6464 | Stop with queued text | Late sends BUSY | service.test.ts (deferred) | Preserve stop with new queue admission |

## Design

REQ-FUNC-63733e2c: SessionService owns the durable FIFO queue through message.queued events (messageId,text,timestamp). RuntimeHost offers an optional detached queue snapshot; runtime tracks already admitted IDs and reads only at normal-request boundaries, after the full tool batch. Initial persistence stays synchronous; queued admission records before publication and never mutates the in-flight transcript. Finishing/stopping/failed turns and durable undecided approvals return BUSY.
REQ-FUNC-63733e2c and WP34 constraint: Capture the original turn history boundary, preserve every current user/steering instruction from compaction, snapshot queue before compaction and once after its await, then re-budget the complete normal request without a second summary attempt. Commit prospective transcript and delivered events only for a fitting request; host gateway waits ordered persistence. On terminal assistant stop, continue if queue exists. Runtime limits/abort leave unapplied queue durable for the next turn. Recovered pending instructions enter before the new instruction in the provider view; persistence keeps original message arrival records intact.
REQ-UX-3001bd00: Optional pending/timestamp on user projection preserve old snapshots/events. Queued adds one user item; delivered clears marker idempotently. Both events durable via existing hub/IPC/schema, no DB migration. Pending messages remain in event-backed transcript if interrupted.
REQ-UX-8b320385: Composer retains editable text and Send beside Stop while running, locks text/send during approval and pending/read-only operations, retains model lock. Workspace guards approval and concurrent submits; mock exercises same event projection. Catalog keys localized inen/ro/de.
Security/operations: Existing ownership, exact IPC authorization, scrub/durable dispatch/approvals, sandbox/CSP and pins unchanged. No API calls/builds/test execution. Reentrant subscriber admission and cancellation must not duplicate or strand queue. Alternative immediate append rejected because it splits outstanding tool-call/result pairs; separate queue DB schema unnecessary because durable events already own transcript state.
Architecture: Existing runtime -> service -> hub -> shared reducer -> UI boundaries remain; optional queue host callback and delivered events extend them. No new component diagram required.
Expected files: agent runtime/types/compaction, sessions service, shared events/state, composer/workspace/transcript/mocks/locales; focused test files and affected knowledge/context/specs. Risk: asynchronous compaction/persistence admission race; reviewed statically, runtime proof deferred. Open decisions: None.

## Log

- 2026-10-13 frame: Full path accepted in explicit autopilot; base/master confirmed, protected pre-existing untracked draft excluded; coordinator owns local commit.
- 2026-10-13 specify: Three atomic requirements created; existing composer specification reconciled in task scope for M5 steering.
- 2026-10-13 design: Cohesive event-backed queue with bounded request admission and current-turn compaction boundary; see Design.
- 2026-10-13 DEVIATION validate: Direct user instructions defer all runtime/unit/integration/E2E/CLI/package/smoke/full tests and milestone builds/gates, including test-first execution; both WP35 runtime Done criteria NEEXECUTATE/deferred. M4 remains incomplete, not PASS. Static checks and two independent read-only reviews retained.

- 2026-10-13 build: Durable queued/admitted batches, protected current-turn boundary and localized running UI implemented. Authored integration/runtime/reducer/UI/E2E cases without executing them. Existing composer/stop requirements revised for M5 scope; no failing/passing runtime results claimed. Protected draft unchanged; final proof pending.

- 2026-10-13 validate review round1: spec_review and quality_review independently returned changes_required on candidate d2119680f14d711453966cfa6dd58ed19b3425248db2f2c6c5d3b9c2723fee14, sole relevant P2: write preparation/approval rejection could leave admission locked. Matching call-ID tracking now clears on approval.decided or tool.done; authored deferred failure-path regression. Both prior verdicts invalidated; round2 pending.

- 2026-10-13 validate review round2: independent /root/spec_review spec_compliance=approved and /root/quality_review implementation_quality=approved; all32 non-journal paths match candidate SHA2560b8e4d6619c48ef6f9d4afa259ad5b241b1b2dca9718552dd5ab78a73780889e. Both reused unchanged round1 scope and re-read correction/deferred regression/full journal; no tests/builds/statics/writes by reviewers. Raw verdict receipts in02_Tools/cache/wp35/implementer-TASK-9d1fa3b5/reviews.json.

- 2026-10-13 validate final proof: `python .agentic/aegis.py evolution --task TASK-9d1fa3b5` exit0, reviewed19 non-agentic changed files (1 added,18 modified,0 removed), matches scope/protected prior draft preserved. `python .agentic/aegis.py check --task TASK-9d1fa3b5 --strict --run` exit0: lint ok2.7s, typecheck ok9.0s, i18n ok1.0s; test explicitly skipped by configured [check]. errors0 warnings14 notes3: historical journal/ruling/Handoff/demo-reference warnings and prior manual obligations are outside this task. No current-task format/coverage findings. Full raw log/command timestamps/exit/SHA receipts in02_Tools/cache/wp35/implementer-TASK-9d1fa3b5/final-statics.json and final-strict.log. Non-journal candidate hashes still equal both round2 approved reviews.
- 2026-10-13 deliver handback: Complete33-path unstaged candidate prepared for coordinator on unchanged master/base80a728a755202fc131860cd89a0705f6b2106445. No commit, staging, push, PR, publication, issue mutation, runtime test, build/gate or historical scratch/profile modification. The two planned runtime Done criteria remain NEEXECUTATE/deferred, M4 remains incomplete, not PASS; no implementation blocker remains. Coordinator next: inspect exact manifest/current diff and reuse original proof, then record close-out and make one standing-authorized local ticket commit.

- 2026-10-13 deliver advisory: report/no-run strict exit0 has errors0 warnings15 notes3:14 historical warnings plus expected unticked-deliver for the two coordinator-owned commit/close-out items. No statics/runtime rerun. Automatic Delivery report counts34 paths including the protected pre-existing untracked draft; exact owned handoff manifest excludes it and records33 paths. Only journal metadata changed after final static proof; all32 reviewed non-journal hashes remain identical.

- 2026-10-13 coordinator delivery: inspected exact33owned candidate files/fulljournal/Done/requirements/spec/currentknowledge/production and authoreddeferredscenario diff. All33current fileSHA and original rawstaticreceipt/logSHA verified; both originalround2independent final verdicts approved candidate0b8e4d...; all32nonjournal identity agrees currentmanifest/reviews/staticproof. Existing static0 lint/typecheck/i18n and strict reused; no coordinator runtime/static reruns or historicalcacheaudit. TwoRuntimeDone remain explicitly unexecuted under directhumaninstruction; M4 incomplete, not PASS; accepted sourceimplementation under recorded testdeferral. Standing one localcommit authority confirmed, human draft excluded. Closeout before local-onlycommit per deliverstep7; actualSHA saved atomically in cycle/receipt before WP36. No remote publication.

## Runtime Done (not executed)

- [ ] Integration: steering sent between two tool calls reaches the next model call â€” NEEXECUTATE/deferred, authored service.test.ts scenario only.
- [ ] E2E: pending marker disappears at delivery â€” NEEXECUTATE/deferred, authored chat-ui.spec.ts scenario only.
- All runtime/unit/integration/E2E/CLI/package/smoke/full suites and M4/M5/Ubuntu/release gates were not executed. M4 incomplete, not PASS. Static checks and source-review verdicts are the only observed validation for this candidate.

## Rulings

- RULING-001 | date=2026-10-13 | decision=master/autopilot candidate-only implementation; coordinator has standing authority for one local ticket commit; implementer does not stage/commit/publish | reason=explicit task delegation and AGENTS.md | source=user | supersedes=none
- RULING-002 | date=2026-10-13 | decision=runtime test execution deferred; static checks and two read-only reviewers retained | reason=direct human development priority, verified in implementation-cycle verificationOverride; no fabricated results | source=user | supersedes=none

## Handoff


current: done
status: ready
next: Coordinator makes single authorized local commit then starts WP36; runtimeproof deferred.
must_read: .agentic/tasks/TASK-9d1fa3b5.md, 02_Tools/cache/wp35/implementer-TASK-9d1fa3b5/handoff-manifest.json, 02_Tools/cache/wp35/implementer-TASK-9d1fa3b5/final-strict.log, 02_Tools/cache/wp35/implementer-TASK-9d1fa3b5/reviews.json
blockers: Runtime acceptance deferred by user; no implementation blocker.

## Stage report


stage: deliver
result: completed
current: done
changed: Runtime/session durable steering, shared projection, running composer/transcript/mock, authored deferred scenarios and current docs.
evidence: Strict statics exit0: lint/typecheck/i18n ok; errors0 warnings14 notes3 historical. Both reviews approved round2; exact33-path manifest/raw receipts. Runtime Done deferred.
issues: Both WP35 runtime Done criteria deferred; M4 incomplete, not PASS.
next: Coordinator makes single authorized local commit then starts WP36; runtimeproof deferred.
needs_user: no
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-10-13)

- stage: deliver; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-63733e2c - Deliver queued steering at the next model request
  - REQ-UX-8b320385 - Keep the running composer available outside approval waits
  - REQ-UX-3001bd00 - Show queued user messages as pending until delivery
  - REQ-UX-4bea0003 - Session composer
  - REQ-REL-384b6464 - Serialize and stop session turns
- deviations: 1 recorded
  - validate: Direct user instructions defer all runtime/unit/integration/E2E/CLI/package/smoke/full tests and milestone builds/gates, including test-first execution; both WP35 runtime Done criteria NEEXECUTATE/deferred. M4 remains incomplete, not PASS. Static checks and two independent read-only reviews retained.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 80a728a: 34 file(s) changed, 1100 line(s) added
- checks: errors=0 warnings=15 notes=3
- checklist: 4/6 done; open: Coordinator confirms candidate and makes the single authorized local ticket commit.; Coordinator records close-out in that same commit; no remote publication.

## Delivery report (2026-10-13)

- stage: done; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-63733e2c - Deliver queued steering at the next model request
  - REQ-UX-8b320385 - Keep the running composer available outside approval waits
  - REQ-UX-3001bd00 - Show queued user messages as pending until delivery
  - REQ-UX-4bea0003 - Session composer
  - REQ-REL-384b6464 - Serialize and stop session turns
- deviations: 1 recorded
  - validate: Direct user instructions defer all runtime/unit/integration/E2E/CLI/package/smoke/full tests and milestone builds/gates, including test-first execution; both WP35 runtime Done criteria NEEXECUTATE/deferred. M4 remains incomplete, not PASS. Static checks and two independent read-only reviews retained.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 80a728a: 34 file(s) changed, 1120 line(s) added
- checks: errors=0 warnings=14 notes=3
- checklist: 6/6 done

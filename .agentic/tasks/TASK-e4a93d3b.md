# TASK-e4a93d3b - VERA session questions and workbench timeout (#394)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-96754d71, REQ-FUNC-5fb4cd15, REQ-REL-8c12897d, REQ-SEC-2c57a3ba, REQ-DATA-c75f9512, REQ-UX-59e93f91, REQ-UX-e7ba512c
parent:
branch: ddp/vera-notifications
base: 4ad46dac35544df2397b0abbed2f8f88fda889b1
opened: 2026-11-23

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
- [x] final coordinator-scoped UTF-8, i18n, Help and release-note proof logged after the copy repair
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: STATED (#394): VERA sessions need model-callable, structured clarification.
Desired outcome: STATED: Answer or cancel in the originating session, or apply a valid recommendation after a workbench opt-in delay.
Actors: STATED: Session user, model, and workbench runtime.
Primary scenario: STATED: A question offers choices, a recommendation, free text, and cancellation, and the model resumes with the recorded outcome.
Examples: STATED: Select the recommended choice, explicitly submit it, and see a user answer; leave an eligible question past the deadline and see an automatic answer.
Counterexamples: STATED: Selecting a choice does not submit it; automatic answers never satisfy an approval.
In scope: STATED: Tool, typed session state/events, IPC and guarded focus, existing workbench activity, settings, four languages, transcript and focused checks.
Out of scope: STATED: #392 Activity view, #395 native question delivery, commits and publication by the implementation chat, milestone gate.
Constraints: STATED: ddp/vera-notifications at recorded base, one coordinator-owned local commit, focused checks, independent reviews.
Success signals: STATED: Choice, free text and cancel round-trip; settings are per-workbench and off by default; timers work across renderer lifecycle; concurrent sessions and stop settle only once.
Evidence: OBSERVED: ReferenceRuntime serializes session tools and guards write/program tools separately; SessionHub persists and replays event payloads.
Assumptions: INFERRED: An ordinary interactive desktop turn is the host for questions; the delegated tool allowlist and CLI have no interactive question consumer.
Unknowns: None affecting scope.
Decision-blocking questions: None.
Proposed behaviors: Range and default are routine implementation parameters within the documented-range requirement.

## Requirement coverage

| Requirement | Design seam | Verification |
| --- | --- | --- |
| REQ-FUNC-96754d71 | sessions/service.ts | Send each reply form to a replayed model question and compare its calling turn's result and snapshot. |
| REQ-FUNC-5fb4cd15 | sessions/questions.ts | Advance fake time with and without a valid recommendation and reconnect a session subscriber before the deadline. |
| REQ-REL-8c12897d | sessions/questions.ts | Race a pre-deadline answer and timeout, abort a pending turn, and open simultaneous waits in separate sessions. |
| REQ-SEC-2c57a3ba | sessions/service.ts | Replay an automatic answer followed by a write and assert that the file stays unchanged until the separate approval is granted. |
| REQ-DATA-c75f9512 | workbench.ts | Validate limits and save/reopen independent workbenches with enabled and default settings. |
| REQ-UX-59e93f91 | question-card.tsx | Interact with the card and assert selection alone makes no request, then verify explicit submission and loaded outcomes. |
| REQ-UX-e7ba512c | workbench-activity.tsx | Open a pending question from another workbench and assert focus targets that card while a stale request skips the card. |


## Design

**Approach.** OBSERVED: ReferenceRuntime serializes session tools and has a separate write/program approval path. Add `ask_user` as a session tool and a per-service pending registry. Store the request and final outcome as session events. SessionHub supplies the durable timeline and renderer replay.

**Interfaces and data.** INFERRED from #394: bind one question per session at a time, with an independent question ID, call ID and turn ID. Store choices by position and use one-based model and user indices. Invalid recommendations behave as absent. Agent settings store a nullable timeout from 1 through 1440 whole minutes, with null meaning off and 5 as the proposed value on enable. Snapshot the deadline when opening the question. Timer and manual submission compete in one synchronous settlement, with a strictly pre-deadline reply winning and expiry winning late replies. Stop records cancellation through the turn's abort signal. Recover abandoned waits as stopped with existing interruption recovery. The runtime reads its workbench settings when opening each question.

**Files and test seams.** Shared question and workbench schemas, events and reducer; core registry, runtime SessionService and Questions; desktop main handler and display/export masking; renderer QuestionCard, workspace focus and WorkbenchActivity; four locales and localized help. Exercise a real SessionService with a replay gateway and a fake clock, plus focused desktop UI and boundary tests.

**Risks and open decisions.** STATED: question outcomes grant no permissions. Question tool executes against its own wait registry, with separate IPC from approvals. IPC requires routed workbench and session plus the exact question ID. Pending live activity carries identifiers and a freshness check. Renderer focus requires the exact workbench, session and still-pending card. No restart resume: an interrupted turn is cancelled on the next writable open.

**Requirement map.** REQ-FUNC-96754d71 tool result and transcript, REQ-FUNC-5fb4cd15 main-owned deadline, REQ-REL-8c12897d exclusive settlement and stop, REQ-SEC-2c57a3ba separate approval gate, REQ-DATA-c75f9512 workbench schema and form, REQ-UX-59e93f91 card, REQ-UX-e7ba512c activity and focus.

Diagrams: [diagram_TASK-e4a93d3b.md](diagram_TASK-e4a93d3b.md)


## Log

- 2026-11-23 frame: journal opened
- 2026-11-23 frame: The user authorized one coordinator-owned local commit for Gitea #394. Implementation hands back the complete unstaged candidate.
- 2026-11-23 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-23 specify: completed; next design
- 2026-11-23 design: completed; next build
- 2026-11-23 build: returned to design - Corrected a premature stage advance before any source edits.
- 2026-11-23 design: completed; next build
- 2026-11-24 build: red: focused Vitest exit 1 - no session question reached the snapshot (functional, reliability, security). Corrected the invalid workbench ID in the setup for the settings red run.
- 2026-11-24 build: green: Windows pinned Vitest focused runtime, shared state, activity, masking, IPC, preload, approvals, exports and boundary tests exit 0 (14 files, 150 tests). The later focused repeat confirmed 50 tests and exposed a pre-existing delegated tool order assertion in registry.test.ts (verified unchanged order in HEAD).
- 2026-11-24 build: green: Windows python ../02_Tools/environment/npmw.py npm run test:e2e -- session-question.spec.ts exit 0; one Electron test covered reload from background workbench, wrong owner, exact card focus, explicit selection vs send and close/reopen persistence.
- 2026-11-24 build: green: version-pinned check:i18n, check:help and check:release-notes all exit 0.
- 2026-11-24 build: DEVIATION build: HEAD-based impacted selection reduced to 433 test files and exceeded Windows launch length. It ran no tests; direct pinned Vitest selectors and the single Electron spec follow the ticket policy.
- 2026-11-24 build: DEVIATION build: card assertions were added after rendering code. The initial Electron attempt failed at card focus and the corrected candidate passed. Core replay checks failed for missing question behavior before implementation.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: Review round 1: the exact pending question can fall outside the initial transcript window after queued steering. Preserve the target and reveal its row before taking focus.
- 2026-11-24 validate: returned to build - Reveal the exact pending question if a long queue leaves its row outside the initial transcript window.
- 2026-11-24 build: red: pinned Vitest transcript-progressive.test.ts -t reveals a pending question exit 1; the question was outside the mounted rows even when targeted.
- 2026-11-24 build: Build review follow-up: the generic tool registry also attaches the Bypass lease to question waits. Revoking that lease could falsely report that the turn stopped. Clarification should stay pending until the answer, expiry or actual turn stop.
- 2026-11-24 build: red: pinned Vitest questions.test.ts -t leaves Bypass exit 1; Bypass revocation produced a stopped outcome despite the active turn.
- 2026-11-24 build: green: Windows pinned Vitest transcript-progressive, question-card, workbench-activity, questions, session-state and question-settings passed 53 tests across 6 files. Final questions.test.ts and approvals.test.ts passed 31 tests across 2 files, including Bypass revocation independence.
- 2026-11-24 build: green: Windows and Ubuntu 24.04.4 under WSL2 (Xvfb, kernel 6.6.87.2-microsoft-standard-WSL2), pinned npm run test:e2e -- session-question.spec.ts each exit 0 after the focus fix; both ran one Electron spec. The later Bypass-only signal change leaves the normal Ask-mode scenario on the same signal.
- 2026-11-24 build: green: WSL2 pinned Vitest questions, question-settings and session-state exit 0 (33 tests); transcript-progressive exit 0 (9 tests). Final Bypass-specific runtime comparison is in progress. Receipts under 05_Software/test-outputs/394.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: Strict AEGIS round 2 exit 1: lint found an unscoped lexical declaration in the question reducer test oracle. Typecheck, i18n and Help passed. Error details retained in lint-error.log.
- 2026-11-24 validate: returned to build - Scope the lexical declaration in the reducer test oracle switch case.
- 2026-11-24 build: green: pinned Biome check and Vitest session-state.test.ts exit 0 after scoping the test oracle switch case (19 tests). Production source is identical to round 2.
- 2026-11-24 build: green: final WSL2 pinned questions.test.ts and approvals.test.ts exit 0 (31 tests) including Bypass revocation. Cleaned the owned WSL2 mirror and retained original evidence.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: final: python .agentic/aegis.py check --task TASK-e4a93d3b --strict --run exit 0 after both round 3 approvals. Lint, typecheck, i18n and Help passed. 47 advisory warnings and 44 notes cover existing knowledge/requirements/journals plus docs and test-support traceability. Git diff --check exit 0 and no staged files at 4ad46dac.
- 2026-11-24 validate: Done criteria verified: user choice/free text/cancel, exact workbench/session/turn ownership, opt-in persistence and range, eligible automatic source, renderer reload and background card focus, expiry/manual/Stop/concurrent-session races, and separate permission/approval behavior. User-facing UI, help and release notes cover en, ro, de and fr.
- 2026-11-24 validate: completed; next done
- 2026-11-24 done: returned to build - Coordinator found stored Windows-1252 mojibake in the added #394 localized copy. Repair only changed strings and rerun affected checks.
- 2026-11-24 build: Coordinator re-review found Windows-1252 mojibake in new #394 strings stored as UTF-8. Repaired 166 sequences in the localized additions and one in the model tool description. Existing catalog and Help lines, translation placeholders, and unrelated release-note entries were preserved.
- 2026-11-24 build: green: strict UTF-8 and Windows-1252 sequence scan of changed product lines against 4ad46dac passed, including untracked source. Verified Romanian, German, French and English sample bytes, catalog values and placeholders, and only the four #394 replacement lines in the release-note diff. Proof is utf8-correction.log.
- 2026-11-24 build: green: pinned npmw.py npm run check:i18n, check:help and check:release-notes each exited 0 after the UTF-8 repair.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: DEVIATION validate: coordinator requested the byte/semantic scan and affected i18n, Help and release-notes checks only for the copy repair. All passed. Earlier runtime, Electron and strict AEGIS results remain recorded for the behavior and are not claimed as reruns on the corrected copy.
- 2026-11-24 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-e4a93d3b.md
changed: Corrected stored UTF-8 in #394 added copy. The candidate is unstaged at 4ad46dac.
evidence: UTF-8 semantic byte scan, check:i18n, check:help and check:release-notes passed. Both re-reviews approved.
issues: No open issue in the copy correction. The prior pre-existing delegated-tool order assertion is recorded in the Log.
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-11-24)

- stage: validate; type: feature; branch: ddp/vera-notifications
- requirements:
  - REQ-FUNC-96754d71 - Resolve structured session questions
  - REQ-FUNC-5fb4cd15 - Apply eligible workbench question recommendations at a deadline
  - REQ-REL-8c12897d - Settle each question once in its owning turn
  - REQ-SEC-2c57a3ba - Keep question answers outside approval decisions
  - REQ-DATA-c75f9512 - Validate and persist the optional question timeout per workbench
  - REQ-UX-59e93f91 - Show and answer structured questions in the conversation
  - REQ-UX-e7ba512c - Identify and focus waiting questions in workbench activity
- deviations: 3 recorded
  - build: HEAD-based impacted selection reduced to 433 test files and exceeded Windows launch length. It ran no tests; direct pinned Vitest selectors and the single Electron spec follow the ticket policy.
  - build: card assertions were added after rendering code. The initial Electron attempt failed at card focus and the corrected candidate passed. Core replay checks failed for missing question behavior before implementation.
  - validate: coordinator requested the byte/semantic scan and affected i18n, Help and release-notes checks only for the copy repair. All passed. Earlier runtime, Electron and strict AEGIS results remain recorded for the behavior and are not claimed as reruns on the corrected copy.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 4ad46da: 68 file(s) changed, 1803 line(s) added
- checks: errors=0 warnings=47 notes=44
- checklist: 9/9 done

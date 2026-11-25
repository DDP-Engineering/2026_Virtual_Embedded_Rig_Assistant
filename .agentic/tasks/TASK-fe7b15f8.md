# TASK-fe7b15f8 - Default tool-call and turn limits that do not block users (#406)

stage: done
type: change
interaction: autopilot
requirements: REQ-FUNC-2e124a88, REQ-DATA-84718b36, REQ-FUNC-0a886b84, REQ-UX-a1584354
parent:
branch: master
base: b85c04bb02f38e8b3fe9c03679374f3e66488387
opened: 2026-11-25

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

Problem: Default limits can stop ordinary work: a real delegated implementation turn ended at the default 50 tool calls and two others ended at 48 and 49 (OBSERVED, #406 and session analysis); at the limit the runtime returns right after the last call, so the model never sees that result or explains the stop, and the turn ends silently although help says it "stops and says so" (OBSERVED runtime.ts:630, help advanced-settings.md:80). Concurrent turns 3 counts delegated turns while Delegated sessions allows 3, so a parent with three children exceeds it (OBSERVED advanced-settings.ts).
Desired outcome: Defaults do not block an unfamiliar user: Tool calls per turn defaults to 200; Concurrent turns defaults to 4; a turn that reaches the tool-call limit ends with a short model summary of what is done and what remains, and Chat shows a neutral notice with a Continue button (STATED, user: "setarile default sa nu blocheze utilizarea"; accepted "Yes, implement all").
Actors: The Desktop user; the agent runtime; delegated sessions and their parent; the CLI (same runtime).
Primary scenario: A long implementation turn reaches the tool-call limit; the model receives the executed results and writes a brief summary without tools; Chat shows "This turn reached its tool-call limit" with Continue; the user presses Continue and the work resumes.
Examples: A parent with three delegated children runs with Concurrent turns at its default.
Counterexamples: A context-budget or output-length limit keeps its existing error and no Continue notice; an explicitly configured lower value still applies (10-500 range unchanged).
In scope: toolCallsPerTurn default 200 and runtime fallback; concurrentTurns default 4; final no-tool summary request at the tool-call limit; optional `limit: "toolCalls"` on turn.done and the turn state; Chat notice with Continue; help en/ro/de/fr; REQ-FUNC-2e124a88 and REQ-DATA-84718b36 revised; new requirements; CHANGELOG and release notes.
Out of scope: Other Advanced defaults (no evidence, STATED in #406 "Avoid increasing unrelated defaults without evidence"); the representative workload study #406 proposes (the user chose to implement now).
Constraints: Branch master; pre-release, no migration of stored values (an explicitly saved 50 stays 50); limits remain finite.
Success signals: Runtime test: limit reached -> one final request with no tools and a summary message, turn.done stopReason limit with limit toolCalls; defaults asserted; Chat notice and Continue sending a message in a component test.
Evidence: runtime.ts run loop (OBSERVED); advanced-settings.ts registry (OBSERVED); workspace.tsx send (OBSERVED).
Assumptions: The summary instruction is transient (not persisted as a user message) so history stays a valid sequence (INFERRED from providers accepting assistant after tool results).
Unknowns: Whether 200 is optimal (UNKNOWN; finite guard kept, user-adjustable).
Decision-blocking questions: None.
Proposed behaviors: As Desired outcome, accepted.

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Verification | Design decision or no impact |
|---|---|---|---|---|
| Tool-call default | Resolved default 200, range 10-500 | REQ-FUNC-2e124a88 (revised) | shared/advanced tests | Registry default and runtime fallback read `advancedSettings.toolCallsPerTurn.default` |
| Turn default | concurrentTurns default 4 | REQ-DATA-84718b36 (revised) | settings tests | Registry default only |
| Summary at limit | Final no-tool request with transient instruction; toolCalls mark | REQ-FUNC-0a886b84 (new) | runtime test | `summarizing` flag in run loop; instruction appended to the request view only; optional `limit: "toolCalls"` on turn.done and turn state |
| Continue notice | Idle session, latest turn toolCalls limit -> notice + Continue | REQ-UX-a1584354 (new) | transcript component test | Transcript `continueTurn` prop from workspace `send` with a localized message |

## Design

Skipped as a separate note: the coverage table's last column is the design.


## Log

- 2026-11-25 frame: journal opened
- 2026-11-25 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-25 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-25 design: skipped; next build - design in coverage table
- 2026-11-25 build: red: npx vitest run src/libraries/core/src/sessions/service.test.ts -t 'tool-call limit' exit 1 - one request only, no summary or toolCalls mark (REQ-FUNC-0a886b84)
- 2026-11-25 build: green: core+shared+cli+main+advanced UI vitest 3120 passed (one timing flake in ingest-ports passes alone 9/9); new summary-at-limit test passes; typecheck clean (REQ-FUNC-0a886b84, REQ-FUNC-2e124a88, REQ-DATA-84718b36)
- 2026-11-25 build: red: npx vitest run transcript-detail.test.ts -t 'tool-call limit' exit 1 - no Continue notice (REQ-UX-a1584354)
- 2026-11-25 build: green: transcript-detail.test.ts 20 passed; i18n complete; lint errors none (REQ-UX-a1584354)
- 2026-11-25 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-25 validate: review round 1: spec changes_required (REQ-FUNC-2e124a88 and REQ-DATA-84718b36 verification text still 50/3; help example '50 (default)'); quality approved with notes (notice claims a summary that may not exist; no test for a failed summary request)
- 2026-11-25 validate: returned to build - round 1: verification texts, help example, neutral notice, failed-summary test
- 2026-11-25 build: green: service.test.ts tool-call limit tests 2 passed (incl. failed summary request -> limit, no error); transcript-detail 20 passed; typecheck, i18n, help, lint clean
- 2026-11-25 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-25 validate: final: python .agentic/aegis.py check --task TASK-fe7b15f8 --strict --run exit 0; lint, typecheck, i18n, help ran; remaining warnings pre-existing
- 2026-11-25 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-25 | decision=Tool calls per turn default 200, Concurrent turns default 4, a no-tool summary request at the tool-call limit, and a Chat notice with Continue | reason=User accepted the proposal 2026-11-25 ('Yes, implement all'); defaults must not block an unfamiliar user | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-fe7b15f8.md
changed: Round 1 fixes: verification texts, help examples, neutral notice, failed-summary test
evidence: check --task TASK-fe7b15f8 --strict --run exit 0; core+shared+cli+main+advanced UI 3120 passed; transcript-detail 20 passed
issues: Two timing-sensitive tests (ingest, ingest-ports) flake under full-suite load and pass alone
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-25)

- stage: validate; type: change; branch: master
- requirements:
  - REQ-FUNC-2e124a88 - Limit tool calls per turn by the resolved Advanced setting
  - REQ-DATA-84718b36 - Store the concurrent-turn limit as an application Advanced setting
  - REQ-FUNC-0a886b84 - Summarize a turn that reaches its tool-call limit
  - REQ-UX-a1584354 - Offer Continue after the tool-call limit
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base b85c04b: 33 file(s) changed, 419 line(s) added
- checks: errors=0 warnings=51 notes=44
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

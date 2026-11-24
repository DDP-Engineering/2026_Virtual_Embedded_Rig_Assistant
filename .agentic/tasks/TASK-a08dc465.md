# TASK-a08dc465 - Surface plans in Chat and notify on pending plan decisions (#399)

stage: done
type: feature
interaction: autopilot
requirements: REQ-UX-48f4b943, REQ-FUNC-1400dfd5, REQ-UX-9a7034ac
parent:
branch: master
base: 7672286e94ec83e09e541838fcb10967c2a3e6f7
opened: 2026-11-24

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

Problem: OBSERVED: Plan updates are grouped or suppressed in Chat and no native notice routes to Plan.
Desired outcome: STATED: #399 adds a compact Chat Plan indicator, direct opening, and a notification for a pending decision when away from the session.
Actors: The agent recording a plan or requesting a decision, and the VERA user.
Primary scenario: A session creates a plan while the right panel is closed, then asks for a decision while the user is viewing another session.
Examples: A three-step plan appears in Minimal Chat; Open plan reveals the Plan pane. A pending plan question opens its original workbench, session and Plan.
Counterexamples: Routine plan progress and ordinary question notifications retain their existing behavior.
In scope: Durable question marker, current plan discovery, scoped Plan navigation, away detection, notification eligibility and expiry, Activity fallback.
Out of scope: STATED: #399 covers plan discovery and decisions; tab split, tab management, and operation approvals have their own scope.
Constraints: STATED: Use AEGIS on master. AGENTS.md authorizes one local commit. Reuse the existing question workflow and notification preferences.
Success signals: Count follows live plan, button opens even when the panel is closed, an explicit pending decision routes to Plan once, settlement removes the pending alert.
Evidence: OBSERVED: #399 via tea, current PlanTab uses SessionViewProvider, Core ask_user owns durable question events, SessionNotifications owns one-shot native activation.
Assumptions: A decision is an explicit question about the current plan, answered through the existing question card.
Unknowns: Native Ubuntu notification delivery is not verified in this Windows working copy.
Decision-blocking questions: None.
Proposed behaviors: None beyond the accepted scope.

## Requirement coverage

| Behavior | Requirement | Design | Proof |
| --- | --- | --- | --- |
| Discover and open a live plan from Chat | REQ-UX-48f4b943 | Scoped right-panel request | Renderer workspace and native Plan |
| Explicit pending decision | REQ-FUNC-1400dfd5 | Tagged ask_user request | Core questions |
| Notify away and open the verified Plan | REQ-UX-9a7034ac | Native and Activity paths | Notification and workspace tests |

## Design

**Approach.** Render the shared live plan count in the Chat header. An explicit scoped panel request selects Plan even when the panel is collapsed or Plan is hidden in workbench settings.

**Interfaces and data.** An optional literal aboutPlan tag on ask_user marks a question for the current nonempty plan. Existing question events carry the tag and existing answer, cancellation and deadline semantics. The desktop records the exact shown workbench/session using trusted IPC; the native presenter checks away status for tagged pending requests and reuses question preferences, one-shot activation and settlement. Activity exposes the same pending destination.

**Files and test seams.** Shared question and IPC contracts, Core ask_user, Questions and live observations, Desktop main notification presenter and routing, renderer App, Shell and SessionWorkspace, Activity, mocks, four locales.

**Risks and open decisions.** No storage migration. Only validated pending question identifiers can attach Plan to a verified route. Native alerts contain generic text. Reveal a hidden Plan tab temporarily without mutating workbench preferences.

**Requirement map.** REQ-UX-48f4b943 owns the Chat action. REQ-FUNC-1400dfd5 owns the pending question marker. REQ-UX-9a7034ac owns the away notice, settlement and navigation.

Diagrams: [diagram_TASK-a08dc465.md](diagram_TASK-a08dc465.md)

## Log

- 2026-11-24 frame: journal opened
- 2026-11-24 frame: completed; next specify
- 2026-11-24 specify: completed; next design
- 2026-11-24 design: completed; next build
- 2026-11-24 build: red: focused plan-tab, questions and session-notifications Vitest exit 1. Three expected failures cover absent indicator, missing tagged question and no cross-session alert.
- 2026-11-24 build: green: npmw.py run test with plan-tab, questions, session-notifications, ipc-router, bridge, registry and shared session state selectors exit 0 (7 files, 101 tests; all three requirements)
- 2026-11-24 build: green: npmw.py run test:e2e -- tests/e2e/session-question.spec.ts exit 0 on Windows native Electron (2 cases); verified Minimal Chat with a configured-hidden Plan tab, cross-workbench Activity routing, clearing the plan, settlement, and ordinary question navigation. Both use a simulated background-focus signal after checking real window minimization and simulate unavailable OS delivery. The first run exposed foreground-focus timing in the pre-existing ordinary-question test.
- 2026-11-24 build: Advisory check passed with 0 errors. Existing context size limits and historical requirement or journal warnings are outside this ticket. Reviewed all 32 product/test/documentation paths and untracked requirement and journal records; diff has no credentials or local user data.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: Round 1: both reviewers identified P2 folder scoping: copied workbenches can preserve workbench/session IDs, causing a stale shown-session report and reusing the old Plan action.
- 2026-11-24 validate: returned to build - Scope plan navigation and foreground reporting to the physical workbench folder, with regression coverage.
- 2026-11-24 build: red (round 1 regression): npmw.py run test -- src/apps/desktop/src/renderer/components/workbench-activity.test.ts -t "switching to a copied session" exits 1 on the copied-session navigation assertions.
- 2026-11-24 build: green (round 1 fix): npmw.py run test selecting workbench-activity, plan-tab, session-notifications, ipc-router and bridge suites passed 68 tests across 5 files. The same-ID copied-session regression proves a new foreground folder report and no reuse of the prior Plan action. Focused Windows Electron session-question.spec.ts rerun passed 2 tests.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: final: python .agentic/aegis.py check --task TASK-a08dc465 --strict --run exit 0; lint, TypeScript, all locale keys and integrated help passed; npmw.py run check:release-notes passed. The 66 advisory warnings concern historical metadata, existing context sizes, test/style/mock/locale paths outside AEGIS requirement path coverage, or pre-existing untracked bundled plugin ZIPs excluded from the commit. Focused tests prove the candidate; the Windows E2E cases simulate unavailable OS notification delivery, while presenter tests verify delivery eligibility/activation. Native packaged toast delivery is outside this proof. The command runner blocked recursive cleanup of the isolated, Git-ignored Electron build.
- 2026-11-24 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-24 | decision=Use master and one local commit after validation | reason=User named master and AGENTS.md authorizes local ticket commits | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-a08dc465.md
changed: Implemented Chat Plan discovery and verified pending-decision routing on master
evidence: Strict AEGIS exit 0. 110 focused Vitest tests and 2 Windows Electron tests passed. Both reviews approved.
issues: Windows Electron covered the in-app fallback with simulated OS delivery. Packaged OS toast delivery and native Ubuntu were not exercised.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-24)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-UX-48f4b943 - Discover and open the current plan from Chat
  - REQ-FUNC-1400dfd5 - Distinguish pending plan decisions from routine plan updates
  - REQ-UX-9a7034ac - Notify once and open the requested plan from a pending decision
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 7672286: 53 file(s) changed, 1001 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=66 notes=44
- checklist: 8/9 done; open: `report` appended

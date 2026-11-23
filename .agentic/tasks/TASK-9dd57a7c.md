# TASK-9dd57a7c - Native notifications for pending chat questions (#395)

stage: done
type: feature
interaction: autopilot
requirements: REQ-DATA-d46e6974, REQ-FUNC-c373add0, REQ-FUNC-0910594a, REQ-UX-c8bad7f5, REQ-REL-e85df700, REQ-PLAT-99eec2f1, REQ-SEC-99eec32c, REQ-DATA-fadf40d6
parent:
branch: ddp/vera-notifications
base: 3bb2bce5ed9ee7e2174bca5480289052ca3033d3
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

Problem: STATED (#395) users working in another app need a desktop alert when VERA is waiting for a structured answer. OBSERVED session-notifications.ts currently discards both question activity events.
Desired outcome: STATED one silent generic localized native question alert when VERA is in the background and a live question still awaits an answer, with its own saved switch.
Actors: STATED desktop users and the native notification presenter.
Primary scenario: STATED a background workbench asks a question; the user clicks the notification, takes the guarded route to the exact session and pending card, and can answer in VERA.
Examples: STATED a current alert opens the owning workbench and focuses its pending card. An answered, cancelled, or timed-out question loses its alert and activation.
Counterexamples: STATED foreground, replay, duplicate, disabled and already settled requests produce no alert; a stale alert cannot answer or restore a resolved question.
In scope: STATED preference, live pending lifecycle, activation, exact card focus, Settings and Help in four languages, focused coverage, release notes and settings reset entry.
Out of scope: STATED full test and packaging gates, other tickets, staging, commits, pushes and Gitea edits. OBSERVED #394 owns question handling and #391 owns Windows portable presenter policy.
Constraints: STATED sole writer in the ddp/vera-notifications sibling worktree at 3bb2bce5, format 1, one coordinator-owned authorized local commit, both independent reviews, byte-level text verification. OBSERVED REQ-SEC-99eec32c limits native payload, REQ-PLAT-99eec2f1 bypasses Windows portable presentation.
Success signals: STATED persisted independent default-on switch, exact once-per-live-pending-question delivery eligibility, active-only guarded cross-workbench navigation, stale activation rejected and in-app questions unaffected by native availability.
Evidence: OBSERVED initial git status and rev-parse, clean at 3bb2bce5; live-only question pending closure in sessions/service.ts, approved focus seam in workspace.tsx, and the existing native presenter.
Assumptions: INFERRED the issue's proposed default On is the intended default, consistent with the stated default and existing approval switch.
Unknowns: UNKNOWN OS delivery on an unavailable desktop service. Eligibility and optional failure can be tested with the native boundary stub.
Decision-blocking questions: None.
Proposed behaviors: None beyond accepted scope.

## Requirement coverage

| Behavior | Requirement | Design | Proof |
| --- | --- | --- | --- |
| Save the independent switch | REQ-DATA-d46e6974 | Independent settings and form | Schema, service, browser and restart checks |
| Dispatch live eligible requests once | REQ-FUNC-c373add0 | Live-only presenter branch | Boundary and Electron replay |
| Dismiss on settlement | REQ-FUNC-0910594a | Shared notice lifecycle | Boundary and Electron replay |
| Open and focus through the editor guard | REQ-UX-c8bad7f5 | Guarded token route and exact focus | Boundary, renderer races and Electron replay |
| Preserve in-app question interaction | REQ-REL-e85df700 | Best-effort presenter | Boundary and in-app Electron flow |
| Windows portable bypass | REQ-PLAT-99eec2f1 | Existing early Windows policy guard | Presenter capability spy |
| Generic localized native payload | REQ-SEC-99eec32c | Translated question body | Options, Windows XML and encoding check |
| Strict version-1 field validation | REQ-DATA-fadf40d6 | Require boolean in saved data | Schema and IPC patch checks |

## Design

**Approach.** OBSERVED the live observer carries only an ID and a pending predicate; consume it in SessionNotifications alongside approval activity. INFERRED using the same presenter keeps replay, Windows portable and click tokens within their existing boundaries (REQ-FUNC-c373add0, REQ-PLAT-99eec2f1).

**Interfaces and data.** STATED version 1 remains strict and now requires notifications.questionRequests, default true, with the existing partial settings patch. Key each notice by canonical owner, session, kind and request ID. Share dispatch, pending rechecks, dismissal and token invalidation with approvals. Native options remain generic and silent (REQ-DATA-d46e6974, REQ-DATA-fadf40d6, REQ-FUNC-0910594a, REQ-SEC-99eec32c).

**Files and test seams.** OBSERVED settings tests and shell restart test already exercise the real persistence flow. SessionNotifications boundary tests control show, close, pending, failures and opaque activation on both platform policies. Main uses the existing foreground guard and typed activation response. App invokes the existing exact-card focus seam. A fresh activity check and the mounted exact pending card both have to agree before focus; that proof lives in renderer tests and the cross-workbench Electron replay. Settings, Help and release text use the four existing locale files and release note format.

**Risks and open decisions.** Pending predicates are checked at dispatch, click, token consumption and owner validation. If settlement races a successful workbench promotion, return the opened session without a question focus ID. If the read or DOM races a settlement, the renderer falls back to the session heading or ignores a superseded request. Native failure stays isolated from the live question owner (REQ-UX-c8bad7f5, REQ-REL-e85df700).

**Requirement map.** See the coverage table. No new product decisions.

Diagrams: [diagram_TASK-9dd57a7c.md](diagram_TASK-9dd57a7c.md)

## Log

- 2026-11-24 frame: journal opened
- 2026-11-24 frame: The user authorized one local ticket commit after verification, owned by the coordinator. This implementation chat hands back the uncommitted candidate on ddp/vera-notifications at base 3bb2bce5ed9ee7e2174bca5480289052ca3033d3.
- 2026-11-24 frame: completed; next specify - Gitea #395 scope recorded in autopilot
- 2026-11-24 specify: completed; next design
- 2026-11-24 design: completed; next build
- 2026-11-24 build: red: npmw.py npx vitest run notification-settings.test.ts service.test.ts exit 1, 3 expected missing questionRequests defaults (REQ-DATA-d46e6974, REQ-DATA-fadf40d6).
- 2026-11-24 build: red: npmw.py npx vitest run session-notifications.test.ts exit 1, 10 expected missing question alert delivery, copy, lifecycle or activation tests (REQ-FUNC-c373add0, REQ-FUNC-0910594a, REQ-UX-c8bad7f5, REQ-REL-e85df700, REQ-PLAT-99eec2f1, REQ-SEC-99eec32c).
- 2026-11-24 build: red: focused question-card.test.ts exit 1, 2 expected missing confirmations for fresh and late Activity results (REQ-UX-c8bad7f5).
- 2026-11-24 build: green: pinned Windows Vitest focused selection of nine files exit 0, 121 tests, including presenter, question owner/timer, renderer focus races, Activity navigation, settings schema/service/mock, IPC payload and boundaries.
- 2026-11-24 build: Inspection: python 05_Software/test-outputs/395/check-locale-bytes.py exit 0. Exact UTF-8 bytes for the four switch labels, generic native copy, Help entries and release notes matched the independently escaped expectations, with SHA-256 receipts and no BOM or replacement artifacts.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: Independent quality review found that React could settle a card between the async Activity check and the separate focus microtask. Keep the exact DOM check and focus in the same continuation and add an ordering regression.
- 2026-11-24 validate: returned to build - Recheck the exact question card at focus time in the Activity continuation
- 2026-11-24 build: red: focused question-card.test.ts same-continuation test exit 1 before review fix; no synchronous focus callback ran.
- 2026-11-24 build: green: Windows npmw.py npx vitest run question-card.test.ts workbench-activity.test.ts transcript-progressive.test.ts, exit 0, 25 tests after review fix. The exact pending marker and focus now share a continuation.
- 2026-11-24 build: Windows E2E before review fix: keyboard form, four locales, completion regression, unavailable delivery, process restart passed. Retried question cross-workbench E2E with a hidden window before stale clicks, exit 0. The earlier failure occurred before either stale click while waiting for a second window minimize. The question E2E pair is rerunning for the focus fix.
- 2026-11-24 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-24 validate: Both read-only independent reviews approved the round 2 candidate. The first-round DOM focus race is closed by synchronous validation and focus within the Activity result continuation.
- 2026-11-24 validate: Windows final question proof: npmw.py npm run test:e2e -- tests/e2e/background-sessions.spec.ts tests/e2e/session-question.spec.ts --grep 'question alerts respect|survives unavailable native delivery' exit 0, 2/2 on the independently reviewed candidate. The browser form/locales (2/2), completion guard and settings restart each passed earlier and are unchanged by the race fix. Original logs are under 05_Software/test-outputs/395.
- 2026-11-24 validate: Final Windows static proof: python .agentic/aegis.py check --task TASK-9dd57a7c --strict --run --full exit 0. Lint, typecheck, i18n and Help passed. No errors. Advisory findings are historical records or layout/traceability heuristics for Help, release notes, localizations and co-located tests, all checked separately. npm run check:release-notes, git diff --check HEAD and the four-locale UTF-8 byte proof each exited 0.
- 2026-11-24 validate: Final Ubuntu 24.04.4 LTS in WSL2 (kernel 6.6.87.2-microsoft-standard-WSL2), pinned Node 24.21.0. npmw.py npx vitest run session-notifications.test.ts question-card.test.ts questions.test.ts notification-settings.test.ts exit 0, 43/43. Under Xvfb/Openbox and DBus, npmw.py npm run test:e2e with the final two question cases exit 0, 2/2. The Windows/Linux Electron runs exercised the real app with a stub native presenter, not OS banner or package acceptance. Removed the owned WSL scratch after the processes closed and kept the original log in 05_Software/test-outputs/395/wsl-final.log.
- 2026-11-24 validate: The round-1 review return reset the build checklist when the second build advanced. The initial checklist was completed; the round-2 proof reran the affected renderer cases, evidence and completed-candidate evolution. Final candidate remains unstaged and uncommitted on the recorded base for the coordinator.
- 2026-11-24 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-9dd57a7c.md
changed: Saved question setting, live presenter and guarded card focus, UTF-8 Help and notes, focused regressions
evidence: Strict AEGIS exit 0. Final question Electron 2/2 on Windows and 2/2 on Ubuntu WSL2. Both reviews approved.
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-24)

- stage: validate; type: feature; branch: ddp/vera-notifications
- requirements:
  - REQ-DATA-d46e6974 - Persist independent question notification preferences
  - REQ-FUNC-c373add0 - Deliver eligible live question alerts once
  - REQ-FUNC-0910594a - Dismiss settled native question alerts
  - REQ-UX-c8bad7f5 - Open the exact pending question from a native alert
  - REQ-REL-e85df700 - Keep structured questions usable without native delivery
  - REQ-PLAT-99eec2f1 - Keep Windows portable session alerts in VERA
  - REQ-SEC-99eec32c - Keep native notification payloads generic
  - REQ-DATA-fadf40d6 - Reject invalid desktop notification settings
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 3bb2bce: 45 file(s) changed, 853 line(s) added
- checks: errors=0 warnings=49 notes=44
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

# TASK-be584c0e - #390 Desktop live session notifications

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-3f22e281, REQ-FUNC-63e9d0e1, REQ-FUNC-213abc48, REQ-SEC-99eec32c, REQ-UX-6f071dc1, REQ-REL-279c294c, REQ-REL-be721878, REQ-REL-0d7ecd44
parent:
branch: ddp/vera-notifications
base: 3d9b98eb634738e4fefb967aa976fca8962e3e6f
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
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: STATED (#390). Someone working outside VERA needs a desktop cue for an ordinary reply or an outstanding human approval.
Desired outcome: STATED. Policy-controlled silent generic notifications direct a click to the exact live-process workbench and session.
Actors: STATED. Desktop user, native notification service and each live workbench runtime.
Primary scenario: STATED. A reply completes in an inactive workbench and a click returns to that session.
Examples: STATED. A delegated session's pending human approval alerts in the background. Always allows a focused ordinary successful completion.
Counterexamples: STATED. Plan reviews, autonomous child completions, failed turns, auto-grants and already-settled approval requests do not alert.
In scope: STATED. Live observation, permissions, deduplication, generic localized payload, dismissal and guarded click routing.
Out of scope: STATED. Cold-start routing, OS approval actions, browser permission changes and packaged OS acceptance owned by #391.
Constraints: STATED. Sibling branch ddp/vera-notifications at recorded base 3d9b98eb, existing #389 settings, coordinator-owned local commit, focused checks and independent reviews.
Success signals: STATED. Policy matrix, live replay and concurrency boundaries, auto-grant timing, exact guarded routing, privacy and failure isolation.
Evidence: OBSERVED. SessionHub observes committed publication outside replay. SessionService owns active turn metadata. ApprovalGate may decide synchronously after publication. WorkbenchRuntimes retires a settled background workbench. App.tsx owns the unsaved-editor guard. Pinned Electron is 44.11.4.
Assumptions: INFERRED. A target in a retired workbench can be reopened using its captured canonical folder, provided its identity and session still match.
Unknowns: UNKNOWN. Physical toast delivery and Action Center behavior on a clean installed Windows desktop are #391 evidence.
Decision-blocking questions: None.
Proposed behaviors: None beyond the stated contract.

## Requirement coverage

| Behavior | Requirement | Verification | Design |
| --- | --- | --- | --- |
| Successful ordinary completion | REQ-FUNC-3f22e281 | Publish ordinary and excluded finishes under all policies with focused, minimized, hidden and unfocused windows, and compare delivery counts. | Live turn classifier |
| Human approval eligibility | REQ-FUNC-63e9d0e1 | Publish requests and auto-decisions in the same stack, settle another before dispatch, and compare with an outstanding child approval. | Gate query after a microtask |
| Approval dismissal | REQ-FUNC-213abc48 | Resolve before and after native display and check the presented alert is closed, including a Windows banner timeout. | Per-request native object |
| Localized generic payload | REQ-SEC-99eec32c | Inspect emitted options in all four languages, including Windows toast XML, for generic copy and absence of session data and approval actions. | Generic native copy and Windows launch tag |
| Guarded exact navigation | REQ-UX-6f071dc1 | Click a completion from another workbench, cancel the guard and retain edits, then accept an eligible click and see the target session. | One-shot IPC through guarded chat navigation |
| Stale destination rejection | REQ-REL-279c294c | Reopen a missing or mismatched target and attempt a settled or old-process approval click, observing that no session switch occurs. | Validate before foreground promotion |
| Failure isolation | REQ-REL-be721878 | Make notification support, creation, display and dismissal fail independently and verify the publication path and in-app workflow remain usable. | Contain native calls outside the session stack |
| Deduplication and replay isolation | REQ-REL-0d7ecd44 | Publish duplicate and replayed events and burst events from different workbenches, then verify each eligible identity is delivered once. | Process-local keys and committed publication |

## Design

**Approach.** OBSERVED. SessionHub already invokes the SessionService observer before subscribers. Extend that observer to emit narrow activity from every Desktop SessionsHost. Keep the ordinary successful turn predicate usable without native delivery (REQ-FUNC-3f22e281, REQ-REL-0d7ecd44).

**Interfaces and data.** STATED. Snapshot canonical folder and workbench ID at host construction. The new native controller deduplicates candidates, rechecks the ApprovalGate after publication can unwind, and reads saved preferences and live visibility/focus at dispatch. Resolutions invalidate approvals and dismiss displayed alerts (REQ-FUNC-63e9d0e1, REQ-FUNC-213abc48). The native payload uses generic localized text and a random tag on Windows. All delivery failures are isolated (REQ-SEC-99eec32c, REQ-REL-be721878).

**Files and test seams.** INFERRED from the existing seams. Test the classifier and gate in Core, the Desktop notification controller through a fake native port, the pre-promotion workbench validation on WorkbenchRuntimes, and the guard and final chat navigation through the renderer. Types and validators live in shared IPC. App handles the event through its existing editor guard, operation state, and chat opener (REQ-UX-6f071dc1).

**Risks and open decisions.** OBSERVED. Settled workbenches can retire before a click. A guarded click redeems a process-local one-shot capability; main validates the canonical folder, workbench and session before promotion. An already-open target uses its current database. WorkbenchService checks a reopened target against existing initialized storage before updating recents or publishing an open. The renderer defers the latest click while its current navigation operation is pending and then checks the editor guard. A pending approval also needs its original gate (REQ-REL-279c294c). Electron 44.11.4 Windows COM activation maps a toast launch tag back to its current presenter. The WinRT banner click is also delivered on the notification instance. Packaging identity uses the existing NSIS AUMID, with installed acceptance in #391.

**Requirement map.** The coverage table maps each requirement to its design decision and verification seam.

Diagrams: [diagram_TASK-be584c0e.md](diagram_TASK-be584c0e.md)


## Log

- 2026-11-23 frame: journal opened
- 2026-11-23 frame: The user authorized one coordinator-owned local commit after validation. This implementation chat leaves the candidate unstaged on ddp/vera-notifications.
- 2026-11-23 frame: completed; next specify
- 2026-11-23 specify: completed; next design
- 2026-11-23 design: completed; next build
- 2026-11-23 build: red: pinned vitest run live-activity.test.ts session-notifications.test.ts workbench-runtimes.test.ts exit 1; missing classifier and notification module; rejected target promoted.
- 2026-11-23 build: Guard review: validate newly opened targets inside WorkbenchService staging before writing recents, changing the ingest owner, emitting opened or promoting the runtime. This extends the design's pre-promotion check to the underlying workbench open.
- 2026-11-23 build: Windows activation source inspection: pinned Electron 44.11.4 WinRT body clicks call the instance; COM body clicks match the opaque launch tag in the presenter's live objects. No process-global cold-start callback is registered. Production and test runtime AUMIDs match distributionConfig and the pinned NSIS Start Menu shortcut APP_ID. Installed system delivery remains #391.
- 2026-11-23 build: Windows pinned Vitest baseline increment exit 0, 22 checks. Expanded focused increment exit 0, 100 checks including real auto-edit and delegated approval, replay isolation, session router and import boundaries. Broader immediate-consumer run passed 194 with one Windows symlink skip and timed out on an existing workbench owner-storage test under concurrent build load; rerunning the affected workbench checks in isolation.
- 2026-11-23 build: Independent round 1: specification requires preserving click through an in-flight navigation operation and proving live delegated approval redemption; quality requires existing-only SQLite opens, including a deletion during lock acquisition. Fixes in the worktree await focused verification.
- 2026-11-23 build: DEVIATION validate: Electron 44.11.4 ignores the silent option in its Linux libnotify backend - the desktop daemon controls sound on Linux. VERA still submits silent:true and requests silence explicitly in Windows XML. The requested Electron API exposes no Linux override.
- 2026-11-23 build: Ubuntu 24.04.4 LTS on WSL2, pinned Node 24.21.0, first focused run exit 0, 196 passed in 13 files. Round-1 affected checks rerun separately against the updated candidate. Windows release-notes lint exit 0 (3 files, 0 errors).
- 2026-11-23 build: Windows post-review focused proof: npmw.py npx vitest run session-notifications.test.ts storage/db.test.ts workbench/service.test.ts session-router.replay.test.ts workbench-runtimes.replay.test.ts --maxWorkers 1 --testTimeout 20000 exit 0, 104 passed and one POSIX-symlink test skipped. The existing ownership test exceeded the default 5-second Windows limit under concurrent builds, then its assertions passed with the bounded override.
- 2026-11-23 build: Windows focused native Electron run reached and passed all editor, pending picker, window restore, workbench identity, exact session and replay assertions. Its last assertion failed by comparing a Promise to an array; the fixture now awaits the network guard receipt and the cached candidate rerun is in flight.
- 2026-11-23 build: completed; next validate
- 2026-11-23 validate: Independent round 2 approved specification compliance and implementation quality. Both reviewers covered the final awaited network-guard assertion; focused Electron rerun in flight.
- 2026-11-23 validate: Focused pinned Electron click path passed with the native delivery shim on Windows (1 test, 19.6s) and Ubuntu 24.04.4 LTS under WSL2 with Xvfb/Openbox (1 test, 22.7s). Both used npmw.py npm run test:e2e -- background-sessions.spec.ts --grep 'a completion notification' --reporter line. Real native BrowserWindow restoration, dirty-editor cancel, queued click through a canceled picker, exact workbench/session and transcript replay all passed.
- 2026-11-23 validate: WSL2 post-review affected Vitest run had 103 passes and two failures: the approval test first redeemed a later token before asserting staleness, and the existing lock-owner test exceeded the default timeout under parallel builds. Both passed on the isolated two-case retry with --testTimeout 20000. This covers all 105 selected cases across the two runs.
- 2026-11-23 validate: final: python .agentic/aegis.py check --task TASK-be584c0e --strict --run exit 0. Lint including import boundaries, TypeScript, i18n and help passed. Advisory output has 0 errors, 48 warnings and 44 notes. The broad source globs also match edited tests that are tracked through linked_tests. Repository-required Help/release notes/changelog sit outside the configured AEGIS layout. Remaining journal and requirements advisories predate this ticket. Separate release-note validation and git diff --check passed.
- 2026-11-23 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-be584c0e.md
changed: Implemented #390 in the notifications worktree for the coordinator's local commit.
evidence: Windows Vitest 104 passed plus 1 platform skip. WSL2 Vitest 196 passed initially, with all 105 affected cases proved across the final two runs. Electron click-path 1 passed on each platform. Strict AEGIS and release notes exit 0.
issues: Installed Windows delivery and Action Center acceptance belong to #391. Electron's Linux notification daemon controls sound.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-23)

- stage: validate; type: feature; branch: ddp/vera-notifications
- requirements:
  - REQ-FUNC-3f22e281 - Deliver alerts for successful ordinary turns
  - REQ-FUNC-63e9d0e1 - Alert for pending human approval requests
  - REQ-FUNC-213abc48 - Dismiss settled approval alerts
  - REQ-SEC-99eec32c - Keep native notification payloads generic
  - REQ-UX-6f071dc1 - Open a clicked notification's session
  - REQ-REL-279c294c - Ignore stale notification destinations
  - REQ-REL-be721878 - Isolate desktop notification failures
  - REQ-REL-0d7ecd44 - Deduplicate live session alerts
- deviations: 1 recorded
  - validate: Electron 44.11.4 ignores the silent option in its Linux libnotify backend - the desktop daemon controls sound on Linux. VERA still submits silent:true and requests silence explicitly in Windows XML. The requested Electron API exposes no Linux override.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 3d9b98e: 51 file(s) changed, 1180 line(s) added
- checks: errors=0 warnings=48 notes=44
- checklist: 9/9 done

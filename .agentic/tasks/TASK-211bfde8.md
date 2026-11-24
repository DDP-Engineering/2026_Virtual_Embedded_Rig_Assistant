# TASK-211bfde8 - Configure Full Access for delegated tasks globally (#396)

stage: done
type: change
interaction: autopilot
requirements: REQ-SEC-36900002, REQ-SEC-36900003, REQ-SEC-36900006
parent:
branch: master
base: 019c90abfe8b5706e234dff709b6143f94d1220e
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

Problem: STATED: The per-session Full Access action makes delegated work hard to understand and manage.
Desired outcome: STATED: One application-wide setting for delegated Full Access, off by default, with confirmation on enable, in place of the session action.
Actors: A VERA user and the runtime checking a delegated launch.
Primary scenario: Enable the setting in App settings, confirm, then delegate from an eligible Bypass session.
Examples: A confirmed setting permits eligible Bypass launches in two workbenches under the same VERA profile.
Counterexamples: Normal session mode selection and already created children keep their own authority.
In scope: Settings, trusted confirmation boundary, delegated launch admission, removal of per-session grant storage and UI, tests and user help.
Out of scope: STATED: A machine-wide restriction on selecting Bypass for direct sessions.
Constraints: STATED: Master, application Settings, off by default. AGENTS.md authorizes a local ticket commit. Prior timeout and Reindex layout edits are present in the working tree.
Success signals: Off denies Bypass delegation, confirmed enable applies to eligible parents, disabling denies future Bypass launches, and the session action is removed.
Evidence: OBSERVED: Gitea #396 created. SessionService checks authorization before and after model preparation, and the existing UI exposes a session action.
Assumptions: Application scope is the selected VERA data profile, which owns the settings file.
Unknowns: Native Ubuntu execution is unverified in this checkout.
Decision-blocking questions: None.
Proposed behaviors: None beyond the accepted scope and existing admission contract.

## Requirement coverage

| Behavior | Requirement | Design | Proof |
| --- | --- | --- | --- |
| Default-off global setting and explicit confirmation | REQ-SEC-36900002 | Profile settings and confirmed IPC | Shared schema, mock Settings and desktop launch test |
| Denial when off | REQ-SEC-36900003 | Live host lookup on delegated admission | Core delegation tests |
| Revocation for future launches | REQ-SEC-36900006 | Reuse admission checks and preserve copied child mode | Core delegation tests |

## Design

**Approach.** Replace per-parent launch grants with a profile-wide boolean. The new Permissions panel uses a modal confirmation on enable and direct disable (REQ-SEC-36900002/06).

**Interfaces and data.** A dedicated format-1 policy file stores a boolean, resolved off on missing, invalid or unreadable data. Settings IPC reads it and accepts an acknowledged enable or a disable; SettingsService queues atomic writes. General settings writers do not touch this file. Both hosts read the persisted policy at each of SessionService's two existing launch checks (REQ-SEC-36900003).

**Files and test seams.** Shared settings, session and IPC contracts, Desktop settings and SessionsHost, Core launch admission and storage, CLI host composition, mocks, preload, renderer and native delegation tests.

**Risks and open decisions.** Read the live profile policy at final admission so in-flight model preparation cannot bypass revocation. A dedicated file keeps stale settings snapshots from overwriting the grant. Existing child modes remain independent. The old grants table is removed from new databases and never read. No migration.

**Requirement map.** REQ-SEC-36900002 owns the confirmation, saved preference and UI placement. REQ-SEC-36900003 owns refusal at admission. REQ-SEC-36900006 owns future-only revocation.

Diagrams: [diagram_TASK-211bfde8.md](diagram_TASK-211bfde8.md)

## Log

- 2026-11-24 frame: journal opened
- 2026-11-24 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-24 specify: completed; next design
- 2026-11-24 design: completed; next build
- 2026-11-24 build: red: focused Core delegation policy test exit 1. Confirmed profile policy was ignored and second workbench launch returned DENIED. REQ-SEC-36900003 and REQ-SEC-36900006.
- 2026-11-24 build: red: focused Desktop Settings test exit 1. Permissions tab is absent. REQ-SEC-36900002.
- 2026-11-24 build: green: focused Core delegation/programs/storage exit 0 (73), Desktop settings/preload/router exit 0 (5 selected), typecheck exit 0 and Windows native targeted session-delegation E2E exit 0 (1). REQ-SEC-36900002 REQ-SEC-36900003 REQ-SEC-36900006.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: Review round 1: a CLI process sharing a profile cached the permission at startup, so Desktop revocation could leave a future CLI Bypass launch authorized. Also update stale sessions knowledge and verify settings bytes on disk in native acceptance.
- 2026-11-24 validate: returned to build - Read the current persisted CLI setting at admission and prove revocation
- 2026-11-24 build: Review round 1 refinement: CLI recent-workbench writes can also race on settings.json. Added independent atomic profile-policy storage and live host reads. Red profile persistence test exit 1 on absent implementation.
- 2026-11-24 build: green after review: Core settings, delegation, programs and storage exit 0 (102); Desktop selected settings/preload/router exit 0 (5). Windows native persistence acceptance in progress.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: Windows native Electron retest exit 0 (1), including profile file checks after activation and revocation. Both independent reviewers approved round 2; moved the import to the top as suggested.
- 2026-11-24 validate: final: check --task TASK-211bfde8 --strict --run exit 0. Lint, TypeScript, i18n and help pass. Focused Core 102, Desktop 5 and Windows native 1 pass. Release notes check exit 0. Advisory warnings include existing journal and layout notices, previous local UI edits, and files outside mapped paths. No strict errors.
- 2026-11-24 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-24 | decision=Authorize a local ticket commit on master | reason=AGENTS.md implementation branch and commits | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-211bfde8.md
changed: Global delegated Full Access, confirmed enable and independent live profile policy
evidence: Strict and release-note checks exit 0. Core 102, Desktop 5 and Windows native Electron 1 passed.
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-24)

- stage: validate; type: change; branch: master
- requirements:
  - REQ-SEC-36900002 - Authorize new Full Access children
  - REQ-SEC-36900003 - Deny unapproved Full Access launch
  - REQ-SEC-36900006 - Revoke Full Access launches
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 019c90a: 62 file(s) changed, 801 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=75 notes=44
- checklist: 9/9 done

# TASK-5dd935de - Wireshark typed offline inspection and capture evidence (#401)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-610a4011, REQ-FUNC-610a4012, REQ-FUNC-610a4013, REQ-FUNC-610a4014, REQ-SEC-610a4015, REQ-DATA-610a4016, REQ-REL-610a4017, REQ-REL-610a4018
parent:
branch: master
base: f84f11eaf166710bf2a5928d367efdb52bf1757c
opened: 2026-11-25

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

Problem: STATED #401 calls for typed offline packet evidence. OBSERVED the official package currently routes analysis through generic program arguments.
Desired outcome: STATED provide bounded typed inspection and references for later Wireshark tickets.
Actors: STATED a VERA session analyzing a saved capture and later evidence consumers.
Primary scenario: STATED inspect a saved capture, select known fields and cite a frame from a filtered page.
Examples: STATED independent PCAP and PCAPNG, a recoverable bad filter, and a managed file that reopens under its published reference.
Counterexamples: STATED live capture, attacks and vulnerability reproduction are outside this ticket.
In scope: STATED the #401 work package in 00_Planning/plan, including managed profile, typed Decode As and managed binary storage.
Out of scope: STATED later epic work and remote publication.
Constraints: STATED shared master, base f84f11eaf166710bf2a5928d367efdb52bf1757c, focused checks only and uncommitted handover. Preserve unrelated files and #391.
Success signals: STATED the three Done criteria in #401, including focused replay and native Windows/Ubuntu.
Evidence: OBSERVED git rev-parse HEAD, tea API for #401, official plugin manifest and generic analysis skill.
Assumptions: INFERRED the managed binary reference is workbench-scoped from the repository's workbench data and path boundaries.
Unknowns: UNKNOWN native Ubuntu host availability. Existing WSL2 Ubuntu is available for Linux execution.
Decision-blocking questions: None for implementation.
Proposed behaviors: No scope additions.

## Requirement coverage

| Behavior | Requirement | Design seam |
|---|---|---|
| Gate capture operations on the official plugin | REQ-FUNC-610a4011 | See Design |
| Inspect offline capture evidence | REQ-FUNC-610a4012 | See Design |
| Bind packet pages to their query | REQ-FUNC-610a4013 | See Design |
| Diagnose an invalid display filter | REQ-FUNC-610a4014 | See Design |
| Constrain native offline analysis | REQ-SEC-610a4015 | See Design |
| Publish validated managed capture bytes | REQ-DATA-610a4016 | See Design |
| Reject invalid capture inputs | REQ-REL-610a4017 | See Design |
| Identify incomplete packet evidence | REQ-REL-610a4018 | See Design |


## Design

### Approach

OBSERVED both CLI and Desktop compose a ProgramHost and the same SessionService. Attach a read tool
and a session-class import tool there. Recheck the official tier and package digest at dispatch and disclosure
(REQ-FUNC-610a4011). Use its resolver and the runner's process host with a bounded private output
channel. The service generates every native option (REQ-SEC-610a4015).

### Interfaces and data

STATED capture references bind a workbench or managed source to the size, format and SHA-256.
Frame references add frame number and available interface/timestamp. Query context carries the
TShark version, managed profile, filter and coverage. Continue by frame number within an identical
query and verify its capture and query hash (REQ-FUNC-610a4012, REQ-FUNC-610a4013).
Use a private snapshot for each native capture operation and verify reference identity independently
of TShark. Withhold a managed reference until a complete native validation finishes and verified
same-directory staging is published atomically under workbench write
admission (REQ-DATA-610a4016, REQ-REL-610a4017).

### Files and test seams

Shared schemas describe the evidence and parameters. Core wireshark separates native projection,
storage and the analysis service. The model replay and native fixtures cover the public tool.

### Risks and open decisions

STATED returned packet text is untrusted. Only selected protocol metadata and numeric address and
length fields can be disclosed. Block raw fields and model-controlled extension settings at the
host. Mask packet values before the final result bound. Page and scan coverage are independent (REQ-FUNC-610a4014,
REQ-SEC-610a4015, REQ-REL-610a4018). UNKNOWN native Ubuntu availability.

### Requirement map

- REQ-FUNC-610a4011 uses SessionService and the official ProgramHost loader.
- REQ-FUNC-610a4012–610a4014 use the shared contract and native projection.
- REQ-SEC-610a4015 uses native arguments, safe field projection and path guards.
- REQ-DATA-610a4016 and REQ-REL-610a4017 use snapshot and publication verification.
- REQ-REL-610a4018 uses the scan, process, page and gateway result bounds.

Diagrams: [diagram_TASK-5dd935de.md](diagram_TASK-5dd935de.md).


## Log

- 2026-11-25 frame: journal opened
- 2026-11-25 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-25 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-25 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-25 build: red: focused plugin registry test exit 1 - the wireshark_capture tool was absent (REQ-FUNC-610a4011)
- 2026-11-25 build: green Windows x64 and TShark 4.6.10: npm run typecheck exit 0; focused plugin replay/manifest/classifier/discovery 6 passed; shared tool catalog and import boundaries 19 passed. Receipt 05_Software/test-outputs/401/windows-focused.log.
- 2026-11-25 build: green WSL2 Ubuntu 24.04 and TShark 4.2.2: focused native Linux executable replay 3 passed, exit 0. Receipt 05_Software/test-outputs/401/wsl-native.log. Native Ubuntu host acceptance remains open.
- 2026-11-25 build: Independent round 1: specification changes_required (independent reference verification, effective profile proof, result limit after agent masking and typed skill guidance). Implementation quality changes_required (managed storage permission class, lexical path reservation, staging integrity and result-budget proof).
- 2026-11-25 build: DEVIATION build: Registry red recorded before implementation, and native replay exposed integration defects during build. Some focused boundary assertions were added during review alongside their fixes; no separate red receipt exists for those assertions.
- 2026-11-25 build: Advisory check has zero errors. Existing journal, context, and requirement advisories persist; release-note and preexisting untracked paths are outside the AEGIS layout. Source overlap for tests was linked in the owning requirements. Evolution also recorded removal of three transient untracked DEB files outside the candidate.
- 2026-11-25 build: Final focused Windows 4.6.10: 6 plugin assertions exit 0 (windows-final-plugin.log) and 21 shared, boundary and storage checks exit 0 (windows-focused.log). WSL2 4.2.2: typed replay 3 and storage 2 exit 0 (wsl-native.log). Both used local fixtures. Focused commands are printed in the task handover.
- 2026-11-25 build: completed; next validate (1 Done checklist item(s) left unticked)
- 2026-11-25 validate: Round 2 independently approved the specification and implementation quality. Reviewers checked the complete working candidate against the recorded base and observed Windows focused receipts. Scope acceptance still requires a native Ubuntu receipt.
- 2026-11-25 validate: Focused commands (from 05_Software, through npmw): vitest run --project plugins tests/plugins/wireshark-tshark.test.ts -t typed|publishes|classifies|finds on Windows; shared tools.test.ts, tooling boundaries.test.ts and wireshark storage.test.ts. WSL2 used the same typed selector and storage.test.ts. VERA_REQUIRE_TSHARK=1 ensured both acceptances executed; all exit 0.
- 2026-11-25 validate: final: python .agentic/aegis.py check --task TASK-5dd935de --strict --run exit 0. Lint, typecheck, i18n and help passed; 51 nonblocking advisories include existing records, out-of-layout release files and bundled scratch, plus the project context page size. npm run check:release-notes and git diff --check exit 0.
- 2026-11-25 validate: DEVIATION validate: Native Ubuntu receipt unavailable. The local Ubuntu distribution runs under WSL2. The only configured remote shell alias investigated failed host-key verification and no authorized native target was established. The milestone suites were deferred by explicit instruction.
- 2026-11-25 validate: DEVIATION validate: Windows policy rejected recursive removal of the task-owned portable extraction at 05_Software/test-outputs/401/windows (blocked by policy). The WSL2 replay sandbox and temporary archives/scripts were removed. Original evidence logs remain.
- 2026-11-25 validate: Delivery report correction under RULING-002: the remaining checklist item is resolved for this task by the existing evidence and authorized deferral. Windows x64 passed 27 focused checks, Ubuntu 24.04 under WSL2 passed 5 focused checks, and strict AEGIS and release notes exited 0. Native Ubuntu acceptance remains pending at final cycle verification. The earlier delivery report is a historical pre-ruling snapshot. Only this journal changed and no checks were rerun.
- 2026-11-25 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-25 | decision=The coordinator may make the validated local commit and close Gitea #401; the implementation chat leaves the candidate unstaged | reason=Explicit implementation delegation on shared master | source=user | supersedes=none
- RULING-002 | date=2026-11-25 | decision=Defer native Ubuntu acceptance for Gitea #401 to the final cycle verification and close this AEGIS task using its existing evidence. | reason=The user explicitly decided in the coordinator chat: mutam la verificarea finala. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-5dd935de.md
changed: Recorded the user-authorized native Ubuntu deferral in the task journal.
evidence: Existing Windows 27 and WSL2 5 focused checks passed. Strict AEGIS and release notes exited 0. Both round 2 reviews approved.
issues: Native Ubuntu acceptance is deferred to final cycle verification under RULING-002.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-25)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-610a4011 - Gate capture operations on the official plugin
  - REQ-FUNC-610a4012 - Inspect offline capture evidence
  - REQ-FUNC-610a4013 - Bind packet pages to their query
  - REQ-FUNC-610a4014 - Diagnose an invalid display filter
  - REQ-SEC-610a4015 - Constrain native offline analysis
  - REQ-DATA-610a4016 - Publish validated managed capture bytes
  - REQ-REL-610a4017 - Reject invalid capture inputs
  - REQ-REL-610a4018 - Identify incomplete packet evidence
- deviations: 3 recorded
  - build: Registry red recorded before implementation, and native replay exposed integration defects during build. Some focused boundary assertions were added during review alongside their fixes; no separate red receipt exists for those assertions.
  - validate: Native Ubuntu receipt unavailable. The local Ubuntu distribution runs under WSL2. The only configured remote shell alias investigated failed host-key verification and no authorized native target was established. The milestone suites were deferred by explicit instruction.
  - validate: Windows policy rejected recursive removal of the task-owned portable extraction at 05_Software/test-outputs/401/windows (blocked by policy). The WSL2 replay sandbox and temporary archives/scripts were removed. Original evidence logs remain.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base f84f11e: 59 file(s) changed, 2481 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=51 notes=44
- checklist: 7/9 done; open: manual or inspection verification recorded where applicable; `report` appended

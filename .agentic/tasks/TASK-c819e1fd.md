# TASK-c819e1fd - TERM-03 Additional workbench folders (#314)

stage: done
type: feature
interaction: autopilot
requirements: REQ-DATA-f0170301, REQ-SEC-f0170302, REQ-SEC-f0170303, REQ-SEC-f0170304, REQ-UX-f0170305, REQ-SEC-f0170306
parent:
branch: master
base: f8d1b0f377d5fb94bd34b758123a27dca4af9bec
opened: 2026-11-16

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

Problem: STATED #314: outside Bypass file tools and commands cannot use a second repository.
Desired outcome: STATED #314: explicit user-selected additional absolute folders persist at format1, appear in overview and grant normal Ask/Auto-edit file/command access until removal.
Actors: STATED user edits General; agent requests file tools and shell commands; host owns live authority.
Primary scenario: STATED sibling folder added, read and approved run_command succeed in Ask; unlisted folder is refused; removing grant refuses immediately, including pending requests.
Examples: STATED TERM-03-A/B and coordinator delegation cover restart, protected aliases and removal before execution.
Counterexamples: STATED model/tool parameters and sanitized renderer paths never grant authority; application-data lexical/canonical exclusions remain in every mode.
In scope: STATED #314 and delegation: bounded absolute config validation, chooser/removal with Save/Cancel/read-only controls, host live policy, four locales/help/release notes, focused real native/session and Linux boundary proof.
Out of scope: STATED delegation: TERM04/05, indexing/storage widening, shell sandbox, compatibility/migration, branch/worktree/push/full suites, stage/commit/issue closure.
Constraints: OBSERVED master at full base f8d1b0f377d5fb94bd34b758123a27dca4af9bec, expected predecessor committed. STATED user authorizes local ticket commits; coordinator owns commit after handover and final epic gate. Preserve unrelated workflow payload, bundled-plugins and PERF TASK-9a4d3e8a. Autopilot authorized.
Success signals: STATED A/B actual sibling read/command, unlisted/revoked/protected refusal, restart persistence, masked grant preservation, candidate statics/strict and independent spec/quality reviewers.
Evidence: OBSERVED tea issues314/311 --comments --login ddp --repo dpasare/2026_Virtual_Embedded_Rig_Assistant; terminal.md, current PathGuard/toolPathGuard, WorkbenchService and editor mask-safe command-prefix mechanism.
Assumptions: INFERRED reuse existing host-owned policies and approvals to avoid changing unrelated scopes.
Unknowns: Native Ubuntu unavailable; WSL2 pinned Linux Node proof is distinct. Exact affected consumers determined during design.
Decision-blocking questions: None; scope and acceptance authorized.
Proposed behaviors: None awaiting acceptance.

## Requirement coverage

| Requirement | Behavior | Design | Proof |
|---|---|---|---|
| REQ-DATA-f0170301 | Persist user-selected additional folders | Host policy / config / user UI | Focused boundary and native tests |
| REQ-SEC-f0170302 | Grant only live host-selected file and command roots | Host policy / config / user UI | Focused boundary and native tests |
| REQ-SEC-f0170303 | Revoke removed folders before execution | Host policy / config / user UI | Focused boundary and native tests |
| REQ-SEC-f0170304 | Preserve protected exclusions and source identities | Host policy / config / user UI | Focused boundary and native tests |
| REQ-UX-f0170305 | Edit and display additional folders | Host policy / config / user UI | Focused boundary and native tests |
| REQ-SEC-f0170306 | Preserve hidden grants on unrelated saves | Host policy / config / user UI | Focused boundary and native tests |


## Design

Diagrams: [diagram_TASK-c819e1fd.md](diagram_TASK-c819e1fd.md)

### Approach
REQ-SEC-f0170302/03/04: add optional extra roots only to ordinary read/list/glob/grep/write/edit and run_command. Preserve default confined PathGuard consumers for indexing, artifacts, generated outputs and plugin programs. Relative paths resolve from the primary root; external paths stay canonical absolute with no workbench line references. Each grant checks lexical and canonical membership together; symlinks cannot escape it. Protected application-data checks precede membership in all modes.

### Interfaces and data
REQ-DATA-f0170301: additional_folders defaults empty in format1; strict bounded shared absolute path/list schemas reject cross-platform ambiguous/device/relative syntax. Host SessionService receives a live additionalFolders callback; ToolContext never accepts grants from model parameters.
REQ-SEC-f0170303: guards capture exact live roots and fail if removed/changed at any asynchronous publication or side-effect seam; command apply and beforeSpawn re-resolve under current policy. Worker grep receives only host snapshot roots, with host authorization rechecked before results return.
REQ-SEC-f0170306: editor list returns complete SHA256 identities plus scrubbed labels. Native chooser stages exact host paths by identity for the active workbench. Save passes selected addition/removal IDs, preserving hidden grants and command prefixes; stale IDs conflict. Sanitized configuration excludes masked paths and editor never echoes grants.

### Files and test seams
Shared folder schema, workbench config and IPC; core PathGuard/tool context/file and grep tools, WorkbenchService and SessionService; desktop/CLI host composition; main chooser/IPC masking; General folder component/editor and overview; mocks, four locale/help files and release notes/inventories. Tests attach to schemas, actual guard/file/command operations, service persistence/masked IDs, worker return revocation and native UI/restart.

### Risks and open decisions
REQ-SEC-f0170304: grants authorize file access/cwd only, not a shell sandbox. Protected roots and Bypass epoch remain authoritative. Existing commands can access OS paths as documented. No compatibility code or format bumps. WSL2 proof is separate from unavailable native Ubuntu. Full app/plugin suites explicitly deferred by coordinator; runner/prefix proof reused unchanged.

### Requirement map
REQ-DATA-f0170301 maps schema and persistence; REQ-SEC-f0170302 live file/command guard; REQ-SEC-f0170303 async rechecks; REQ-SEC-f0170304 protected paths/provenance; REQ-UX-f0170305 localized UI; REQ-SEC-f0170306 host ID mutation.


## Log

- 2026-11-16 frame: journal opened
- 2026-11-16 frame: User authorizes local ticket commit; coordinator owns commit and final gate. Implementation chat never stages/commits. Base f8d1b0f377d5fb94bd34b758123a27dca4af9bec on master/default master; complete owned uncommitted candidate is review scope, unrelated external files excluded.
- 2026-11-16 frame: completed; next specify - Autopilot scoped TERM03 accepted
- 2026-11-16 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-16 design: completed; next build
- 2026-11-16 build: red: focused shared workbench and core PathGuard tests, expected missing additional_folders default and outside grant refusal (REQ-DATA-f0170301/REQ-SEC-f0170302/03/04); original evaluation-outputs/term03/red.log
- 2026-11-16 build: green: focused workbench schema/PathGuard 41 passed,1 existing skipped; guard-green.log. red: service staged folder identity test fails missing chooseAdditionalFolder (REQ-DATA-f0170301/REQ-SEC-f0170306), service-red.log.
- 2026-11-16 build: green: tools-ui.log 41/41 focused tests; native-third.log real Windows Electron TERM03-A/B including restart, unlisted/protected alias, pending removal and masked unrelated save/removal; browser four-language pass in native-browser-first.log. Native retry corrected test session-selection timing/context budget; product unchanged.
- 2026-11-16 build: DEVIATION build: UI red result was not captured before adding folder controls - schema/guard/service missing-behavior reds preceded implementation, while dedicated UI coverage was added during integration and native/browser acceptance now proves it.
- 2026-11-16 build: DEVIATION validate: complete app/plugin suites and native Ubuntu deferred by explicit coordinator scope; smallest relevant plugin runner/command regressions used, TERM01 process and TERM02 prefix proof reused where unchanged. WSL2 Linux boundary proof is separate.
- 2026-11-16 build: green: final-affected.log93passed/1existing skipped; async-seams.log44passed/1existing skipped. Includes typed stale/max65 errors, canonical alias identity and nested-root ignores, actual Windows file/shell probe and final write seam removal. Original broader focused-regressions.log197pass/2skip plus one new nested alias failure now corrected by nested-bounds.log2pass and final-affected full guard pass. WSL2 pinned Node24.21.0 final standalone probe exit0 in wsl2-platform-final.log.
- 2026-11-16 build: green: folder-display.log37/37 including four locales, read-only controls, config-event masked-grant refresh and immediate chat/plugin editor consumers. i18n/help/release-notes checks all exit0; candidate Biome45files exit0 with only unchanged preload warning. Known global2format baselines remain excluded.
- 2026-11-16 build: completed; next validate
- 2026-11-16 validate: Final native-browser-corrected.log exit0,2/2: current-source instrumented Windows sandboxed Electron plus four-locale Chromium. Masked removal event refresh is asserted in native overview; app files/settings unchanged after protected alias attempts. Native screenshot/receipt retained; owned native scratch/profiles and process trees cleaned in finally. Complete candidate76owned paths frozen for independent round1 spec/quality review; final strict follows approvals.
- 2026-11-16 validate: returned to build - Review1: bind grep captured mode/canonical roots and actual read source provenance
- 2026-11-16 build: Review1 red: additional-folders.test.ts targeted3 failures reproduced actual worker Ask/Bypass scope widening, root junction retarget to unlisted data and read content/absolute identity mismatch; review1-red.log exit1. Original autopilot authorization covers scoped review corrections; no new product decisions or scope.
- 2026-11-16 build: Review1 green: scoped file/PathGuard/worker/read/grep tests59passed/1existing skipped, review1-focused.log. Worker scope now comes from captured guard; captured lexical/canonical roots reject alias replacement at worker initialization; read path comes from actual file.target. Added3red-to-green actual worker/provenance regressions.
- 2026-11-16 build: Review1 proof: review1-focused.log59passed/1existing skipped; review1-component-probe.log6/6;6changed-file Biome0 and component Biome0; review1-wsl2.log pinned Node24.21.0 Linux actual grep worker1success plus admitted-root retarget refusal, shell/read/log/revocation all pass. Typecheck corrected overloaded subscribe test mock; final typecheck exit0. Native/browser corrected proof reused for unchanged General/masking/command acceptance; new alias/mode worker seams covered directly on actual workers.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: Independent round2 spec_review and quality_review both approved complete corrected76file candidate with no remaining actionable findings. Source/tests/docs frozen; final strict static run now follows approvals. Original proof reused only where exercised behavior/source is unchanged; review1 boundary fixes have dedicated Windows actual-worker and WSL2 proof.
- 2026-11-16 validate: final: python .agentic/aegis.py check --task TASK-c819e1fd --strict --run --full exit1; configured statics only, no full tests. Typecheck0/i18n0/help0; global lint exactly2known format errors. Original strict-final.log. Focused two-file read-only baseline check exit1 confirms only bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts (blob953b4ea3eb9f249b88acc4202f42a2930273f04b), lint-baseline.log. Candidate Biome45files0 plus review1changed6/component1files0; release-notes0 reused unchanged. No source/tests/docs edits after round2 approvals.
- 2026-11-16 validate: DEVIATION validate: final strict retains2unchanged global lint formatting baselines explicitly excluded by coordinator. Advisory91warnings/38notes include existing oversized context/layout/ticket/journal records, excluded bundled archives and traceability heuristics; changed behavior is covered by linked focused/native/Linux tests and both independent approvals. No full suites/native Ubuntu. Coordinator owns final epic gate and local commit; user payload, bundled-plugins and PERF task remain untouched.
- 2026-11-16 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-16 | decision=User authorizes the local TERM03 ticket commit; coordinator owns staging, commit and issue closure after handover. This implementation chat does not stage or commit. | reason=Root AGENTS.md and explicit delegated implementation-cycle instructions | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-c819e1fd.md
changed: TERM03 candidate complete;76owned files; no staging or commit
evidence: Focused93/44/37 plus review59/6; native/browser2; WSL2realworker; round2reviews approved; candidate statics0; strict1 only baseline lint2
issues: Two unchanged global lint baselines; full suites deferred; native Ubuntu unavailable; coordinator owns commit
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-16)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-DATA-f0170301 - Persist user-selected additional folders
  - REQ-SEC-f0170302 - Grant only live host-selected file and command roots
  - REQ-SEC-f0170303 - Revoke removed folders before execution
  - REQ-SEC-f0170304 - Preserve protected exclusions and source identities
  - REQ-UX-f0170305 - Edit and display additional folders
  - REQ-SEC-f0170306 - Preserve hidden grants on unrelated saves
- deviations: 3 recorded
  - build: UI red result was not captured before adding folder controls - schema/guard/service missing-behavior reds preceded implementation, while dedicated UI coverage was added during integration and native/browser acceptance now proves it.
  - validate: complete app/plugin suites and native Ubuntu deferred by explicit coordinator scope; smallest relevant plugin runner/command regressions used, TERM01 process and TERM02 prefix proof reused where unchanged. WSL2 Linux boundary proof is separate.
  - validate: final strict retains2unchanged global lint formatting baselines explicitly excluded by coordinator. Advisory91warnings/38notes include existing oversized context/layout/ticket/journal records, excluded bundled archives and traceability heuristics; changed behavior is covered by linked focused/native/Linux tests and both independent approvals. No full suites/native Ubuntu. Coordinator owns final epic gate and local commit; user payload, bundled-plugins and PERF task remain untouched.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base f8d1b0f: 107 file(s) changed, 2993 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=91 notes=38
- checklist: 9/9 done

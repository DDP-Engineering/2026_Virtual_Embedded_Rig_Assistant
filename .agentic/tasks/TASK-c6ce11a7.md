# TASK-c6ce11a7 - Select enabled plugins in each workbench editor

stage: done
type: change
path: full
interaction: autopilot
requirements: REQ-UX-e07790cb, REQ-UX-fd6bc95d, REQ-FUNC-41f5c03b
parent:
branch: master
base: 300373de3d2609dc91d16bb04a1bef5f1ab333b6
opened: 2026-11-04

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

Problem: STATED user wants selection in each workbench instead of the global plugin/catalog page; OBSERVED config form currently points to the global page.
Desired outcome: STATED select/deselect installed plugins in each workbench, with no plugins selected by default.
Actors: STATED engineer configuring a workbench.
Primary scenario: STATED edit workbench, open Plugins, choose installed packages, save; another workbench keeps its own choices.
Examples: STATED new workbench starts empty; choose probe-rs only for the current project.
Counterexamples: OBSERVED installing a package must not enable it or alter other workbenches; cancel must not save draft selections.
In scope: STATED workbench-local selection in create/edit and empty defaults; INFERRED move enable controls out of the global manager while retaining installation/review/provisioning there.
Out of scope: STATED stopped plugin implementation cycle; OBSERVED no new plugin packages, migrations, remote publication or automatic clearing of existing selections requested.
Constraints: OBSERVED shared master at300373de3d2609dc91d16bb04a1bef5f1ab333b6; root AGENTS authorizes local commit after focused/static/strict and independent reviews. Formats remain1. Existing writable/trust/ownership boundaries unchanged.
Success signals: OBSERVED tests prove unchecked defaults, draft save/cancel, two-workbench isolation and persistence/reopen; no enable switches on global manager.
Evidence: OBSERVED workbench-config-form.tsx pointer; editor/create omit plugins in config patches; shared/workbench.ts already defaults plugins.enabled=[]; service supports isolated patches.
Assumptions: INFERRED default means new workbenches; preserve explicit selections in existing workbenches.
Unknowns: UNKNOWN native Ubuntu availability; identify WSL proof separately.
Decision-blocking questions: none; existing configuration save/cancel contract determines draft behavior.
Proposed behaviors: none pending.
Path and reason:
| Criterion | Holds? | Evidence |
| no new externally observable behavior | no | selection moves into editor |
| no new interface/data format | no | new renderer selection component; stored format unchanged |
| no new dependency | yes | existing Query/IPC |
| existing requirement covers behavior | no | revise two UX contracts explicitly requested by user |
| no security/data change | yes | existing trust and opt-in storage reused |
Full path, autopilot. Single task; independent read-only reviewers at validate.

## Requirement coverage

| Requirement | Behavior | Design | Proof |
|---|---|---|---|
| REQ-UX-e07790cb | New/edit form lists installed packages with draft selection | WorkbenchPlugins via plugins.list, preserve invalid selected entries | component + native create/edit/cancel/reopen |
| REQ-UX-fd6bc95d | Global manager no longer controls workbench activation | remove enable controls; describe configuration location | global component/native regression |
| REQ-FUNC-41f5c03b | Empty defaults, per-workbench save/isolation | reuse plugins.enabled; include it in existing create/update payloads | shared/core regression and native two-workbench |

## Design

### Approach
Add WorkbenchPlugins to the existing shared WorkbenchConfigForm Plugins section (REQ-UX-e07790cb). It edits config.plugins.enabled through the draft setter, matching Tools and the existing Save/Cancel contract. Global Plugins keeps install/review/provision/export/uninstall and directs selection to workbench configuration (REQ-UX-fd6bc95d).
### Interfaces and data
Existing workbench uses plugins.list with its id, new workbench uses global installed list before creation. The bound listing preserves scoped trust; untrusted/broken packages cannot be newly selected, already selected invalid/missing ids remain visible and removable. No scanning/provisioning or trust action is added by selection. Read-only and pending saves disable checkboxes through the existing form fieldset. Query errors show existing ErrorMessage and retry; draft data remains intact. Existing enabled arrays load as configured; new draft/default remains empty (REQ-FUNC-41f5c03b). Create/update send plugins.enabled with other configuration; Cancel sends nothing. No format changes/migrations.
### Files and test seams
Renderer workbench-plugins.tsx, config-form, editor/create, global plugins.tsx and en/ro/de literals. Focused component tests cover draft create/save/cancel/read-only/error/unknown rows. Native plugins-ui.spec.ts proves persisted selection/removal, two-workbench isolation and restart; affected browser/native tests move old global switches into editor. Shared/core existing defaults and isolation tests reused unchanged.
### Risks and open decisions
Global installation vs workbench activation stays explicit; no automatic dependency selection. Scoped plugins require existing explicit machine trust review before activation; source unchanged. New-workbench UI lists globally installed packages; portable packages can be reviewed/selected after creating/opening the workbench through the existing bound manager. No unresolved product decision. Tests use isolated profiles; normal user application will be gracefully closed before rebuilding and restarted with its current profile.
### Requirement map
REQ-UX-e07790cb: shared selection component. REQ-UX-fd6bc95d: global activation removed. REQ-FUNC-41f5c03b: existing storage/default boundary reused by form payloads.
Diagrams: [diagram_TASK-c6ce11a7.md](diagram_TASK-c6ce11a7.md)

## Log

- 2026-11-04 frame: journal opened
- 2026-11-04 frame: User authorizes this requested UI change and local commit on shared master; earlier automatic plugin queue remains paused. Base300373de3d2609dc91d16bb04a1bef5f1ab333b6; no remote publication.
- 2026-11-04 frame: completed; next specify
- 2026-11-04 specify: completed; next design
- 2026-11-04 design: completed; next build
- 2026-11-04 build: red: pinned vitest workbench-plugins.test.ts exit1; all8 cases fail because the existing Plugins form section has no selection controls (expected missing behavior, no import/setup failures). REQ-UX-e07790cb/REQ-FUNC-41f5c03b.
- 2026-11-04 build: green: initial renderer selection/global manager/tools29 tests passed. Later focused increment:91 passed/1 failed in6 files; failure is unchanged Docs headingless DOCX search timeout5000ms plus cleanup EBUSY. Targeted failed test will rerun alone after build; passing91 reused. Typecheck passed after test fixture patches use workbenchPatchSchema. Original logs in02_Tools/cache/workbench-plugins-TASK-c6ce11a7.
- 2026-11-04 build: green: Windows focused91 passed and exact failed headingless-DOCX service test passed alone with30000ms timeout (prior5000ms loaded-host timeout/cleanup diagnostic retained). Typecheck0. Windows native cohort4 passed; two fixture failures corrected only in test helper: target current workbench id rather than first recent, and wait for editor save to close before navigating. Affected native2 rerun passed; unchanged4 reused. Ubuntu24.04 WSL2 x64 focused35 passed, native workbench draft save/cancel/two-workbench/restart1 passed after same helper correction. No native Ubuntu/ARM64 claim. Proof02_Tools/cache/workbench-plugins-TASK-c6ce11a7 and owned Linux counterpart.
- 2026-11-04 build: completed; next validate
- 2026-11-04 validate: Self-review complete: create/edit send plugins.enabled, controls edit only config draft, selected unknown/invalid ids remain removable; global management has no activation switch. Scoped review and package provisioning remain separate. Native actual YAML observations confirm default[], cancel without writes, saved[echo-tools], workbenchB default[] while A retained selection, restart checked state, deselect->[]. Windows native2 and WSL native1 original logs match final test helpers. Both independent read-only reviews are underway.
- 2026-11-04 validate: Round1 independent specification and quality approved complete candidate against300373d: /root/workbench_plugin_spec and /root/workbench_plugin_quality. Both inspected actual tests/original proof and made no changes or test runs. No remaining findings; final strict follows last candidate edit.
- 2026-11-04 validate: final: python .agentic/aegis.py check --task TASK-c6ce11a7 --strict --run exit0 after both round1 approvals and last source/test/doc edit. Lint/typecheck/i18n pass; errors0,warnings48,notes9.46 pre-existing warnings retained; two uncovered-source warnings classify linked test files as source, not missing behavior coverage. Focused91+failed1 targeted retry, native4+affected2 Windows and focused35/native1 UbuntuWSL2 proof remain valid. No full suite or handover retest.
- 2026-11-04 validate: User-authorized local integration: complete candidate and both independent approvals accepted, original focused/native/static proof reused, strict0 and normal build0. No new plugin package or automatic queue resumed. Commit only this requested workbench-selection change on master; no push or remote publication. Owned Linux source/build scratch removed after successful proof; original evidence retained. Existing native Ubuntu/hardware/release verification obligations remain distinct.
- 2026-11-04 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-c6ce11a7.md
changed: Select/deselect installed plugins in each workbench New/Edit configuration, applied on Save/Create; new workbenches default to no plugins
evidence: Focused Windows92 including targeted retry, native6; Ubuntu WSL2 focused35/native1; both independent reviews round1 approved; strict lint/typecheck/i18n0 and normal build0
issues: Linux execution is Ubuntu WSL2; native Ubuntu/hardware not claimed. No product blocker or remote publication.
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-04)

- stage: validate; type: change; path: full; branch: master
- requirements:
  - REQ-UX-e07790cb - Select plugins in the workbench configuration
  - REQ-UX-fd6bc95d - Separate plugin installation from workbench selection
  - REQ-FUNC-41f5c03b - Enable plugins per workbench
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base 300373d: 22 file(s) changed, 593 line(s) added
- checks: errors=0 warnings=48 notes=9
- checklist: 9/9 done

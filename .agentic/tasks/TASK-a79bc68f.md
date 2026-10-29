# TASK-a79bc68f - Bound document watcher roots to configured sources

stage: done
type: fix
path: full
interaction: autopilot
requirements: REQ-REL-2512a455
parent:
branch: master
base: 8f887954ce298f8adb04d83c43577a58bd7d28de
opened: 2026-10-29

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

Problem: STATED VERA repeatedly becomes Not Responding after opening Test1. OBSERVED Windows main thread is blocked in NtCreateFile/CreateFileW/uv_fs_event_start with about 26,000 handles; renderer/GPU remain responsive. Ingester watches the entire MatrixRetroGames root although docs.include is docs/** and that directory does not exist.
Desired outcome: opening a workbench with scoped document sources does not register watchers throughout unrelated trees; live document/config monitoring remains correct.
Actors: desktop engineer; background Ingester.
Primary scenario: open workbench -> observe configured source roots plus policy files -> keep window responding and refresh indexed sources.
Examples: docs/** watches docs and .vera policy files; generated SDK sibling trees are not traversed. A later source configuration change rebinds monitoring.
Counterexamples: explicit root-wide patterns still need root-wide observation; missing source directories must be detected when created; exclusions/ownership/symlink guards remain enforced.
In scope: source-root selection, serialized watcher rebinding/close, focused watcher regressions and actual native responsiveness proof.
Out of scope: application formats, project content, index processors, unrelated UI, historical journal edits (user preservation instruction).
Constraints: AEGIS autopilot, shared master; diagnosed project content preserved. Previous validated work has been committed by user authorization.
Success signals: real Chokidar does not watch SDK siblings under docs/**, configuration changes and directory recreation still ingest, actual Test1 open remains responsive with low handle count.
Evidence: OBSERVED live process 21192/main thread 15172 native stack; knowledge/ingest.ts watch(options.root); project .vera/workbench.yaml docs/**; no docs folder.
Assumptions: picomatch scan gives a conservative literal prefix; unscoped patterns retain whole-root monitoring.
Unknowns: the underlying Windows/driver reason a particular directory open waits indefinitely is not determined; avoiding unrelated registrations removes this trigger.
Decision-blocking questions: none.
Proposed behaviors: accepted bounded monitoring for configured sources; existing source admission and close semantics retained.
Path and reason:
| Criterion | Holds? | Evidence |
| no new externally observable behavior | no | bounded resource contract made explicit |
| no new interface/data format | yes | internal watcher selection only |
| no new dependency | yes | pinned picomatch/chokidar |
| existing requirement fully covers behavior | no | new scoped-watch requirement |
| no security/data-handling change | yes | current guards and writes retained |
Full path; current master retained under repository instructions.

## Requirement coverage

| Frame outcome | Requirement | Design | Verification |
| Scope monitoring to selected sources and preserve live policy changes | REQ-REL-2512a455 | Conservative roots + serialized watcher replacement | real watcher topology/events, native Test1 opening |

## Design

### Approach
REQ-REL-2512a455: derive conservative literal prefixes with existing picomatch.scan from positive include patterns. Register those roots plus the two policy files. An unprefixed pattern intentionally selects the root. Missing sources remain watch targets; existing symlink ancestors are reduced to the link itself to avoid traversal. Keep permanent ignores and followSymlinks=false.
### Interfaces and data
No persisted format or API change. Ingester owns a serialized watcher replacement queue. Changed target roots close the prior watcher before starting its replacement; close cancels pending replacements. Readiness schedules reconciliation to cover gaps. Selection predicates and path guards retain admission authority.
### Files and test seams
knowledge/ingest.ts: root derivation and watcher lifecycle. ingest.test.ts: wrap real Chokidar to observe completed registrations; use live source mutations and configuration changes. Native ingest fixture explicitly creates its own docs directory (VERA owns only .vera). Native app: reopen actual Test1, verify Settings/editor responsiveness and handles.
### Risks and open decisions
Missing-directory parent observation must remain shallow. Explicit root-wide scope can still be expensive; worker isolation and Windows driver analysis are outside this bounded fix. Serialized replacement avoids Chokidar unwatch/re-add ignored-path ambiguity and leaks. Metadata files stay monitored. No open decisions.
### Requirement map
REQ-REL-2512a455 -> conservative targets, live rebinding/close; topology, live ingestion, native UI proof.

## Log

- 2026-10-29 frame: journal opened
- 2026-10-29 frame: completed; next specify - autopilot scope accepted from diagnosed UI freeze (7 Done checklist item(s) left unticked)
- 2026-10-29 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-10-29 design: User authorized local commits; autopilot inherited from repository. Base 8f88795. Historical journals and unrelated optional-companions.md excluded. Native stack identifies main-loop watcher registration, not renderer saturation.
- 2026-10-29 design: completed; next build
- 2026-10-29 build: Red: two real Chokidar regressions failed on SDK traversal and absent rebinding. Green: both passed after scoped roots/replacement. Existing escaped-glob contract exposed a request-time exception, now kept as reconcile-time denial. Focused combined verification running. No pre-build anchor recorded; Git base and complete candidate diff provide review boundary.
- 2026-10-29 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-29 validate: returned to build - Review found old watcher readiness may remain pending when rebind closes it; settle cancelled readiness and follow the latest generation
- 2026-10-29 build: Bounded review fix under existing autopilot authority: cancellation now settles readiness, waitIdle follows replacement generation. Fault injection over real Chokidar covers immediate rebind and close. Deterministic missing-root test waits until ready before mkdir docs. Final focused ingest+embedding: 26 passed/1 Windows symlink skip. Earlier service+embedding: 34 passed; host 5s timeouts rerun with 20s test budget, assertions unchanged.
- 2026-10-29 build: completed; next validate
- 2026-10-29 validate: returned to build - Native acceptance fixture assumed VERA creates docs; align fixture with existing project-content ownership contract
- 2026-10-29 build: Final service suite:32 passed. Native acceptance first failed because its existing fixture expected create-workbench to create docs. Fixture now creates its document source explicitly; production unchanged. Ubuntu WSL is installed but has no Node/runtime/dependencies; Windows native proof addresses this Windows-specific registration freeze, Ubuntu not tested.
- 2026-10-29 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-29 validate: Manual/native: live stack of frozen PID21192/TID15172 was NtCreateFile/CreateFileW/uv_fs_event_start; approximately26300 handles. Computer Use observed restarted home UI, then user confirmed app running/tested and UI actions stopped. Separate native probe opened ACTUAL Test1 writable using isolated profile: Responding=true,986 handles,3 FSEventWrap,elapsed2685ms including1500ms settle; main RPC responsive, workbench config hash unchanged, closed cleanly. Native ingest E2E1 passed/15.1s. Core58 passed/1 Windows file-symlink skip. Round3 spec and quality approved complete candidate.
- 2026-10-29 validate: Final proof: strict --run first exited1 solely for CRLF formatting in edited native test. Normalized LF; SHA256 of complete canonical Git diff remained a44446e142bbb542b068e078fac1c0ead29dc5bbdc92d7725b00963fb7fd5b64. Reused passing typecheck (19.6s) and i18n (1.7s) for same candidate; reran only failed lint: exit0,419 files,30 existing warnings/12 infos. Focused assertions unchanged under host-specific20s test budget. 58 tests passed,1 platform skip; native E2E1 passed; actual Test1 responsive986handles. Ubuntu untested. Prior journals preserved.
- 2026-10-29 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-10-29 done: DEVIATION validate: native Ubuntu was not exercised because installed WSL lacks Node/dependencies; accepted for this Windows-specific freeze with actual Windows workbench, real filesystem and Electron proof. Final checklist evidence satisfied; untracked optional-companions.md is unrelated and excluded from staged candidate.
- 2026-10-29 done: Cleanup limitation: policy rejected native PowerShell deletion of verified owned Temp paths vera-wb-0dIT2c,vera-wb-XzTp9Z,vera-freeze-probe-a79bc68f.cjs,vera-freeze-reviewed-patch-sha-a79bc68f.txt (blocked by policy). Retained outside repository; no bypass attempted. All native probe apps closed. User notified. No historical journals or project configuration changed.

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-a79bc68f.md
changed: Scoped filesystem monitoring and cancellable watcher readiness
evidence: 58 focused tests +1 native E2E passed; Test1 responsive986handles/3watchers; lint,typecheck,i18n,strict passed
issues: Ubuntu not exercised (runtime absent);24 pre-existing AEGIS advisories preserved
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-10-29)

- stage: validate; type: fix; path: full; branch: master
- requirements:
  - REQ-REL-2512a455 - Scoped document monitoring avoids unrelated directory watches
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 8f88795: 8 file(s) changed, 610 line(s) added
- checks: errors=0 warnings=24 notes=4
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

## Delivery report (2026-10-29)

- stage: done; type: fix; path: full; branch: master
- requirements:
  - REQ-REL-2512a455 - Scoped document monitoring avoids unrelated directory watches
- deviations: 1 recorded
  - validate: native Ubuntu was not exercised because installed WSL lacks Node/dependencies; accepted for this Windows-specific freeze with actual Windows workbench, real filesystem and Electron proof. Final checklist evidence satisfied; untracked optional-companions.md is unrelated and excluded from staged candidate.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 8f88795: 8 file(s) changed, 623 line(s) added
- checks: errors=0 warnings=24 notes=4
- checklist: 9/9 done

## Delivery report (2026-10-29)

- stage: done; type: fix; path: full; branch: master
- requirements:
  - REQ-REL-2512a455 - Scoped document monitoring avoids unrelated directory watches
- deviations: 1 recorded
  - validate: native Ubuntu was not exercised because installed WSL lacks Node/dependencies; accepted for this Windows-specific freeze with actual Windows workbench, real filesystem and Electron proof. Final checklist evidence satisfied; untracked optional-companions.md is unrelated and excluded from staged candidate.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 8f88795: 8 file(s) changed, 636 line(s) added
- checks: errors=0 warnings=24 notes=4
- checklist: 9/9 done

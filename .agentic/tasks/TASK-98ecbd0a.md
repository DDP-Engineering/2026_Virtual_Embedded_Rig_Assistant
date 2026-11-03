# TASK-98ecbd0a - PLG-06 Plugins UI

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-a5be5e53, REQ-SEC-8e281f52, REQ-FUNC-6c76f25a, REQ-DATA-f563074f, REQ-FUNC-39617f81, REQ-FUNC-f024d73c, REQ-FUNC-8c38d223, REQ-UX-28503c97, REQ-UX-41c19e62, REQ-UX-e6056763, REQ-UX-8904f319, REQ-UX-acc04fbc, REQ-UX-fd6bc95d, REQ-UX-d51c6e3c, REQ-UX-c1de1651, REQ-UX-e0e51891, REQ-UX-25921e97, REQ-UX-93fd56dc, REQ-UX-e07790cb
parent:
branch: master
base: 2270cce2e26f8215d7916dcfbac14c62c5856a32
opened: 2026-11-03

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

Problem: Plugins can only be installed, enabled and provisioned through IPC calls or the CLI; the desktop Plugins page and the workbench editor's Plugins section are placeholders (OBSERVED `renderer/components/plugins.tsx`, 06-ui §2), and the user cannot see or stop plugin program runs or read their logs (OBSERVED: `ProgramRunner` keeps only unfinished runs in memory and writes bare logs to `.vera/runs/`, `core/src/plugins/runner.ts`).
Desired outcome: users manage plugins and watch runs (STATED, ticket #62 goal): an installed list with tier, version, program versions and errors; enable per workbench; install from a folder or zip through a review screen (programs, install sources, every rule with its risk and note); uninstall; a Runs panel with running and recent runs, open log and stop; all strings in en, ro, de (STATED, #62 scope).
Actors: the engineer using the desktop app (STATED); the agent starts runs (OBSERVED, run_program) but never installs, enables or reviews (STATED, architecture §5, §8).
Primary scenario: the engineer opens Plugins, chooses Install from folder, picks `serial-monitor`, reads the review (program `serial`, script install source, rules with risk and notes), installs, installs its programs, enables it for the open workbench; the agent starts a background capture; the engineer opens the Runs tab, opens the run's log and stops it (INFERRED from #62 scope and done-when).
Examples: review of the fixture `echo-tools` lists program `echo` (find `%VERA_TEST_NODE%`, hint "Install Node.js.") and five rules from `safe` to `blocked` with the notes "Writes the device." and "Burns a fuse." (OBSERVED fixture plugin.yaml). A background `echo serve` run is listed as running with its log showing `boot` and `READY`; Stop ends it as stopped (OBSERVED echo.mjs behaviour).
Counterexamples: a package whose manifest is invalid shows its issues on the review screen and cannot be installed; an installed plugin edited after review lists "changed since review" plus its manifest error and is not loaded (OBSERVED store issues `changed`, `field`). A run of another workbench never appears in this workbench's Runs tab.
In scope: Plugins page (sidebar) as the manager; native folder and zip pickers; a read-only review of a candidate package and install bound to the reviewed package hash; provisioning button (`plugins.provision`); uninstall with confirmation; per-plugin enable toggle for the open workbench; Runs tab in the right panel per workbench (list running and recent runs, log viewer, stop); run records next to run logs so recent runs keep program, plugin and arguments; browser mock support; en/ro/de strings; unit, component and e2e tests (mock and native).
Out of scope: catalog, pack browser, tiers from a catalog, updates (PLG-07, STATED plan); trial install, promote and plugin authoring (PLG-12, STATED plan); enabling plugins inside New Workbench or the workbench editor draft (INFERRED: the editor's draft save would overwrite immediate toggles; the section points to the Plugins page instead).
Constraints: master branch, no new branch (STATED by the starting session); LF line endings; pre-release, no compat or migration code, format versions stay 1 (STATED memory/AGENTS); no real internet in tests (STATED); renderer reaches main only through shared zod channels (OBSERVED project.md); the existing shell, mock and compact-shell e2e check every language, theme and text scale (STATED); Windows x64 only on this machine (STATED).
Success signals: Playwright e2e installs the fixture plugin from a folder through the review screen and enables it for one workbench; a broken plugin shows its manifest error; the Runs panel opens a run log and stops a background run (STATED #62 done-when); typecheck, lint, check:i18n, vitest and `aegis check --strict --run` pass.
Evidence: #62 and epic #54 (tea); 00_Planning/plugins/plan.md §PLG-06, architecture §5-§7; 06-ui.md §1-§2, §6-§8; shared `plugins.ts`, `ipc.ts`; core `store.ts`, `runner.ts`, `program-tools.ts`; main `index.ts` plugin handlers; renderer `App.tsx`, `shell.tsx`, `plugins.tsx`, `workbench-config-form.tsx`, `mocks/mockApi.ts`; e2e `program-runs.spec.ts`, `mock.spec.ts`; PLG-05/08/09 hand-over notes.
Assumptions: the sidebar's existing Plugins page is the "Settings -> Plugins" of the plan (INFERRED: the page exists for plugins, Settings has no plugin section; every done-when item holds either way). Polling the Runs list once a second while the tab is shown is fresh enough (INFERRED).
Unknowns: Linux behaviour of the native pickers and the native e2e (UNKNOWN on this Windows machine).
Decision-blocking questions: none.
Proposed behaviors: (not accepted until specify) `plugins.review` returns the package hash, manifest and issues without installing; `plugins.install` takes the reviewed `sha256` and refuses CONFLICT when the package changed; runs listed newest first, at most 50; a log view shows the last 1 MiB; a run record whose run is not active and has no result reads as interrupted.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new screens and IPC channels |
| no new interface or data format | no | `plugins.review`, `plugins.choose`, `runs.*` channels; run records in `.vera/runs/` |
| no new dependency | yes | React, zod, existing libraries |
| an existing requirement already covers the behavior | no | no UI requirement for plugins or runs exists |
| no security or data-handling change | no | install binds to the reviewed hash; renderer stops runs |

## Requirement coverage

| Behavior | Requirement | Tests |
|---|---|---|
| Review a package without installing (proposed review behavior) | REQ-FUNC-a5be5e53 | store.test, plugins-ipc.test, mockApi.test, plugins-ui.spec |
| Install bound to the reviewed hash; CONFLICT on change | REQ-SEC-8e281f52 | store.test, plugins-ipc.test, mockApi.test |
| Native folder / zip picker | REQ-FUNC-6c76f25a | inspection, plugins-ui.spec |
| Run records beside logs (recent runs keep program, plugin, args) | REQ-DATA-f563074f | runner.test, program-tools.test, plugins-ui.spec |
| Runs list: per workbench, newest first, 50, running/interrupted | REQ-FUNC-39617f81 | runner.test, mockApi.test |
| Run log read: last 1 MiB; NOT_FOUND | REQ-FUNC-f024d73c | runner.test, mockApi.test |
| Stop a run; NOT_FOUND when not running here | REQ-FUNC-8c38d223 | runner.test, mockApi.test |
| Installed list with tier, version, program versions | REQ-UX-28503c97 | plugins.test, plugins-mock.spec |
| Broken plugin shows its manifest error (done-when 2) | REQ-UX-41c19e62 | plugins.test, plugins-ui.spec |
| Review screen: programs, install sources, rules with risk and note | REQ-UX-e6056763 | plugins.test, plugins-ui.spec, plugins-mock.spec |
| Review of a package with issues: Install disabled | REQ-UX-8904f319 | plugins.test, plugins-ui.spec |
| Install from the review screen (done-when 1) | REQ-UX-acc04fbc | plugins.test, plugins-ui.spec, plugins-mock.spec |
| Enable per workbench (done-when 1) | REQ-UX-fd6bc95d | plugins.test, plugins-ui.spec, plugins-mock.spec |
| Install programs (plugins.provision) from the page | REQ-UX-d51c6e3c | plugins.test, plugins-mock.spec |
| Uninstall with confirmation | REQ-UX-c1de1651 | plugins.test |
| Runs panel lists running and recent runs | REQ-UX-e0e51891 | runs-tab.test, plugins-mock.spec, mock.spec |
| Runs panel opens a run log (done-when 3) | REQ-UX-25921e97 | runs-tab.test, plugins-ui.spec, plugins-mock.spec |
| Runs panel stops a background run (done-when 3) | REQ-UX-93fd56dc | runs-tab.test, plugins-ui.spec, plugins-mock.spec |
| Workbench form Plugins section placeholder replaced | REQ-UX-e07790cb | plugins.test, workbench-navigation.spec |

All strings go through i18n en/ro/de, checked by the existing `check:i18n` gate and the mock e2e language loop; no new requirement.

## Design

**Approach.** One renderer component per surface, all through new shared zod channels, keeping core the owner of files. (1) The sidebar's Plugins page becomes the manager (`renderer/components/plugins.tsx`): list, pickers, review screen, provision, enable switch for the open workbench, uninstall (REQ-UX-28503c97, -41c19e62, -e6056763, -8904f319, -acc04fbc, -fd6bc95d, -d51c6e3c, -c1de1651). The review screen is a state of that page, not a modal, so the long rule table scrolls with the page. (2) A sixth right-panel tab, Runs (`renderer/components/runs-tab.tsx`), shown whenever a workbench is open like Docs; it polls `runs.list` every second with TanStack Query (`refetchInterval`) while mounted (REQ-UX-e0e51891), opens a modal `<dialog>` log viewer that polls `runs.log` while the run is running (REQ-UX-25921e97) and calls `runs.stop` (REQ-UX-93fd56dc). (3) Core: `PluginStore.review(path)` shares the package read (`readPackage`) with `install`, and `install(path, sha256?)` refuses CONFLICT before writing when the hash differs (REQ-FUNC-a5be5e53, REQ-SEC-8e281f52). `ProgramRunner` writes a run record beside each log at begin and end and gains `list`, `log` and `stop` by workbench (REQ-DATA-f563074f, REQ-FUNC-39617f81, -f024d73c, -8c38d223). Rejected: keeping recent runs only in memory (lost on restart, and logs without metadata cannot show the command line); events instead of polling (a new event topic for one tab; one small read per second is cheap). Rejected: enable switches in the workbench editor draft, because the editor saves its whole config and would overwrite immediate toggles; the form's Plugins section points to the page instead (REQ-UX-e07790cb).

**Interfaces and data.** Exact formats: spec REQ-DATA-f563074f. Channels: `plugins.choose {kind}` -> `{path|null}` (`dialog.showOpenDialog`; instrumented override `VERA_TEST_PLUGIN_PATH`) (REQ-FUNC-6c76f25a); `plugins.review {path}` -> `pluginReviewSchema`; `plugins.install {path, sha256}` (sha256 now required; pre-release, so the e2e and mock callers change, no compat); `runs.list {workbenchId}` -> `{runs}`; `runs.log {workbenchId, id}` -> `{id, text, truncated, running}`; `runs.stop {workbenchId, id}` -> `{}`. `RunRequest` gains optional `label {plugin, program, args}`; `program-tools.ts` passes the agent's arguments, never the executable or prefixes. `ProgramRunnerOptions.now` (default `new Date()`) stamps `startedAt`. Record writes are best effort and never fail a run. Errors are VeraErrors translated by `ErrorMessage`; issue codes get `plugins.issue.<code>` keys. Risk badges reuse `approval.risk.*` and `.risk-badge`.

**Files and test seams.** shared `plugins.ts`, `ipc.ts` (+ `plugins-ipc.test.ts`); core `store.ts` (+ `store.test.ts`), `runner.ts` (+ `runner.test.ts`), `program-tools.ts` (+ `program-tools.test.ts` label); desktop `main/index.ts` (handlers; inspection + native e2e); renderer `plugins.tsx`, `runs-tab.tsx`, `shell.tsx`, `App.tsx`, `workbench-config-form.tsx`, `styles.css`, locales en/ro/de, `mocks/mockApi.ts` with a mock run model (+ new `plugins.test.ts`, `runs-tab.test.ts` component tests in the jsdom style of `skills.test.ts`, `mockApi.test.ts`); e2e: new native `tests/e2e/plugins-ui.spec.ts` (install through review, enable, broken plugin, Runs log and stop with replay script `program-serve.jsonl`), mock `tests/e2e/mock.spec.ts` tab loop gains `runs`; `program-runs.spec.ts` and `program-approvals.spec.ts` pass the reviewed hash.

**Risks and open decisions.** Security: review and install read the same absolute path at two moments; the hash binding closes the gap (REQ-SEC-8e281f52). The renderer can stop any running run of the open workbench, which a user can already do by closing the workbench; the agent is not involved. Concurrency: the runner writes the end record after the log closes and before `done` settles, so a list after Stop sees `stopped`. Six tabs must fit a 14 rem panel at text scale 1.5 in de/ro: the tab list may need to wrap; the mock e2e overflow check proves it. Linux: native pickers and the native e2e run only on Windows here (DEVIATION in validate).

**Requirement map.** REQ-FUNC-a5be5e53: `PluginStore.review`. REQ-SEC-8e281f52: `install(path, sha256)` CONFLICT before staging. REQ-FUNC-6c76f25a: `plugins.choose` handler. REQ-DATA-f563074f: runner records + prune. REQ-FUNC-39617f81: `ProgramRunner.list`. REQ-FUNC-f024d73c: `ProgramRunner.log`. REQ-FUNC-8c38d223: `ProgramRunner.stopRun`. REQ-UX-28503c97, -41c19e62, -e6056763, -8904f319, -acc04fbc, -fd6bc95d, -d51c6e3c, -c1de1651: `plugins.tsx`. REQ-UX-e0e51891, -25921e97, -93fd56dc: `runs-tab.tsx` + shell tab. REQ-UX-e07790cb: `workbench-config-form.tsx`.

Diagrams: [diagram_TASK-98ecbd0a.md](diagram_TASK-98ecbd0a.md)


## Log

- 2026-11-03 frame: journal opened
- 2026-11-03 frame: DEVIATION frame: the plugin manager is the sidebar's existing Plugins page, not a new Settings section as plan §PLG-06 words it - the page already exists for plugins; planning docs are updated to match
- 2026-11-03 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-03 specify: completed; next design
- 2026-11-03 design: completed; next build
- 2026-11-03 build: red: npx vitest run core/src/plugins/store.test.ts exit 1 - store.review is not a function, install has no hash binding (REQ-FUNC-a5be5e53, REQ-SEC-8e281f52)
- 2026-11-03 build: red: npx vitest run core/src/plugins/runner.test.ts exit 1 - no run records, runner.list/log/stopRun missing (REQ-DATA-f563074f, REQ-FUNC-39617f81, REQ-FUNC-f024d73c, REQ-FUNC-8c38d223)
- 2026-11-03 build: green: npx vitest run core/src/plugins/store.test.ts exit 0 (REQ-FUNC-a5be5e53, REQ-SEC-8e281f52)
- 2026-11-03 build: red: npx vitest run core/src/plugins/program-tools.test.ts -t 'command line' exit 1 - run record has no plugin/program label (REQ-DATA-f563074f)
- 2026-11-03 build: green: npx vitest run core/src/plugins/ shared/src/plugins-ipc.test.ts renderer/mocks/mockApi.test.ts exit 0 (REQ-DATA-f563074f, REQ-FUNC-39617f81, REQ-FUNC-f024d73c, REQ-FUNC-8c38d223, REQ-FUNC-a5be5e53, REQ-SEC-8e281f52)
- 2026-11-03 build: red: npx vitest run renderer/components/plugins.test.ts exit 1 - Plugins page is a placeholder (REQ-UX-28503c97, REQ-UX-41c19e62, REQ-UX-e6056763, REQ-UX-8904f319, REQ-UX-acc04fbc, REQ-UX-fd6bc95d, REQ-UX-d51c6e3c, REQ-UX-c1de1651, REQ-UX-e07790cb)
- 2026-11-03 build: red: npx vitest run renderer/components/runs-tab.test.ts exit 1 - runs-tab.tsx does not exist (REQ-UX-e0e51891, REQ-UX-25921e97, REQ-UX-93fd56dc)
- 2026-11-03 build: green: npx vitest run renderer/components/plugins.test.ts runs-tab.test.ts exit 0; npm run typecheck, lint (0 errors), check:i18n exit 0 (REQ-UX-28503c97, REQ-UX-41c19e62, REQ-UX-e6056763, REQ-UX-8904f319, REQ-UX-acc04fbc, REQ-UX-fd6bc95d, REQ-UX-d51c6e3c, REQ-UX-c1de1651, REQ-UX-e07790cb, REQ-UX-e0e51891, REQ-UX-25921e97, REQ-UX-93fd56dc)
- 2026-11-03 build: green: VERA_TEST=1 npm run test:e2e -- plugins-ui plugins-mock program-runs program-approvals workbench-navigation mock shell compact-shell: 16 passed (REQ-UX-e6056763, REQ-UX-8904f319, REQ-UX-acc04fbc, REQ-UX-fd6bc95d, REQ-UX-41c19e62, REQ-UX-e0e51891, REQ-UX-25921e97, REQ-UX-93fd56dc, REQ-FUNC-6c76f25a)
- 2026-11-03 build: Inspection REQ-FUNC-6c76f25a: main plugins.choose passes openDirectory (folder) or openFile with a zip filter (zip), maps canceled to null; plugins-ui.spec drives it through VERA_TEST_PLUGIN_PATH. Manual native picker check on Windows and Linux is owed to the user.
- 2026-11-03 build: DEVIATION build: tests/e2e/workbench-navigation.spec.ts expected 14 workbench tools but PLG-04 (af4fbdf) made the catalog 17; the count is aligned to 17 so the spec that covers the Plugins page runs - an unrelated stale assertion fixed in passing
- 2026-11-03 build: discovery: the app QueryClient sets staleTime Infinity; the plugin list, program statuses, runs list and run log set staleTime 0 so each opening shows disk state (integrity is rechecked per list)
- 2026-11-03 build: check: errors=0; remaining warnings belong to other requirements and journals (stale-paths, no-linked-tests, ticket-ref, journal-header); none names this task's requirements or files
- 2026-11-03 build: completed; next validate
- 2026-11-03 validate: self-review fix: runs.list args and runs.log text are credential-scrubbed in main like documents and approval payloads; runner.log lstat-refuses a link in place of a log (Windows has no O_NOFOLLOW); spec and knowledge updated
- 2026-11-03 validate: review round 1 findings - spec: REQ-UX-93fd56dc/REQ-FUNC-a5be5e53/REQ-SEC-8e281f52/REQ-UX-e07790cb verification wording, spec says record written at log open (it is written before spawn), 06-ui/01-system/02-workbench say 14 tools; quality: stop during the pre-spawn record write is lost (runner.ts), run_program args count vs record max 64, log dialog focus return under a real modal, truncated log tail may start mid-secret, record rewrite not atomic and runs.list error unscrubbed
- 2026-11-03 validate: returned to build - review round 1 findings (spec wording; stop race before spawn, args cap, dialog focus, log tail cut, atomic record and scrubbed error)
- 2026-11-03 build: red: vitest runner.test.ts -t 'review round 1' exit 1 - a stop during the pre-spawn record write is lost (run spawns, never ends); a truncated tail starts mid-line (REQ-FUNC-8c38d223, REQ-FUNC-f024d73c)
- 2026-11-03 build: green: vitest core/src/plugins + plugins.test + runs-tab.test 181 passed; typecheck, lint (0 errors), check:i18n exit 0; test:e2e plugins-ui, plugins-mock, program-runs 3 passed (incl. focus return to Open log). Round-1 fixes: record write moved before the last stop check; truncated tail starts after its first line break; record replaced via tmp+rename; runs.list error scrubbed; dialog focus restored after close; wording of REQ-UX-93fd56dc, REQ-FUNC-a5be5e53, REQ-SEC-8e281f52, REQ-UX-e07790cb, REQ-FUNC-f024d73c, spec, 06-ui/01-system/02-workbench tool count. Not changed: run_program args >64 are already refused by prepareProgramRequest (program-request.ts:248) before any run, so no record can exceed 64
- 2026-11-03 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-03 validate: review round 2: spec approved, quality approved. Non-blocking notes kept out of scope: programRunRecordSchema repeats the 64/4096 literals instead of PROGRAM_ARGUMENTS; a crash between the tmp write and rename leaves an orphan <id>.json.tmp that prune ignores; a 1 MiB tail without any line break is kept whole
- 2026-11-03 validate: final: python .agentic/aegis.py check --task TASK-98ecbd0a --strict --run exit 0 (errors=0; lint, typecheck, i18n ok); full npx vitest run exit 0 (209 files, 1682 passed, 12 skipped); 46 warnings are pre-existing (other requirements' stale-paths/no-linked-tests/ticket-ref, other journals' headers), none names this task
- 2026-11-03 validate: DEVIATION validate: native Electron e2e and the native folder/zip pickers ran on Windows x64 only; the Linux run (xvfb) and a manual picker check on Ubuntu are owed to the user
- 2026-11-03 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-98ecbd0a.md
changed: design note; diagram_TASK-98ecbd0a.md
evidence: aegis check --task TASK-98ecbd0a --strict --run exit 0; npx vitest run exit 0 (1682 passed)
issues: Linux native e2e and pickers not run (Windows only); manual board checks owed from PLG-08/09
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-03)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-a5be5e53 - Review a plugin package without installing it
  - REQ-SEC-8e281f52 - Install only the reviewed package
  - REQ-FUNC-6c76f25a - Choose a plugin folder or zip in a native picker
  - REQ-DATA-f563074f - Record each plugin program run next to its log
  - REQ-FUNC-39617f81 - List a workbench's program runs
  - REQ-FUNC-f024d73c - Read a program run log
  - REQ-FUNC-8c38d223 - Stop a program run from the desktop app
  - REQ-UX-28503c97 - List installed plugins with their programs
  - REQ-UX-41c19e62 - Show a broken plugin's errors
  - REQ-UX-e6056763 - Review a plugin before installing it
  - REQ-UX-8904f319 - Refuse installing a package with issues
  - REQ-UX-acc04fbc - Install the reviewed plugin
  - REQ-UX-fd6bc95d - Enable a plugin for the open workbench
  - REQ-UX-d51c6e3c - Install a plugin's programs from the Plugins page
  - REQ-UX-c1de1651 - Uninstall a plugin after confirmation
  - REQ-UX-e0e51891 - Show program runs in the Runs tab
  - REQ-UX-25921e97 - Open a run log from the Runs tab
  - REQ-UX-93fd56dc - Stop a background run from the Runs tab
  - REQ-UX-e07790cb - Point the workbench Plugins section to the Plugins page
- deviations: 3 recorded
  - frame: the plugin manager is the sidebar's existing Plugins page, not a new Settings section as plan §PLG-06 words it - the page already exists for plugins; planning docs are updated to match
  - build: tests/e2e/workbench-navigation.spec.ts expected 14 workbench tools but PLG-04 (af4fbdf) made the catalog 17; the count is aligned to 17 so the spec that covers the Plugins page runs - an unrelated stale assertion fixed in passing
  - validate: native Electron e2e and the native folder/zip pickers ran on Windows x64 only; the Linux run (xvfb) and a manual picker check on Ubuntu are owed to the user
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 2270cce: 62 file(s) changed, 3605 line(s) added
- checks: errors=0 warnings=46 notes=6
- checklist: 9/9 done

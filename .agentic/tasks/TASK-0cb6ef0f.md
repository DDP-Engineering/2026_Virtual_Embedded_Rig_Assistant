# TASK-0cb6ef0f - PLG-01 Manifest schema and plugin store

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-4d4471f9, REQ-FUNC-6dd00f25, REQ-FUNC-6db9dc8f, REQ-FUNC-77843ccc, REQ-SEC-9b266629, REQ-FUNC-deaa76d1, REQ-FUNC-f003e3e5, REQ-SEC-892a67e8, REQ-FUNC-1d6999a7, REQ-FUNC-9ba5f19c, REQ-FUNC-41f5c03b, REQ-FUNC-0c4bc419, REQ-FUNC-9dd7413b
parent:
branch: master
base: 80934992bc1ec7404493c86bf3f0b306a3f72264
opened: 2026-11-01

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

Problem: VERA cannot install, validate, list or enable plugins: there is no plugin.yaml schema, no plugin store and no per-workbench enablement (OBSERVED: no plugin code in 05_Software/src; architecture STATUS "nothing implemented yet").
Desired outcome: plugins install from a folder or a zip into <userData>/plugins/installed/<id>/ with install.json, are listed with field-level validation errors over IPC, are disabled with "changed since review" when any file changes, and are enabled per workbench through plugins.enabled in .vera/workbench.yaml (STATED: ticket #57 scope and done-when).
Actors: the engineer (installs, uninstalls, enables per workbench through IPC; the Plugins UI is PLG-06); later packages PLG-03/04/05 that read validated manifests from the store.
Primary scenario: the engineer installs esp32-esptool from its folder; VERA validates plugin.yaml, copies the files, records install.json with the integrity hash; after restart the plugin is listed valid; enabling it in workbench A writes plugins.enabled in A only.
Examples: the canonical esp32-esptool manifest of the ticket installs and lists valid (STATED); the same package as a zip, either with files at its root or under one top folder named esp32-esptool, installs the same (INFERRED from "folder or a zip"); editing any installed file lists the plugin with "changed" (STATED); a manifest with id "Bad_ID" or timeout 4000 lists field-level errors at id / programs.<name>.timeout (STATED: field rules); workbench B keeps plugins.enabled [] after A enables esp32-esptool (STATED).
Counterexamples: a skill folder without plugin.yaml is not a plugin; enabling a plugin never installs or provisions programs (PLG-05); listing never runs a program.
In scope: zod schema for plugin.yaml format 1 in shared (all fields of ticket and architecture 2.1, incl. prefix); PluginStore in core: install (folder, zip), uninstall, list with issues, load that refuses invalid or changed plugins, integrity hash; install.json; workbench plugins.enabled with patch, merge, UNKNOWN_KEY/UNKNOWN_NAME warnings; IPC channels plugins.list/install/uninstall/toggle in shared, desktop main and browser mock.
Out of scope: rule matching semantics and risk evaluation (PLG-03, STATED plan); running or provisioning programs and resolved program versions beyond an empty map (PLG-02, PLG-05); agent tools and prompt (PLG-04); Plugins UI (PLG-06); catalog tiers official/community, review screen, requires auto-install (PLG-07); trial plugins (PLG-12); workbench-scoped plugins (PLG-13) (STATED: plan.md order and package split).
Constraints: format and record versions stay 1, no migration or compat code (STATED: user rule, root AGENTS.md); LF; core stays Electron-free, renderer reaches main only through shared channels (OBSERVED: project.md); zod is the only schema language (ADR-0010); fflate is already a core dependency (OBSERVED: core/package.json); Windows x64 is the only runnable host here, Linux behavior is covered by unit tests (STATED: task). Work is on master (developer's choice, STATED by the orchestrating session).
Success signals: the four done-when items of #57 hold in automated tests: install from folder and zip survives a new store instance; changing any file lists "changed" and load refuses it; a malformed manifest lists field-level issues and load refuses it; enabling in one workbench leaves another unchanged.
Evidence: skills.ts (skillErrorSchema enum diagnostics), catalog.ts (bounded reads, list with diagnostics, sha256 recheck), workbench.ts (disabled lists, configWarnings UNKNOWN_NAME, mergeWorkbench), workbench/service.ts toggleSkill (write queue, warnings), ipc.ts skills channels, main/index.ts handlers, mockApi.ts (OBSERVED).
Assumptions: install of a folder or zip records tier "local" (STATED ADR-0019: installed from a folder or zip is local); install from the renderer passes an absolute path like workbench.open does (OBSERVED ipc.ts).
Unknowns: resolved program versions are filled by PLG-05 (empty map now); whether requires must be installed before enabling is decided by PLG-07 (catalog installs them together); bounds for package size are not specified (ADR-0017 removes the VERA package budget, not plugin-import bounds).
Decision-blocking questions: none. The ticket lists platforms (windows-x64, linux-x64) while architecture 2.1 also accepts linux-arm64 "subset of windows-x64, linux-x64, linux-arm64"; resolved by following the cited spec (ruling recorded).
Proposed behaviors (accepted for this task by the orchestrating brief, autopilot): import bounds of 4096 files, 64 MiB uncompressed and 64 MiB zip, 256 KiB manifest; symlinks and unsafe paths refused; a root install.json in a package is reserved and refused; integrity hash = SHA-256 over each file in sorted relative path order framed as path NUL size NUL bytes; install refuses an invalid manifest with INVALID and the first issue's path in params; list shows every issue of installed entries; plugins.toggle refuses nothing beyond schema, unknown IDs warn like skills.
Path and reason: full - new interface, data format and behavior.

   | Criterion | Holds? | Evidence |
   |---|---|---|
   | no new externally observable behavior | no | install/list/enable plugins |
   | no new interface or data format | no | plugin.yaml, install.json, IPC channels, workbench plugins key |
   | no new dependency | yes | fflate, yaml, zod already present |
   | an existing requirement already covers the behavior | no | no plugin requirement exists |
   | no security or data-handling change | no | imports untrusted folders/zips into userData |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| plugin.yaml format 1 validation with field paths | REQ-DATA-4d4471f9 |
| install from a folder, install.json, survives restart | REQ-FUNC-6dd00f25 |
| install from a zip (root or one top folder) | REQ-FUNC-6db9dc8f |
| error: invalid manifest refuses install, store unchanged | REQ-FUNC-77843ccc |
| error: unsafe or oversized package refused | REQ-SEC-9b266629 |
| reinstall replaces the whole installation | REQ-FUNC-deaa76d1 |
| list with metadata and field-level issues | REQ-FUNC-f003e3e5 |
| error: changed files list "changed since review" | REQ-SEC-892a67e8 |
| load only valid, unchanged plugins; NOT_FOUND/INVALID | REQ-FUNC-1d6999a7 |
| uninstall; NOT_FOUND | REQ-FUNC-9ba5f19c |
| plugins.enabled per workbench, toggle and patch | REQ-FUNC-41f5c03b |
| UNKNOWN_NAME / UNKNOWN_KEY warnings | REQ-FUNC-0c4bc419 |
| IPC channels and mock | REQ-FUNC-9dd7413b |

## Design

**Approach.** A pure zod manifest schema in shared (`plugins.ts`) and a stateless, disk-backed
`PluginStore` in core (`plugins/store.ts`): every `list`/`load` re-reads `installed/<id>/`, re-parses
`plugin.yaml` and recomputes the integrity hash, so restart survival and "changed since review" need
no cache (REQ-FUNC-6dd00f25, REQ-SEC-892a67e8). Install reads the source (folder walk or fflate zip,
both into one in-memory `Map<path, bytes>` under the import limits), validates it exactly as `list`
does, writes it to `plugins/staging/<uuid>/`, then swaps it into `installed/<id>` (old folder moved to
staging first and restored if the swap fails) (REQ-FUNC-6db9dc8f, REQ-FUNC-deaa76d1). Enablement is a
`plugins.enabled` list in `workbench.yaml`, mirroring `skills.disabled` (REQ-FUNC-41f5c03b).
Rejected: hashing at install only and caching validity in install.json - an edit after install would
go unnoticed (REQ-SEC-892a67e8).

**Interfaces and data.** Shared: `pluginIdSchema`, `pluginManifestSchema`, `pluginRiskSchema`,
`pluginTierSchema`, `pluginIssueSchema`, `pluginSummarySchema`, limits constants (spec
REQ-DATA-4d4471f9). Core: `PluginStore({ root })` with `install(path)`, `list()`, `load(id)`,
`uninstall(id)`, `ids()`; `pluginIntegrity(files)`; `install.json` schema in core (storage format).
Install errors: INVALID with `params {issue, path?}` for manifest issues (REQ-FUNC-77843ccc), INVALID
or DENIED for unsafe packages (REQ-SEC-9b266629); store mutations run one at a time on an internal
queue. Workbench: `plugins: {enabled: []}` default, patch `plugins.enabled`, `mergeWorkbench` merges it,
`configWarnings` takes `catalogs.plugins` (REQ-FUNC-0c4bc419); `WorkbenchService.warnings` passes
`PluginStore.ids()` of `<userData>/plugins` (empty without userData); `togglePlugin(id, plugin,
enabled)` on the write queue like `toggleSkill`; `enabledPlugins(id)` reads the current config.
IPC: `plugins.list {workbenchId?}`, `plugins.install {path}` (absolute), `plugins.uninstall {id}`,
`plugins.toggle {workbenchId, id, enabled}` (REQ-FUNC-9dd7413b).

**Files and test seams.** shared `plugins.ts` + `plugins.test.ts` (REQ-DATA-4d4471f9),
`plugins-ipc.test.ts`, `ipc.ts`, `index.ts`, `workbench.ts` + `workbench.test.ts`; core
`plugins/store.ts` + `plugins/store.test.ts` (all store requirements, temp folders, fflate `zipSync`
for zips), `index.ts`, `workbench/service.ts` + `service.test.ts`; desktop `main/index.ts`,
`renderer/mocks/mockApi.ts`.

**Risks and open decisions.** Untrusted input: zip entry names and folder entries pass the relative
path rules before any write, sizes are summed from the zip directory before inflating (zip bombs),
symlinks refused (REQ-SEC-9b266629). Windows directory renames can fail while a file in the old folder
is open; the swap then rolls back and reports the error. Crash leftovers in `plugins/staging/` are not
cleaned up yet. Linux paths are covered by unit tests only (Windows host). Open: `requires`
enforcement (PLG-07), resolved program versions (PLG-05).

**Requirement map.** REQ-DATA-4d4471f9 shared schema; REQ-FUNC-6dd00f25, REQ-FUNC-6db9dc8f,
REQ-FUNC-77843ccc, REQ-SEC-9b266629, REQ-FUNC-deaa76d1 store install path; REQ-FUNC-f003e3e5,
REQ-SEC-892a67e8, REQ-FUNC-1d6999a7 store list/load inspection; REQ-FUNC-9ba5f19c store uninstall;
REQ-FUNC-41f5c03b, REQ-FUNC-0c4bc419 workbench schema and service; REQ-FUNC-9dd7413b IPC and mock.

Diagrams: [diagram_TASK-0cb6ef0f.md](diagram_TASK-0cb6ef0f.md)

## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: completed; next specify - autopilot: no blocking question (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-01 build: red: vitest run shared/src/plugins.test.ts exit 1 - plugins.js manifest schema missing (REQ-DATA-4d4471f9)
- 2026-11-01 build: green: vitest run shared/src/plugins.test.ts exit 0 (REQ-DATA-4d4471f9)
- 2026-11-01 build: red: vitest run shared plugins-ipc.test.ts workbench.test.ts exit 1 - no plugins key, warnings or plugins.* channels (REQ-FUNC-41f5c03b, REQ-FUNC-0c4bc419, REQ-FUNC-9dd7413b)
- 2026-11-01 build: green: vitest run src/libraries/shared exit 0, 119 tests (REQ-DATA-4d4471f9, REQ-FUNC-41f5c03b schema part, REQ-FUNC-0c4bc419 configWarnings, REQ-FUNC-9dd7413b channels)
- 2026-11-01 build: red: vitest run core/src/plugins exit 1 - PluginStore missing (REQ-FUNC-6dd00f25, REQ-FUNC-6db9dc8f, REQ-FUNC-77843ccc, REQ-SEC-9b266629, REQ-FUNC-deaa76d1, REQ-FUNC-f003e3e5, REQ-SEC-892a67e8, REQ-FUNC-1d6999a7, REQ-FUNC-9ba5f19c)
- 2026-11-01 build: green: vitest run core/src/plugins exit 0, 9 tests (REQ-FUNC-6dd00f25, REQ-FUNC-6db9dc8f, REQ-FUNC-77843ccc, REQ-SEC-9b266629, REQ-FUNC-deaa76d1, REQ-FUNC-f003e3e5, REQ-SEC-892a67e8, REQ-FUNC-1d6999a7, REQ-FUNC-9ba5f19c)
- 2026-11-01 build: red: vitest run core workbench/service.test.ts -t 'enables a plugin' exit 1 - togglePlugin/enabledPlugins and plugin warnings missing (REQ-FUNC-41f5c03b, REQ-FUNC-0c4bc419)
- 2026-11-01 build: green: vitest run core workbench/service.test.ts exit 0, 39 tests (REQ-FUNC-41f5c03b, REQ-FUNC-0c4bc419); vitest run desktop main + mockApi.test.ts exit 0, 184 tests (REQ-FUNC-9dd7413b); typecheck exit 0; lint exit 0 (0 errors)
- 2026-11-01 build: DEVIATION build: the browser-mock plugin test in mockApi.test.ts was written after the mock handlers and passed on first run, so it has no red line - the shared channel test was red first and the router type check enforces the main handlers; the mock is a test double, so the cost is low
- 2026-11-01 build: evolution reviewed: 18 paths, all in the design's files plus main/events.ts (config event sanitizer must carry the new plugins key, scrubbed like skills.disabled) and the exhaustive channel lists in ipc-router.test.ts and bridge.test.ts; no other component reached
- 2026-11-01 build: full vitest run exit 1: 1183 passed, 10 skipped, 1 failed - core tools/discovery.test.ts 'globs newest first' timed out at 5094 ms under full-suite load; rerun alone exit 0 (2 passed, 2.0 s); file untouched by this task
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-02 validate: review round 1: spec approved (minor: spec omits some bounds, missing_file issue value, record wording, link-in-installed maps to changed, no alias test, too_big not asserted); quality changes_required - blocking: readZip sums only originalSize, so a stored entry with a lying central directory bypasses the 64 MiB limit (zip bomb); minor: folder-prefix case collisions, raw EPERM/EBUSY as INTERNAL and rm(previous) failure after swap, list outside the queue, lstat/readFile swap window, CONIN$/CONOUT$
- 2026-11-02 validate: returned to build - review round 1 findings: zip size bypass (blocking) and minor store/spec findings
- 2026-11-02 build: red: vitest run core/src/plugins shared plugins.test.ts exit 1 - a zip with hidden stored sizes installs; CONIN$ path accepted (REQ-SEC-9b266629, REQ-DATA-4d4471f9)
- 2026-11-02 build: green: vitest run core/src/plugins shared plugins.test.ts exit 0, 12 tests - stored-size mismatch refused, sizes counted as max(size, originalSize), folder/file case collisions refused, alias refused, too_big asserted, CONIN$/CONOUT$ reserved; reads open the lstat-checked file without following links (ino/dev compared, O_NONBLOCK); rename EPERM/EBUSY map to BUSY; failed cleanup after a successful swap ignored (REQ-SEC-9b266629, REQ-DATA-4d4471f9)
- 2026-11-02 build: green: focused suites (core plugins, shared, workbench service, desktop main + mocks) exit 0, 361 tests; typecheck exit 0; lint 0 errors. Spec bounds/issue values and REQ-SEC-9b266629 prose aligned with review round 1
- 2026-11-02 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-02 validate: review round 2: spec approved, quality approved. Accepted minors: sync zip inflate on main thread (bounded 64 MiB, as office.ts), JS toLowerCase vs Windows case folding, no swap-rollback test, install.json read via readFile (VERA-owned, schema-validated); the spec reviewer's last minor (BUSY not named) closed with one spec line after its verdict (doc-only). office.ts has the same stored-size zip pattern - pre-existing, out of scope, proposed as a follow-up
- 2026-11-02 validate: knowledge plugins.md created; workbench.md, ipc-boundary.md and context/project.md updated; environment.md unaffected; 00_Planning/plugins plan.md STATUS and architecture 2.1/6 synced with the code; no Manual/Inspection verifications
- 2026-11-02 validate: final: python .agentic/aegis.py check --task TASK-0cb6ef0f --strict --run exit 0; lint, typecheck, i18n ok (test not in [check] run); errors=0, warnings=54 are other tasks' journal headers, stale paths/ticket refs in older requirements, and uncovered-source flags on test files that are linked_tests here; full vitest after the last code edit: 1184 passed, 10 skipped, 1 failed - core tools/discovery.test.ts 'globs newest first' 5 s timeout under parallel load, untouched file, passes alone, recorded as pre-existing in TASK-581e6591
- 2026-11-02 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-01 | decision=Manifest platforms accept windows-x64, linux-x64 and linux-arm64 | reason=architecture 2.1, the spec #57 cites, defines platforms as a subset of the three; linux-arm64 only takes effect with a linux-arm64 build; rejecting it would invalidate catalog manifests that list it | source=repository | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-0cb6ef0f.md
changed: shared plugins schema + IPC, core PluginStore, workbench plugins.enabled, desktop main/mock, knowledge plugins.md, spec REQ-DATA-4d4471f9, 13 requirements, 00_Planning/plugins sync
evidence: check --task TASK-0cb6ef0f --strict --run exit 0 (errors=0); full vitest 1184 passed, 1 pre-existing load timeout in untouched discovery.test.ts
issues: pre-existing discovery.test.ts load timeout; office.ts shares the stored-size zip pattern (follow-up); staging leftovers after a crash are not cleaned
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-02)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-DATA-4d4471f9 - Validate plugin manifest format 1
  - REQ-FUNC-6dd00f25 - Install a plugin from a folder
  - REQ-FUNC-6db9dc8f - Install a plugin from a zip archive
  - REQ-FUNC-77843ccc - Refuse a plugin package with an invalid manifest
  - REQ-SEC-9b266629 - Refuse unsafe or oversized plugin packages
  - REQ-FUNC-deaa76d1 - Replace an installed plugin on reinstall
  - REQ-FUNC-f003e3e5 - List installed plugins with field-level issues
  - REQ-SEC-892a67e8 - Disable an installed plugin whose files changed
  - REQ-FUNC-1d6999a7 - Load only valid unchanged plugins
  - REQ-FUNC-9ba5f19c - Uninstall a plugin
  - REQ-FUNC-41f5c03b - Enable plugins per workbench
  - REQ-FUNC-0c4bc419 - Warn about unknown plugin names and keys
  - REQ-FUNC-9dd7413b - Expose plugin management over IPC
- deviations: 1 recorded
  - build: the browser-mock plugin test in mockApi.test.ts was written after the mock handlers and passed on first run, so it has no red line - the shared channel test was red first and the router type check enforces the main handlers; the mock is a test double, so the cost is low
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 8093499: 40 file(s) changed, 2084 line(s) added
- checks: errors=0 warnings=54 notes=3
- checklist: 8/9 done; open: `report` appended

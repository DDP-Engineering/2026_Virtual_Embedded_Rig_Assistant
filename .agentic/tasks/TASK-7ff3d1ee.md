# TASK-7ff3d1ee - PERF-10 Plugin program probes: parallel, cached, bounded (#258)

stage: done
type: change
path: full
interaction: autopilot
requirements: REQ-NFR-d5ad7a48, REQ-FUNC-295dafd1, REQ-FUNC-b34243de, REQ-REL-3691e000, REQ-FUNC-bb84b423
parent:
branch: feature/249-responsiveness
base: f69be9ff2f3d054a6739e775e614caf7157d38ee
opened: 2026-11-14

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [ ] knowledge pages of changed components current with the reviewed code
- [ ] project and environment context reconciled with the candidate
- [ ] requirements re-read: status, prose, verification, paths and links true
- [ ] manual or inspection verification recorded where applicable
- [ ] explicit review approved, when enabled
- [ ] final `check --strict --run` result logged truthfully after the last edit
- [ ] remaining warnings and pre-existing failures explained
- [ ] `report` appended

## Frame

Problem: OBSERVED (`provisioning.ts` `list`, line 541): a plugin's programs are inspected one after another; found
programs (`install: find`) are probed by starting the program on every in-memory cache miss, so every app start
probes again; `invalidate()` clears every plugin's entries; probes allow 30 s (120 s for launchers).
Desired outcome: STATED (#258 Goal): programs and plugins are probed concurrently with a small bound; a found program
is probed again only when its file changed; a hung probe affects only its own program, for a few seconds.
Actors: the Plugins panel and workbench plugin list (`plugins.programs`), session program resolution (`resolve`),
explicit Check again (`plugins.check`).
Primary scenario: app start with electronics/lab/IoT plugins enabled; the panel lists statuses after stat calls only.
Examples: STATED (#258 Tests): two programs with 200 ms fake probes list in ~200 ms; a second Provisioner on the same
cache file with an unchanged program starts no process, a touched file probes again; invalidating plugin A keeps
plugin B's entries; a probe that never exits times out after the found-probe timeout while others complete.
Counterexamples: VERA-installed programs (pip, script, download) keep returning the recorded version without a probe
(STATED, ticket). Check again always probes for real (STATED).
In scope: STATED (ticket plan 1-5): shared limiter of 4 concurrent probes; persisted JSON cache for found programs in
the runtime folder keyed by path and file identity; `invalidate(pluginId?)`; 8 s found-probe timeout, launcher
activation timeout kept; background warm-up after a workbench opens; one log line per status listing.
Out of scope: changing install flows or VERA-installed program handling (STATED, ticket). Persisting failures.
Constraints: STATED (coordinator): simple, Windows and Linux, no backward-compat, format version 1; child processes
killed on timeout (existing `killProcessTree`).
Success signals: targeted vitest and typecheck green; before/after timing of a probe pass on this host.
Evidence: OBSERVED provisioning.ts lines 76-78, 195, 251, 541; desktop `index.ts` `pluginsChanged()` line 333 calls
`provisioner.invalidate()` for promote/uninstall/toggle/catalogInstall; renderer issues one `plugins.programs` per
plugin in parallel (`plugins.tsx` 761, `workbench-plugins.tsx` 82).
Assumptions: INFERRED: a launcher program is probed only on cache miss once the persisted cache exists, so keeping the
120 s activation timeout for launchers only matches "first activation" (ticket step 4) without extra state.
Unknowns: Linux timing not measured natively here.
Decision-blocking questions: none.
Proposed behaviors: only successful versions are persisted; a failed probe removes the entry (not accepted beyond this
task's scope, serves "probed again only when its file changed").
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | shorter timeout, cached versions across starts |
| no new interface or data format | no | new `probes.json` cache file |
| no new dependency | yes | node:fs only |
| an existing requirement already covers the behavior | no | no caching/concurrency requirement |
| no security or data-handling change | yes | cache holds paths and versions only |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| concurrent inspection, 4 probes at a time, sorted result | REQ-NFR-d5ad7a48 |
| persisted found-program version reused while file unchanged; check probes | REQ-FUNC-295dafd1 |
| per-plugin invalidation | REQ-FUNC-b34243de |
| 8 s found-probe timeout, tree killed, others complete | REQ-REL-3691e000 |
| background status read after workbench create/open | REQ-FUNC-bb84b423 |

## Design

Skipped as a separate stage: one module changes plus two call sites. Shape:
- module-level `Limiter(4)` around the probe's `execute` only (installs keep their own serial queue);
- `probe()` gains `found`/`fresh`: found programs key `probes.json` entries by JSON of
  [executable, argv, version.match]; the stamp is `stat(..., {bigint})` dev:ino:size:mtimeNs; a hit returns the stored
  version; success writes, failure deletes; writes are serialized in-process and use temp file + rename, best effort;
- found non-launcher probes use 8 s, launchers keep 120 s (probed only on a cache miss), others keep 30 s;
- `invalidate(pluginId?)` deletes in-memory keys of that plugin id; generation still bumps;
- `list` verifies once, inspects with `Promise.all`, keeps name order; logs nothing in core, desktop logs per listing;
- desktop: `pluginsChanged(id)`, settings patches with `plugins` invalidate all, warm-up after workbench open/create.

## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-14 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-14 design: skipped; next build - small change; design recorded in journal
- 2026-11-14 build: red: vitest provisioning.test.ts -t 4 new cases exit 1 - serial list (431 ms), no persisted cache (2 probes), full invalidation, serial probe blocks timeout case (REQ-NFR-d5ad7a48, REQ-FUNC-295dafd1, REQ-FUNC-b34243de, REQ-REL-3691e000)
- 2026-11-14 build: green: vitest src/libraries/core/src/plugins/ + desktop provisioner-hosts + apps/cli exit 0 (251 passed); integration provisioning.test.ts exit 0; typecheck exit 0 (REQ-NFR-d5ad7a48, REQ-FUNC-295dafd1, REQ-FUNC-b34243de, REQ-REL-3691e000)
- 2026-11-14 build: inspection: desktop index.ts warmPrograms runs after workbench.create/open resolve, not awaited, errors ignored (REQ-FUNC-bb84b423)
- 2026-11-14 build: DEVIATION build: two existing find tests now touch the program file before expecting a re-probe after invalidate - the ticket makes unchanged found files reuse the stored version
- 2026-11-14 build: DEVIATION build: no per-listing debug log line in the status host; the opt-in probe-timing.test.ts measures instead - keeps main free of per-IPC log noise
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 1: (1) per-instance probes map lets the main provisioner undo a scoped check in probes.json; (2) launcher entries are stamped on the launcher file while the version follows eim select
- 2026-11-14 validate: returned to build - review round 1 findings: shared probes map per file; do not persist launchers
- 2026-11-14 build: green: round-1 fixes - vitest plugins+cli+provisioner-hosts exit 0 (252 passed), integration provisioning exit 0, typecheck exit 0 (REQ-FUNC-295dafd1)
- 2026-11-14 build: DEVIATION build: launcher programs are never stored, so they keep the 120 s activation probe on every start (in the background warm-up) instead of only the first activation - their version follows eim select, not the launcher file
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 2: both approved; minor: restart reuse is proven in-process only (shared map), on-disk content asserted; file parse path unchanged since round 1 timing
- 2026-11-14 validate: final: aegis check --task TASK-7ff3d1ee --strict --run exit 0; lint, typecheck, i18n ok; strict ok; 50 warnings repo-wide, none task-blocking; test suite not in [check] run list - focused vitest (252) and integration provisioning (3) ran green
- 2026-11-14 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-7ff3d1ee.md
changed: provisioning.ts, provisioning.test.ts, probe-timing.test.ts (new), desktop main index.ts, plugins.md, 5 requirements
evidence: aegis check --strict --run exit 0; vitest plugins+cli+provisioner-hosts 252 passed; integration provisioning 3 passed
issues: Linux not run natively; restart reuse proven in-process (shared map) plus on-disk assertion
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-14)

- stage: validate; type: change; path: full; branch: feature/249-responsiveness
- requirements:
  - REQ-NFR-d5ad7a48 - Probe plugin programs concurrently with a shared bound
  - REQ-FUNC-295dafd1 - Reuse a found program's probed version while its file is unchanged
  - REQ-FUNC-b34243de - Invalidate only the changed plugin's program resolutions
  - REQ-REL-3691e000 - Time out a found program's version probe after a few seconds
  - REQ-FUNC-bb84b423 - Warm plugin program statuses after a workbench opens
- deviations: 3 recorded
  - build: two existing find tests now touch the program file before expecting a re-probe after invalidate - the ticket makes unchanged found files reuse the stored version
  - build: no per-listing debug log line in the status host; the opt-in probe-timing.test.ts measures instead - keeps main free of per-IPC log noise
  - build: launcher programs are never stored, so they keep the 120 s activation probe on every start (in the background warm-up) instead of only the first activation - their version follows eim select, not the launcher file
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base f69be9f: 11 file(s) changed, 636 line(s) added
- checks: errors=0 warnings=50 notes=28
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

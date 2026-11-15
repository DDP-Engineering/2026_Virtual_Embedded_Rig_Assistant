# TASK-d4d70d39 - PLG-06 #267 Plugin status block and pack installation

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-492e89fb, REQ-UX-157f139c, REQ-UX-50e2dc6b, REQ-UX-5d984350, REQ-FUNC-0817ec80, REQ-UX-21440e02, REQ-REL-baf16878, REQ-UX-27a41e3d
parent:
branch: feature/261-plugin-management
base: cfae1fbe3e342274492cb050808145cf0a175156
opened: 2026-11-15

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

Problem: readiness is spread over the card header's dependency summary, the "Dependencies need attention"
line and the Needs configuration filter; packs exist in `packs.yaml` and the index but cannot be installed
from the UI (STATED ticket PLG-06 #267; OBSERVED `plugins.tsx` header `data-dependency-summary`,
`plugin-catalog.tsx` "pack definitions are not selection UI").
Desired outcome: each installed plugin card shows one status block with three checks - Dependencies,
Configuration, Use - each with its action; the block says Ready only when all three are green and otherwise
names the missing piece. A pack can be chosen with its groups (defaults from the index), reviewed once as a
whole, and installed with dependencies through the PLG-04 path (STATED ticket deliverables).
Actors: the engineer on the Plugins page.
Primary scenario: the engineer opens Install a pack, picks Arduino, keeps the default groups, reviews one
list (each plugin with its dependencies and risk, the plugins skipped and why), clicks Install, and sees the
PLG-04 install result block with each plugin's programs.
Examples: mqtt-tools without a stored broker credential, programs ready, enabled in the open workbench:
Dependencies ready, Configuration missing (broker-credential), Use enabled in <workbench> (STATED PLG-06-A).
Arduino defaults = arduino-cli, micropython, circuitpython, bus-tools, mqtt-tools, ble-tools plus their
required catalog plugins (OBSERVED `plugins/packs.yaml`; INFERRED required plugins from PLG-04 `installOrder`).
Counterexamples: Wokwi and Raspberry Pi Linux groups (default false) are not installed unless checked; a pack
plugin whose `platforms` lacks this host is listed as not available and is not installed (STATED PLG-06-C).
In scope: renderer status block replacing the header summary and attention line; Check / Install / Re-install
moved into the Dependencies check; Configure opens the PLG-05 Configuration section; Use shows the open
workbench and Open workbench (App opens the workbench editor, or the folder chooser when none is open); pack
chooser, one pack review from index data, install via the catalog review/install channels and PLG-04
provisioning; en/ro/de texts; focused tests; docs and records.
Out of scope: listing enablement across workbenches that are not open (`plugins.list` reports `enabled` for the
open workbench only - OBSERVED `pluginSummarySchema`); new IPC; core catalog changes; CLI; PLG-07/08 delivery.
Constraints: no backward compatibility, manifests `format: 1` (STATED user rules); reuse badges, actions and IPC
(STATED ticket); simple and stable on Windows and Linux; files LF.
Success signals: PLG-06-A..C covered by renderer tests; en/ro/de texts present (check:i18n); lint and
typecheck green; existing plugin page tests adjusted, not weakened.
Evidence: OBSERVED core `catalog.ts` review() removes the previous kept zip, so each pack plugin is downloaded,
verified and installed one at a time; the index entry carries risk, platforms, requires and dependencies
(`catalogEntrySchema`) so the pack review needs no download.
Assumptions: the index entry is an adequate review for a pack install because the zip is verified against the
entry's sha256 and its manifest id/version must match (OBSERVED `download()`), and `dependencies`/`risk` are
generated from the manifest by `vera catalog build` (OBSERVED PLG-04).
Unknowns: native Ubuntu not available here (Windows only; unit tests cover platform logic).
Decision-blocking questions: none - the ticket fixes the three checks, the one review and the reuse rule.
Proposed behaviors: (accepted by autopilot as the ticket's direct reading) a failure during a pack install stops
the run at that plugin and shows its error, keeping the plugins already installed (same as the PLG-04 queue);
a pack plugin that requires a skipped plugin is skipped too, named with its reason.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | status block and pack install are new UI |
| no new interface or data format | yes | no new IPC or schema |
| no new dependency | yes | none |
| an existing requirement already covers the behavior | no | new requirements needed |
| no security or data-handling change | no | pack install installs several reviewed catalog plugins after one review |

## Requirement coverage

| Behavior | Requirement | New/revised |
|---|---|---|
| one status block, three checks with actions, Ready only when all ready, else names the checks | REQ-UX-492e89fb | new |
| Dependencies check states (unavailable, missing, external, not checked, ready) | REQ-UX-157f139c | new |
| Use check names the open workbench; Open workbench opens the editor or the chooser | REQ-UX-50e2dc6b | new |
| Install a pack: packs and groups with defaults | REQ-UX-5d984350 | new |
| one pack review, install exactly those plugins, then their programs | REQ-FUNC-0817ec80 | new |
| unsupported, unknown or dependent-on-skipped pack plugins listed and left out | REQ-UX-21440e02 | new |
| a failure stops the pack install, keeps and provisions the earlier ones | REQ-REL-baf16878 | new |
| compact rows now carry the status block | REQ-UX-27a41e3d | revised (wording) |
| card names the needed parameter (now in the Configuration check) | REQ-UX-05e0ed17 | unchanged, still holds |

## Design

**Approach.** Two renderer components, no IPC or core change. `plugin-status.tsx` holds the pure
`dependencyCheck`, `configurationCheck`, `useCheck` functions and `PluginStatus`, rendered by `PluginCard` in
place of the header summary and the "Dependencies need attention" line; the Check / Install / Re-install
buttons move into its Dependencies row unchanged (same `data-action`s, same handlers) (REQ-UX-492e89fb,
REQ-UX-157f139c). `plugin-packs.tsx` holds the pure `packPlan(view, pack, groups, platform)` and the
`PackChooser` / `PackReview` panels. Rejected: reviewing each pack plugin through `plugins.catalogReview` before
the one review - core keeps only the latest reviewed zip (`catalog.ts` `download()` removes the folder), so the
one review is built from the index entries (risk, platforms, requires, dependencies), and Install then runs
review+install per plugin back to back (REQ-FUNC-0817ec80).
**Interfaces and data.** `PluginStatus` props: plugin, programs data/error, required-plugin ids missing,
configuration view (or undefined when no parameters), workbench, actions. Overall `data-plugin-status`
= ready | attention; the root keeps `data-readiness` = `programReadiness` so the library filter, REQ-UX-05e0ed17
and the existing tests keep their meaning. Each row `data-status-check` + `data-state`. `Plugins` gets an
optional `openWorkbench` prop; App passes one that closes Plugins and opens the editor of the active workbench,
or calls its own `openWorkbench` (folder chooser) when none is open (REQ-UX-50e2dc6b). Configure sets the card
expanded and focuses the Configuration wrapper. `packPlan` returns `{ install: {entry, requiredBy?}[],
installed: id[], skipped: {id, reason: platform|catalog|requires, detail?}[] }`, install order from PLG-04
`installOrder` (REQ-UX-21440e02). `reviewCatalog(ids, reviewed)` gains a flag: when the pack review was shown,
a required review installs at once instead of opening the single review screen; the first failure stops the
queue, shows the error, and `installPrograms` still provisions the plugins already installed (REQ-REL-baf16878 -
today the error path drops `run.current`; changed for the pack and PLG-04 runs alike).
**Files and test seams.** New `plugin-status.tsx`, `plugin-packs.tsx`, `plugin-packs.test.ts` (plan unit tests
and the pack flow on `Plugins` with the mock api); `plugins.tsx`, `App.tsx`, `styles.css`, locales en/ro/de;
`plugins.test.ts` status-block tests (PLG-06-A, external, Use, Configure).
**Risks.** Pack install skips the per-plugin review screen: acceptable because each zip is still verified against
the index sha256 and its manifest id/version, and the pack review lists risk and dependencies from the same
index. Only the open workbench's enablement is known (accepted limit).
**Requirement map.** REQ-UX-492e89fb, REQ-UX-157f139c: plugin-status.tsx. REQ-UX-50e2dc6b: plugin-status.tsx,
App.tsx. REQ-UX-5d984350, REQ-FUNC-0817ec80, REQ-UX-21440e02: plugin-packs.tsx, plugins.tsx. REQ-REL-baf16878:
plugins.tsx reviewCatalog. REQ-UX-27a41e3d: wording only.


## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-15 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-15 design: DEVIATION design: no diagrams - two renderer components and one App prop, no new interface or data format
- 2026-11-15 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-15 build: red: npmw run test plugin-packs/plugin-status/plugins.test.ts exit 1 - plugin-packs.js and plugin-status.js missing, no status block (REQ-UX-492e89fb, REQ-UX-157f139c, REQ-UX-50e2dc6b, REQ-UX-5d984350, REQ-FUNC-0817ec80, REQ-UX-21440e02, REQ-REL-baf16878)
- 2026-11-15 build: green: npmw run test renderer plugin*/workbench-plugins/workbench-config/mocks exit 0, 132 passed; typecheck exit 0; check:i18n ok (REQ-UX-492e89fb, REQ-UX-157f139c, REQ-UX-50e2dc6b, REQ-UX-5d984350, REQ-FUNC-0817ec80, REQ-UX-21440e02, REQ-REL-baf16878)
- 2026-11-15 build: green: VERA_TEST=1 npmw run test:e2e plugins-catalog/plugins-mock/plugins-ui exit 0, 6 passed (overflow check en/ro/de, themes, scales)
- 2026-11-15 build: review round 1: spec and quality reviewers approve; fixed check-failure text (Unavailable / error instead of Not checked); accepted: platform unknown before app.info skips no platform, a required plugin absent from the catalog is not flagged, role=status per card summary (as the old header), only the open workbench's enablement
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: final: aegis check --task TASK-d4d70d39 --strict --run exit 0; lint, typecheck, i18n ok, strict ok; 55 warnings: 4 uncovered-source on test files, the rest other tasks' records (journal-header, ticket-ref, stale-paths, no-linked-tests)
- 2026-11-15 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-d4d70d39.md
changed: new plugin-status.tsx, plugin-packs.tsx (+tests); plugins.tsx, App.tsx, plugin-catalog.tsx comment, styles.css, locales en/ro/de, plugin-library/plugins tests; 7 new reqs, REQ-UX-27a41e3d revised; knowledge plugins.md; plan plugin-management.md
evidence: aegis check --task TASK-d4d70d39 --strict --run exit 0; vitest renderer plugin set 132 passed; VERA_TEST=1 e2e plugins 6 passed
issues: native Ubuntu not verified; only the open workbench's enablement shown; a required plugin absent from the catalog is not flagged in the pack review; platform unknown before app.info skips no platform; not committed
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-15)

- stage: validate; type: feature; path: full; branch: feature/261-plugin-management
- requirements:
  - REQ-UX-492e89fb - Plugin status block with three checks
  - REQ-UX-157f139c - Dependencies check states on the status block
  - REQ-UX-50e2dc6b - Use check on the status block
  - REQ-UX-5d984350 - Choose a pack and its groups
  - REQ-FUNC-0817ec80 - Install a pack after one review
  - REQ-UX-21440e02 - Report pack plugins that cannot be installed
  - REQ-REL-baf16878 - Stop a pack install at the first failure
  - REQ-UX-27a41e3d - Compact plugin management with grouped controls
- deviations: 1 recorded
  - design: no diagrams - two renderer components and one App prop, no new interface or data format
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base cfae1fb: 24 file(s) changed, 1559 line(s) added
- checks: errors=0 warnings=55 notes=27
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

# TASK-f1dfd67e - PLG-03 #264 Plugin composition and operations on the plugin page

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-b065d2a4, REQ-UX-c49dc727, REQ-UX-b62eb1e0, REQ-FUNC-8af265ac
parent:
branch: feature/261-plugin-management
base: 454d7a3635856d68f63dd52afaafb0aa6949caac
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

Problem: STATED (ticket #264 "Problem"): the page lists programs, rules and documents, but not the skills the agent learns, the profiles and data the plugin ships, or its operations in plain words grouped by risk. OBSERVED: `Review` in renderer `plugins.tsx` lists `manifest.programs`, `manifest.rules` (flat, manifest order) and `manifest.docs`; the installed `PluginCard` shows program statuses only; `PluginInstalled` (shared `plugins.ts`) carries no programs, rules (only `irreversible`), docs, skills or files.
Desired outcome: STATED: a Composition section - programs and scripts (install kind, script path), skills (name and description from each `skills/*/SKILL.md` front matter), profiles and data files, documents; an Operations section from the manifest `rules`, each rule an operation with its risk and note, grouped safe / device-read / device-write / irreversible / blocked; both before install (reviewed package) and after install (installed package); the page and the approval prompt never disagree.
Actors: STATED: the desktop user reviewing or inspecting a plugin on the Plugins page.
Primary scenario: STATED (PLG-03-A): the user opens bus-tools (review or installed card) and sees its program `bus-tool` (script `scripts/bus_tool.py`), skills `bus-profiles` and `bus-transactions` with descriptions, three profiles, its documents and its operations by risk with notes.
Examples: STATED (PLG-03-B): analysis-skills shows its two skills and says it runs no programs. INFERRED: renode lists `profiles/*` and `testsets/*` as data files; git lists `no-hooks/*`.
Counterexamples: INFERRED: files under `skills/` and `scripts/` and `plugin.yaml` are not data files (premise: OBSERVED `plugins/CONTRIBUTING.md` line 12 puts skills under `<id>/skills/` and helper scripts under `<id>/scripts/`; every official script program lives in `scripts/`); a package-relative document is listed as a document, not a data file.
In scope: STATED: core `store.ts` (package files), shared `plugins.ts` (review and installed views), renderer `plugins.tsx`, en/ro/de texts, collapsed groups for large plugins, a test that the operations come from the rules the approval policy classifies with.
Out of scope: STATED: compatibility or migration code, a new manifest format or field. INFERRED: changing the approval prompt or `classifyCommand` (the ticket asks that the page follow the same rules, not that approvals change).
Constraints: STATED: pre-release; simple; reuse existing IPC/view types; Windows and Linux; targeted tests only; LF line endings.
Success signals: PLG-03-A..D; focused shared/core/renderer tests, lint, typecheck and i18n pass.
Evidence: OBSERVED: approval classifies with `classifyCommand(manifest.rules, ...)` (shared `program-rules.ts`) on the manifest `PluginStore.load` returns (core `program-request.ts`, `program-tools.ts`); `parseSkill(content, folder)` (core `skills/catalog.ts`) reads SKILL.md front matter `name` and `description`; the list runs in a worker (`plugin-list-worker.ts`) and all 37 official manifests total about 130 KB; `pluginRiskSchema.options` is ordered safe..blocked.
Assumptions: INFERRED: a SKILL.md whose front matter does not parse is still listed by folder name without a description (the skill catalog refuses it separately).
Unknowns: none blocking.
Decision-blocking questions: none.
Proposed behaviors: the installed view carries the manifest and a `composition` (skills, data files) for plugins without issues; the review carries `composition` whenever the manifest parses; operation groups are `<details>` collapsed by default with the risk label and count in the summary. Accepted under autopilot.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new page sections |
| no new interface or data format | no | new view fields on review and installed |
| no new dependency | yes | none added |
| an existing requirement already covers the behavior | no | none covers composition or grouped operations |
| no security or data-handling change | yes | display only; package files are already read for the integrity hash |

## Requirement coverage

| Behavior | Requirement | New/revised |
|---|---|---|
| review and installed views carry composition (skills, data files); installed view carries the manifest | REQ-DATA-b065d2a4 | new |
| Composition section: programs, skills, data files, documents; runs-no-programs line | REQ-UX-c49dc727 | new |
| Operations section: collapsed risk groups in risk order with notes | REQ-UX-b62eb1e0 | new |
| operations grouping built from the rules approvals classify with | REQ-FUNC-8af265ac | new |

## Design

**Approach.** Core reads each package's files already (integrity hash), so `PluginStore` derives a `composition`
from those files with one helper `pluginComposition(files, manifest)` and attaches it to the review (whenever the
manifest parses) and to the installed listing (no issues; with the manifest itself), REQ-DATA-b065d2a4. One renderer
component `PluginContents` renders Composition and Operations from `manifest` + `composition`; the Review replaces its
flat Programs/Rules/Documents lists with it, and the expanded installed card shows it (REQ-UX-c49dc727,
REQ-UX-b62eb1e0). Operations are grouped by a shared `pluginOperations(rules)`; the rules are the parsed manifest
`rules` that `PluginStore.load` gives the approval path for `classifyCommand` (REQ-FUNC-8af265ac). Rejected: a new
lazy `plugins.details` IPC channel (more wiring; all official manifests total about 130 KB, the list already runs in a
worker); copying programs/rules into a second view type (two copies of one fact).

**Interfaces and data.** Shared `plugins.ts`: `pluginCompositionSchema = { skills: {name, description?}[] (max PLUGIN_LIMITS.files),
files: string[] (max PLUGIN_LIMITS.files) }`; `pluginReviewSchema.composition?`; `pluginInstalledSchema.manifest?` and
`.composition?`; `pluginOperations(rules)` returns `{ risk, rules }[]` for each risk with rules in
`pluginRiskSchema.options` order, rules in manifest order. Core `store.ts`: skills = each `skills/<name>/SKILL.md`,
description from core `parseSkill` (front matter error: name only); files = every path not `plugin.yaml`, not under
`skills/` or `scripts/` and not a package-relative doc, path order. Scoped (workbench) summaries reuse the review, so
they carry the same fields. Renderer: groups are `<details>` without `open` (collapsed), summary
`<risk label> <count>`; composition parts are plain lists. New texts `plugins.composition.*`,
`plugins.operations.*` in en/ro/de; risk labels reuse `approval.risk.*`.

**Files and test seams.** shared `plugins.ts` + `plugins.test.ts` (pluginOperations order/grouping); core
`plugins/store.ts` + `store.test.ts` (composition of review and list, issue case) and a core test on the official
bus-tools package with `classifyCommand` (REQ-FUNC-8af265ac); renderer new `plugin-contents.tsx`, `plugins.tsx`,
locales, `plugins.test.ts` (bus-tools review and installed card, analysis-skills, no-rules line); renderer mocks
updated in place.

**Risks and open decisions.** List payload grows by the manifests (about 130 KB for 37 plugins): accepted, display
only. No security change: no file content beyond SKILL.md front matter is read or exposed (paths only).

**Requirement map.** REQ-DATA-b065d2a4: `pluginComposition` in review/summary. REQ-UX-c49dc727: Composition part of
`PluginContents`. REQ-UX-b62eb1e0: Operations part with collapsed `<details>`. REQ-FUNC-8af265ac: `pluginOperations`
over the loaded manifest rules, tested against `classifyCommand`.

## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-15 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-15 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-15 build: DEVIATION design: no structure/sequence/state diagrams drawn - two view fields and one display component; the Approach paragraph states the flow, a diagram adds no review value
- 2026-11-15 build: red: vitest run shared plugins.test.ts + core store.test.ts exit 1 - pluginOperations missing; review/list carry no composition or manifest (REQ-DATA-b065d2a4, REQ-FUNC-8af265ac)
- 2026-11-15 build: green: vitest run shared plugins.test.ts + core store.test.ts + scoped-store.test.ts exit 0, 35 passed (REQ-DATA-b065d2a4, REQ-FUNC-8af265ac)
- 2026-11-15 build: DEVIATION build: renderer tests for PluginContents were written after the component, so no red run was observed for REQ-UX-c49dc727/REQ-UX-b62eb1e0 - the assertions target data attributes that did not exist before (data-skill, data-file, data-operations, data-no-programs), so they could not pass on the base
- 2026-11-15 build: green: vitest run renderer plugins.test.ts exit 0, 29 passed (REQ-UX-c49dc727, REQ-UX-b62eb1e0)
- 2026-11-15 build: green: lint exit 0 (0 errors, warnings pre-existing), typecheck exit 0, check:i18n exit 0; vitest renderer plugin*/workbench-plugins/permission-picker + core catalog* + shared src + main plugin-list* exit 0, 40 files 313 passed; integration analysis-skills, bus-tools, plugin-builder exit 0, 33 passed/1 skipped; VERA_TEST=1 test:e2e plugins-ui.spec.ts + plugins-mock.spec.ts exit 0, 5 passed (REQ-DATA-b065d2a4, REQ-UX-c49dc727, REQ-UX-b62eb1e0, REQ-FUNC-8af265ac)
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: knowledge plugins.md (desktop UI, shared interface, summaries, requirements, files) and 00_Planning/plan/plugin-management.md (PLG-03 implemented) updated; project/environment context unaffected (no new command, dependency or setup)
- 2026-11-15 validate: review round 1: spec approved, quality approved. Accepted limits: a skill folder name over 255 characters without parsable front matter would fail the review/list schema (OS file names are capped at 255; zip-only edge); composition lists are not collapsed (official plugins have at most a few data files); the post-check Programs status list keeps its older no-programs text; duplicate manifest.docs entries give a duplicate React key; every plugins.list item carries its manifest (about 130 KB for 37 plugins); the renderer bus-tools fixture is hand-written, the real package is covered by the core test. Design text aligned with the code (skills max PLUGIN_LIMITS.files; summary label + count).
- 2026-11-15 validate: final: python .agentic/aegis.py check --task TASK-f1dfd67e --strict --run exit 0; lint ok, typecheck ok, i18n ok; strict ok. Remaining: uncovered-source warnings for the three edited test files (tests, not behaviors of their own); other warnings belong to other tasks' requirements and journals (pre-existing); known pre-existing failures cli.test.ts x3 and workspace.test.ts 'Settings selects one page' not touched or run
- 2026-11-15 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-f1dfd67e.md
changed: shared plugins.ts; core plugins/store.ts; renderer plugin-contents.tsx (new), plugins.tsx, locales en/ro/de; tests shared/core/renderer + e2e plugins-ui.spec.ts; 4 requirements; knowledge plugins.md; plan plugin-management.md
evidence: aegis check --task TASK-f1dfd67e --strict --run exit 0
issues: accepted limits in review round 1 log line; pre-existing cli.test.ts x3 and workspace.test.ts Settings failures out of scope
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-15)

- stage: validate; type: feature; path: full; branch: feature/261-plugin-management
- requirements:
  - REQ-DATA-b065d2a4 - Review and installed views carry the package composition
  - REQ-UX-c49dc727 - Composition section on the plugin page
  - REQ-UX-b62eb1e0 - Operations section grouped by risk on the plugin page
  - REQ-FUNC-8af265ac - Plugin page operations come from the rules approvals classify with
- deviations: 2 recorded
  - design: no structure/sequence/state diagrams drawn - two view fields and one display component; the Approach paragraph states the flow, a diagram adds no review value
  - build: renderer tests for PluginContents were written after the component, so no red run was observed for REQ-UX-c49dc727/REQ-UX-b62eb1e0 - the assertions target data attributes that did not exist before (data-skill, data-file, data-operations, data-no-programs), so they could not pass on the base
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base 454d7a3: 18 file(s) changed, 741 line(s) added
- checks: errors=0 warnings=54 notes=27
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

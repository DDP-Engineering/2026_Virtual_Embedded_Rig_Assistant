# TASK-af7d3564 - Filter plugins by requirements in the Plugins library

stage: done
type: feature
interaction: autopilot
requirements: REQ-UX-97df79a8, REQ-UX-8a9de6eb, REQ-DATA-d10bb593
parent:
branch: master
base: 58e21f311a0212837c0c0ce741f2c1d15d5658de
opened: 2026-11-25

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

Problem: The Plugins library cannot be narrowed by what a plugin needs to run: whether it is only skills, runs a Python script, needs an external program, or needs configuration (STATED, user 2026-11-25).
Desired outcome: A Requirements filter in the library controls with five combinable checkboxes - Skills only, Python script, Program VERA downloads, Program you install, Settings - and matching badges on each plugin card (STATED: user accepted the proposal "Yes, implement it").
Actors: The Desktop user in the Plugins library; `vera catalog build`, which writes the catalog index.
Primary scenario: The user checks "Program you install" and "Settings" and sees only plugins with both, such as gdb-debug and zephyr.
Examples: Skills only lists 7 bundled plugins (analysis-skills, motor-drives...); Python script lists 26 with a script and 4 with a pip package (OBSERVED, classification of 05_Software/plugins/*/plugin.yaml).
Counterexamples: An installed plugin whose manifest does not load has unknown requirements and matches no selected requirement; with no requirement checked every plugin matches.
In scope: Requirement derivation in shared from program install kinds (`pluginProgramKind`) and settings/credentials; optional `configurable: true` in catalog entries built by `vera catalog build`; library state, filter, Clear filters; card badges on catalog and installed cards; translations en/ro/de/fr; help; requirements; knowledge; CHANGELOG and release notes.
Out of scope: Reinstalling stale installed plugins and the skills-only dependency readiness label (separate findings, not requested now); pack cards.
Constraints: Branch master (STATED earlier "pe acelasi branch"); a catalog published before this change has no `configurable` and stays valid (optional field, like `external`); UI rules: no helper texts, filters on the left (memory).
Success signals: Unit tests for derivation, filtering (AND), Clear filters and catalog build output; component test for the checkboxes and badges.
Evidence: `pluginDependencies`, `pluginProgramKind` (shared plugins.ts); `catalogEntrySchema` has `dependencies` but no settings flag (plugin-catalog.ts); `installedLibraryItems` has `plugin.manifest` (plugin-library.ts) (all OBSERVED).
Assumptions: Settings means declared `settings` or any program `credentials` (INFERRED from the user's "necesita si configurare").
Unknowns: None blocking.
Decision-blocking questions: None.
Proposed behaviors: As Desired outcome, accepted.

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Verification | Design decision or no impact |
|---|---|---|---|---|
| Filter | Checked requirements AND-filter the library; unknown matches none | REQ-UX-97df79a8 | plugin-library.test.ts; controls test | Shared `pluginRequirements` from dependencies + configurable; `LibraryItem.requirements` undefined when unknown; `LibraryState.requirements` array cleared by Clear filters |
| Badges | Cards show one badge per requirement | REQ-UX-8a9de6eb | plugin card component test | `PluginRequirementBadges` reused by catalog and installed cards |
| Catalog data | Build sets configurable for settings/credentials | REQ-DATA-d10bb593 | catalog-source test | `configurable: z.literal(true).optional()` in `catalogEntrySchema` |

## Design

Skipped as a separate note: the design is the coverage table's last column.


## Log

- 2026-11-25 frame: journal opened
- 2026-11-25 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-25 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-25 design: skipped; next build - design in coverage table
- 2026-11-25 build: red: shared plugins.test.ts (pluginRequirements missing), root vitest catalog-source.test.ts (configurable absent), desktop plugin-library.test.ts (no requirement filter) all exit 1 (REQ-UX-97df79a8, REQ-UX-8a9de6eb, REQ-DATA-d10bb593)
- 2026-11-25 build: green: shared plugins.test.ts 15 passed; root vitest catalog-source.test.ts 16 passed; desktop plugin tests 102 passed; typecheck, lint, i18n clean (REQ-UX-97df79a8, REQ-UX-8a9de6eb, REQ-DATA-d10bb593)
- 2026-11-25 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-25 validate: review round 1: spec changes_required (test gaps: installed card badges, unloaded-manifest exclusion, skills-only exact badges, index without configurable parses); quality approved with notes (weak ids assertion, untested comment); no production defects
- 2026-11-25 validate: returned to build - review round 1 test gaps
- 2026-11-25 build: green: plugin-library.test.ts 14 passed (installed card badges, unloaded-manifest exclusion, exact skills-only badges, precise ids); plugin-catalog.test.ts 8 passed (configurable optional, only true); typecheck clean
- 2026-11-25 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-25 validate: DEVIATION validate: post-review CSS edit at the user's request - Requirements rows made compact and their selector given element specificity because '.library-side .plugin-library-controls label' (same specificity, later) stacked each checkbox above its text; styles only, no behavior judged by the reviewers changed; lint clean, visual check left to the user
- 2026-11-25 validate: final: python .agentic/aegis.py check --task TASK-af7d3564 --strict --run exit 0; lint, typecheck, i18n, help ran; remaining warnings pre-existing
- 2026-11-25 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-25 | decision=Requirements filter with five AND-combined checkboxes (Skills only, Python script, Program VERA downloads, Program you install, Settings), card badges, optional configurable flag in catalog entries | reason=User accepted the proposal 2026-11-25 ('Yes, implement it') | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-af7d3564.md
changed: Review round 1 test gaps filled
evidence: check --task TASK-af7d3564 --strict --run exit 0; shared 15, catalog-source 16, plugin-catalog 8, plugin-library 14, desktop plugin suite passed
issues: Visual check of the compact checkbox rows pending in the running app
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-25)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-UX-97df79a8 - Filter the plugin library by requirements
  - REQ-UX-8a9de6eb - Show requirement badges on plugin cards
  - REQ-DATA-d10bb593 - Mark configurable plugins in the catalog index
- deviations: 1 recorded
  - validate: post-review CSS edit at the user's request - Requirements rows made compact and their selector given element specificity because '.library-side .plugin-library-controls label' (same specificity, later) stacked each checkbox above its text; styles only, no behavior judged by the reviewers changed; lint clean, visual check left to the user
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 58e21f3: 27 file(s) changed, 495 line(s) added
- checks: errors=0 warnings=50 notes=44
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

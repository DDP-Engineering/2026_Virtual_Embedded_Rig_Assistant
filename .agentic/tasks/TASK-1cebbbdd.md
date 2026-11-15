# TASK-1cebbbdd - PLG-01 #262 Pre-release maturity from the plugin version

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-2b59c9cc, REQ-UX-4ef3aa51, REQ-UX-3cf252d5, REQ-DATA-6351c39b, REQ-SEC-69f9d44d
parent:
branch: feature/261-plugin-management
base: 0b420132646b46ee152b632c49bea4674c027a69
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

Problem: OBSERVED: all 37 official manifests (`05_Software/plugins/*/plugin.yaml`) declare `version: 1.0.0`, so tested and untested plugins look the same on the catalog card, the review screen and the installed list (STATED, ticket #262 "Problem"). The ticket says 30 plugins; the code has 37 (OBSERVED `ls plugins/*/plugin.yaml`), and the code decides (STATED, plan page).
Desired outcome: STATED: a shared `pluginMaturity(version)` returns `pre-release` for `0.x.y` or any semver pre-release tag and `stable` otherwise, never `stable` for an invalid version; a Pre-release badge beside the version on the catalog card, in the review dialog and in the installed list; a library filter Pre-release / Stable; texts in en/ro/de; every official version set from its evidence, with a per-plugin table in `00_Planning`.
Actors: STATED: the desktop user browsing the Plugins library; the maintainer setting versions.
Primary scenario: the user opens Plugins, sees `0.2.0 Pre-release` on arduino-cli and `1.0.0` without a badge on ltspice, filters by Stable and sees only ltspice.
Examples: STATED (PLG-01-A): `0.4.0` and `1.0.0-beta.1` are pre-release; `1.0.0` and `2.3.1` are stable; an invalid version (e.g. `1.0`, `x`, missing) is not stable.
Counterexamples: `1.0.0+build.5` is stable (build metadata is not a pre-release tag; INFERRED from semver 2.0 and the existing `compareVersions`, which ignores build metadata).
In scope: STATED: shared helper; badge on card, review and installed list; library filter; en/ro/de texts; official versions and the evidence table; a focused test that a lowered plugin reinstalls while the update path still refuses the downgrade (PLG-01-D).
Out of scope: STATED: a new manifest field; compatibility or migration code; changing the downgrade refusal; release channels (PLG-07 #268).
Constraints: STATED: pre-release software - manifests stay `format: 1`, no migrations, test machines uninstall and reinstall; Windows and Linux; keep it simple; targeted tests only; LF line endings.
Success signals: PLG-01-A...D hold; `vera catalog check` passes on `05_Software/plugins`; the focused unit/component/integration tests, lint, typecheck and i18n check pass.
Evidence: OBSERVED: shared `plugins.ts` already validates versions with a semver regex; shared `plugin-catalog.ts` has `compareVersions`; core `catalog.ts` `refuseDowngrade` throws CONFLICT `downgrade`; renderer shows versions in `plugin-catalog.tsx` CatalogItem, `plugins.tsx` review facts and installed card header; `plugin-library.ts` holds the filter state. Evidence levels come from `00_Planning/plan/arduino-iot-acceptance.md`, `embedded-lab-acceptance.md`, `electronics-plugins.md`, `00_Planning/plugins/plan.md` and `.agentic/knowledge/official-plugins.md`: no plugin has a native-Ubuntu run; ltspice is Windows-only by scope with "Open: none on Windows".
Assumptions: INFERRED: a Windows-only plugin with all Windows proofs meets the 1.0.0 bar, because the native-Ubuntu half does not apply to its declared platforms (premise: ticket rule plus ltspice `platforms: [windows-x64]`).
Unknowns: whether the coordinator prefers ltspice at 0.3.0 for uniformity (recorded as a decision in the report, trivial to change).
Decision-blocking questions: none.
Proposed behaviors: evidence levels 0.1.0 (offline evidence only: the real tool has not run), 0.2.0 (real tool on Windows; real hardware or cloud open), 0.3.0 (all Windows proofs, no hardware needed; native Ubuntu open), 1.0.0 (every proof on every declared platform). A missing or invalid version filters and badges as pre-release. Accepted under autopilot.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | badge and filter are new UI |
| no new interface or data format | no | new shared helper export |
| no new dependency | yes | none added |
| an existing requirement already covers the behavior | no | no maturity requirement exists |
| no security or data-handling change | yes | display only |

## Requirement coverage

| Behavior | Requirement | New/revised |
|---|---|---|
| maturity from the version (valid, pre-release tag, 0.x, invalid) | REQ-DATA-2b59c9cc | new |
| Pre-release badge on card, review and installed card | REQ-UX-4ef3aa51 | new |
| library maturity filter, with Clear | REQ-UX-3cf252d5 | new |
| official versions from the evidence table | REQ-DATA-6351c39b | new |
| catalog downgrade refusal stays; reinstall after uninstall works | REQ-SEC-69f9d44d | verification extended |

## Design

**Approach.** One pure helper `pluginMaturity(version?: string)` in shared `plugins.ts`, beside the manifest semver
regex it reuses (REQ-DATA-2b59c9cc: one source, no manifest field). The renderer calls it in three places through
one small `MaturityBadge` component exported from `plugin-library-controls.tsx` (REQ-UX-4ef3aa51), and the library
filter adds a `maturity` field to `LibraryState` (REQ-UX-3cf252d5). Versions in the 37 manifests are edited in place
(REQ-DATA-6351c39b); no code path reads an old version. Rejected: a third `unknown` maturity - an invalid version can
never reach a valid manifest, so `pre-release` is the conservative answer and keeps the filter binary.

**Interfaces and data.** `export type PluginMaturity = "pre-release" | "stable"`; undefined, empty or non-semver input
is `pre-release`; build metadata is ignored. `LibraryItem.version?: string` (catalog entry version, or the installed
summary version); `LibraryState.maturity: "" | PluginMaturity`, default `""`; a shared `clearedLibraryFilters` patch
used by both Clear buttons resets it. The badge renders nothing for stable. Texts `plugins.maturity.preRelease`,
`plugins.library.maturity`, `plugins.library.allMaturities`, `plugins.library.stable` in en/ro/de.

**Files and test seams.** shared `plugins.ts` + `plugins.test.ts` (A); renderer `plugin-library.ts`,
`plugin-library-controls.tsx`, `plugin-catalog.tsx`, `plugins.tsx`, locales; tests `plugin-library.test.ts`,
`plugin-catalog.test.ts`, `plugins.test.ts` (B); `05_Software/plugins/*/plugin.yaml`, the evidence table in
`00_Planning/plan/plugin-management.md`, `vera catalog check` (C); core `catalog.test.ts` downgrade case extended with
uninstall + reinstall of the lowered version (D). Tests that hard-code an official plugin's `1.0.0` (release zip names,
manifest asserts) are updated to the new versions.

**Risks and open decisions.** Installed copies at 1.0.0 meet the downgrade refusal; by the pre-release rule test
machines uninstall and reinstall (no migration). ltspice stays 1.0.0 (Windows-only by scope, nothing open) - flagged
for the coordinator.

**Requirement map.** REQ-DATA-2b59c9cc helper; REQ-UX-4ef3aa51 badge; REQ-UX-3cf252d5 filter; REQ-DATA-6351c39b
manifests + table; REQ-SEC-69f9d44d no code change, test extended.


## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-14 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-14 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-14 build: red: npmw.py npx vitest run shared plugins.test.ts, renderer plugin-catalog.test.ts, plugin-library.test.ts exit 1 - pluginMaturity missing, no maturity badge, no maturity filter (REQ-DATA-2b59c9cc, REQ-UX-4ef3aa51, REQ-UX-3cf252d5)
- 2026-11-14 build: green: npmw.py npx vitest run shared plugins.test.ts + renderer plugin-catalog, plugin-library, plugins, workbench-plugins, plugin-library-controls tests exit 0, 78 passed (REQ-DATA-2b59c9cc, REQ-UX-4ef3aa51, REQ-UX-3cf252d5)
- 2026-11-14 build: green: inspection - 37 manifest versions equal the evidence table in 00_Planning/plan/plugin-management.md (script compare, 0 mismatches); npmw.py run vera -- catalog check --source plugins exit 0 (REQ-DATA-6351c39b)
- 2026-11-14 build: green: npmw.py npx vitest run core plugins/catalog.test.ts exit 0, 10 passed - lowered plugin refused as update (review and install CONFLICT downgrade, update false), installs after uninstall (REQ-SEC-69f9d44d)
- 2026-11-15 build: DEVIATION build: helper programs' VERSION constants were first kept at 1.0.0; REQ-FUNC-5ddc54a6 and serial-monitor's test bind --version to the manifest version, so all 27 bundled helpers now follow their plugin version - corrected in build after review round 1, verdicts re-reviewed
- 2026-11-15 build: green: npmw.py npx vitest run 30 integration files (version-affected) - 647 passed, 114 skipped (opt-in real tools), then kicad-layout + lab-validation --version literal fix rerun exit 0 (41 passed); remaining: 3 pre-existing cli.test.ts failures (9-plugin count, CLI index exit 1; recorded pre-existing in TASK-43e9ee14). Unit/packaging set 62 files: 693 passed, 1 pre-existing unrelated workspace.test.ts Settings-tabs failure
- 2026-11-15 build: DEVIATION validate: diagrams not drawn for this small display-only design - lean ticket scope; the design note covers the flow
- 2026-11-15 build: final: python .agentic/aegis.py check --task TASK-1cebbbdd --strict --run exit 0 (strict ok; lint, typecheck, i18n ok; errors 0, warnings 55 - other journals' legacy ruling format and uncovered-source notes on test files, not limiting this candidate)
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-1cebbbdd.md
changed: shared pluginMaturity; renderer badge + maturity filter + en/ro/de; 37 manifest versions + 27 helper VERSION constants; evidence table in 00_Planning/plan/plugin-management.md; catalog downgrade/reinstall test; version literals in tests; knowledge/project pages
evidence: check --task TASK-1cebbbdd --strict --run exit 0
issues: pre-existing: cli.test.ts 3 failures, workspace.test.ts Settings tabs; native Ubuntu not run; ltspice 1.0.0 inferred
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-15)

- stage: build; type: feature; path: full; branch: feature/261-plugin-management
- requirements:
  - REQ-DATA-2b59c9cc - Derive plugin maturity from the version
  - REQ-UX-4ef3aa51 - Show a pre-release badge beside the plugin version
  - REQ-UX-3cf252d5 - Filter the plugin library by maturity
  - REQ-DATA-6351c39b - Set each official plugin version from its evidence
  - REQ-SEC-69f9d44d - Refuse a catalog downgrade
- deviations: 2 recorded
  - build: helper programs' VERSION constants were first kept at 1.0.0; REQ-FUNC-5ddc54a6 and serial-monitor's test bind --version to the manifest version, so all 27 bundled helpers now follow their plugin version - corrected in build after review round 1, verdicts re-reviewed
  - validate: diagrams not drawn for this small display-only design - lean ticket scope; the design note covers the flow
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 0b42013: 113 file(s) changed, 652 line(s) added
- checks: errors=0 warnings=55 notes=27
- checklist: 0/6 done; open: each automated increment has a red line before its implementation and a green line after; each manual one a logged observation; anchor recorded before implementation; evolution reviewed after; focused tests green, with the command and its scope logged; `affected_paths`, `linked_tests` and `status = "active"` current on every requirement, or `retired` with its reason; affected docstrings, usage examples and setup instructions updated; `check` clean, or each remaining warning explained in the Log

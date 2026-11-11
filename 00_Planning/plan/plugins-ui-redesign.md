# Plugins UI redesign — implementation work packages

Date: 2026-11-11. Status: planned; no product implementation in this planning task.

Specification: [catalog discovery and workbench activation](../plugins/ui-redesign.md).
Interactive reference: [plugins-redesign.html](../ui/plugins-redesign.html).
This is follow-up work to implemented PLG-01/05/06/07/13, not a reopening of those original tickets.

## Umbrella and execution order

Use one Gitea umbrella and three implementation tickets. Metadata publishing/validation, library UI,
and the workbench draft/navigation integration have different contracts and meaningful focused
acceptance boundaries; treating all of them as one small agent session would be an optimistic scope.
User execution instruction (2026-11-11): implement **PLG-23 → PLG-24 → PLG-25** sequentially on the
single branch `ddp/plugins-discovery-ui`, created from fetched `origin/master` at `5aa0234` in the
shared checkout. This explicit instruction overrides the general master-branch rule for these
three tickets. Keep one validated local commit per ticket. Each child
follows AEGIS only when implementation starts, and the repository's existing coordinator/commit and
verification policy applies. Creating this plan and these issues creates no AEGIS task or journal.

The umbrella closes after all children and integrated acceptance are complete. Creating issues does
not start an implementation chat, apply agent-ready labels, change risk policy or publish code.
Tracking: umbrella [#85](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/85),
with PLG-23 [#86](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/86),
PLG-24 [#87](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/87) and
PLG-25 [#88](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/88).

## PLG-23 Catalog discovery metadata and publishing

**Goal:** supply real activity/search/date data for scalable catalog discovery.
**Depends on:** implemented PLG-07. **Spec:** ui-redesign.md §3–4, §8.

Scope:
- Extend maintainers' `catalog.yaml` by plugin-id discovery metadata: bounded unique activities,
  bounded keywords, optional factual `addedAt`/`updatedAt` calendar dates, with stable activity ids
  for communication/flash/build/debug/firmware-analysis/measurement/security/version-control/testing.
- Carry the metadata through shared validation, catalog source checking/building, desktop catalog
  view, CLI output, mocks and bundled catalog generation. Keep existing identity/hash/tier behavior.
- Define and validate true calendar days; reject invalid values and unknown plugin references.
  Unknown dates stay absent; no timestamp inferred from build/cache/install/file times.
- Update real source metadata and fixtures together at format 1. Do not add prototype-only plugins
  or invented publication dates; do not add migrations or increment any schema version.

Likely entry points: `05_Software/src/libraries/shared/src/plugin-catalog.ts`,
`core/src/plugins/catalog-source.ts`, `core/src/plugins/catalog.ts`, catalog CLI consumers,
`05_Software/plugins/catalog.yaml`, preparation/packaging and catalog mocks/tests.

**Done when:** source → deterministic release → validated bundled/remote catalog → client/CLI view
preserves the same discovery data; malformed metadata and dangling ids are rejected; genuinely
unknown dates are valid; existing tier/hash/dependency checks still hold. Focused shared/core/CLI
tests and the affected preparation checks pass, as do relevant lint/typecheck/i18n, strict checks
and both independent reviews. Record the exact proof; no full-suite or remote publishing step.

## PLG-24 Searchable Available/Installed plugin library

**Goal:** replace the duplicate packs/catalog presentation with one scalable list per tab.
**Depends on:** PLG-23. **Spec:** ui-redesign.md §2–5, §7–8.

Scope:
- Sidebar Plugins destination; Available and Installed tabs with source-aware rows and total counts.
  Initially open Available, sort Recently added, and show 6 rows/page as in the HTML.
- First management area, before the tabs/list: separate Install from folder…, Install from ZIP…,
  Check all dependencies, Refresh list, Check for updates, and Catalog settings (URL/source/Save/
  Use default, optionally collapsed). Preserve native selectors/review, progress and partial failures;
  checking does not provision programs. Never replace these with an incomplete list-only design.
- Case/diacritic-insensitive all-words search; combined ecosystem/activity/provenance/state filters;
  known-date sorts with undated entries last; new means first catalog publication in the last
  30 UTC calendar days; counts, Clear filters, 6/12/24 page size and page reset/clamping.
- Preserve tab/filter state during in-session navigation, keeping workbench filters separate.
- Remove checkable pack groups/Install selected from the primary UI while retaining pack data.
- Explicit installed/readiness/update states; keep catalog source/offline/error notices and all
  review, dependency ordering, configuration/manual vendor setup, uninstall, trial/scoped review,
  promotion and export capabilities. Only uncommon per-plugin actions move into details/menus;
  global management controls remain above the list.
- No activation toggle, Configure workbench button or per-row activation shortcut on this page.
  Workbench activation is reached from existing Workbench settings → Plugins.
- Update en/ro/de and follow current component/theme/text-size/keyboard patterns, not prototype CSS.

Likely entry points: desktop `components/plugins.tsx`, `plugin-catalog.tsx`, renderer models/helpers,
styles/locales, mocks, their component tests and focused catalog/plugins E2E coverage.

**Done when:** at least 30 deterministic entries prove search, all filter combinations/counts,
chronology/ties/unknown dates, pagination after mutations, empty/error/offline states and local/trial
visibility. Install/configure/update remain distinct and never enable a plugin or execute hardware
commands. Existing review/action paths are reachable and cancellation/failure refresh correctly.
Relevant component/E2E/static/strict checks and both independent reviews pass. Reuse unchanged
backend/risk proof instead of rerunning complete suites.

Explicit regression acceptance also covers both top import buttons reaching native selection and
review, Check all dependencies reporting mixed results without provisioning or enablement, Refresh
retaining filters, and catalog settings preceding the tabbed list at supported window sizes.

## PLG-25 Explicit workbench activation and integrated acceptance

**Goal:** make installation, program readiness and per-project activation distinct across the flow.
**Depends on:** PLG-24 and existing workbench editor/PLG-13 source resolution.
**Spec:** ui-redesign.md §2, §5–8.

Scope:
- Use the current workbench's existing settings/editor Plugins section. The global Plugins page
  has no Configure workbench button. The workbench section has no workbench selector and no Add
  plugins or Browse catalog button; global discovery remains on the separate Plugins page.
- Reuse its draft and Save/Cancel semantics. Display project name, selection count, unsaved state,
  readiness and scoped/trial/invalid/unresolved diagnostics. Existing read-only restrictions hold.
- Put Save/Cancel at the beginning of the page above the search/filters/list.
  Save activates only when the draft differs from saved state and deactivates after Save/Cancel or
  reverting the changes. No footer-only save controls and no scroll-to-bottom requirement.
- Search/filter installed entries without losing hidden draft selections. Save changes only the
  selected workbench, Cancel restores it, and navigation cannot silently lose draft changes.
- Refresh after installation/configuration while preserving the still-valid draft. Do not introduce
  a second enablement API/store, automatic enabling, relaxed trust checks or SDK auto-installation.
- Complete focused integrated acceptance for catalog → review → installed/readiness → workbench
  Save/Cancel, including a second workbench and restart persistence of the saved selection.

Likely entry points: `components/workbench-plugins.tsx`, existing workbench form/editor/navigation,
Plugins navigation integration, locales/mocks and focused workbench/plugins E2E tests.

**Done when:** installing in the catalog changes neither workbench's enabled list; selecting and
saving for one changes only that workbench and survives restart; top Save activation/deactivation,
absence of a workbench selector/Add plugins button, cancel, hidden selections, leaving
with a dirty draft, read-only and untrusted/scoped cases work correctly. Keyboard/focus and relevant
en/ro/de/light/dark/text-size/window checks pass, along with focused tests, static/strict checks and
both independent reviews. This child owns final integrated acceptance; reuse PLG-23/24 proof for
unchanged parts and do not schedule another full-suite gate for the umbrella.

## Tracking

| Role | Issue | Depends on | State on 2026-11-11 |
|---|---|---|---|
| Umbrella | [#85 — Plugins UI redesign](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/85) | PLG-23…PLG-25 | Open; planning only |
| PLG-23 — discovery metadata/publishing | [#86](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/86) | Implemented PLG-07 #63 | Open |
| PLG-24 — global Plugins library | [#87](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/87) | #86 | Open |
| PLG-25 — workbench settings and acceptance | [#88](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/88) | #87 | Open |

The umbrella checklist links all children; each child links its parent and predecessor. Milestone:
Plugins - platform. Labels: enhancement/P2 plus epic or work-package; no agent-ready/working labels.

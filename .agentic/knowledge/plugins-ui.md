# Plugins page and Runs tab

## Routing

Select for the desktop UI: the Plugins page (pickers, review screen, install bound to the reviewed hash,
workbench draft selection, program installs, uninstall), the Plugins page library with its catalog rows,
packs and status block, and the right panel's Runs tab over `runs.*`; spec
`.agentic/specs/REQ-DATA-f563074f.md`. Start at
`05_Software/src/apps/desktop/src/renderer/components/plugins.tsx` and `runs-tab.tsx` (UI) or renderer
`plugin-catalog.tsx` (source settings and catalog rows).
[Plugin catalog, channels and signing](plugins-catalog.md) owns the catalog client and formats;
[Plugin provisioning and dependency kits](plugins-provisioning.md) owns program statuses, installs and
Re-install; [Plugin configuration and credentials](plugins-configuration.md) owns the Configuration
section; [Plugin program runner](plugins-runner.md) owns run records, run logs and the `runs.*` channel
schemas; [Plugin store, trust and integrity](plugins-store.md) owns review and install. [Plugins](plugins.md) is the index of the plugin pages.

## Purpose and boundaries

The desktop UI (spec `.agentic/specs/REQ-DATA-f563074f.md`): the sidebar's Plugins page
(`renderer/components/plugins.tsx`) installs in two steps, `plugins.choose` (native picker) and `plugins.review`
(the store reads and validates the package, installs nothing), then `plugins.install {path, sha256}` with the
reviewed hash. It lists installed plugins with their program statuses and issues, installs programs (`plugins.provision`) and uninstalls after a
confirmation. The review screen and the expanded card of an issue-free installed plugin show the same `PluginContents`
(`renderer/components/plugin-contents.tsx`): a Composition section (programs with install kind and script path or
source and expandable exact subcommand help with its effective risks, skills with their SKILL.md descriptions,
profiles and data files, documents; "Runs no programs." without
programs) and an Operations section, the manifest `rules` grouped by `pluginOperations` into one collapsed `<details>`
per risk (safe, device-read, device-write, irreversible, blocked; label and count in the summary; pattern, note and
timeout per rule). The risk labels are the approval prompt's `approval.risk.*`. The runner writes `.vera/runs/<run id>.json` beside each log; the right panel's Runs tab
(`renderer/components/runs-tab.tsx`) lists them (`runs.list`, polled every second) with session, plugin, state and date filters and sorting, shows a log (`runs.log`) and
stops a run (`runs.stop`). WorkbenchConfigForm's Plugins section embeds WorkbenchPlugins: installed packages are draft checkboxes saved through workbench.create or workbench.config.update with plugins.enabled. New workbenches default to none; existing choices are retained. Missing/invalid selected entries can be removed; invalid or untrusted packages cannot be newly selected. Read-only/pending forms disable controls; list failures show retry and do not clear the draft. Cancel performs no activation write. The global manager has no enable switches and points to Edit workbench → Plugins. Scoped package trust remains a separate action.

Workbench plugin rows show the activation checkbox and actionable readiness. Details group package facts,
agent tool allowances, and explicit program checks and setup. Shared electrical and automation tools have
their own collapsed section.

The global library is projected by `renderer/components/plugin-library.ts` and rendered by
`plugin-library-controls.tsx`, `plugin-catalog.tsx` and `plugins.tsx`. Source settings, separate
folder/ZIP imports, check-all, refresh and updates precede the library: filters and state buttons on the left, one list on the right.
Case/diacritic-insensitive all-word search intersects ecosystem/activity/provenance/maturity/requirements/state. Maturity is
shared `pluginMaturity(version)` (`plugins.ts`): `0.x.y` or a semver pre-release tag is `pre-release`, every other
valid version `stable`, a missing or invalid version `pre-release`; there is no manifest field. `MaturityBadge`
(`plugin-library-controls.tsx`) shows Pre-release beside the version on catalog cards, the review facts and installed
cards, and nothing for stable; Clear resets the maturity filter with the others (`clearedLibraryFilters`).
Requirements (REQ-UX-97df79a8) are shared `pluginRequirements(dependencies, configurable)`: skills without programs,
python for a pip/script program, download for a `download` kind, install for a `find` kind, settings when
`pluginConfigurable` (settings or program credentials). Catalog items use the entry's `dependencies` and
`configurable` flag (REQ-DATA-d10bb593, set by `vera catalog build`), installed items their manifest, and an
unloaded manifest has unknown requirements that match no checked box. The checked boxes are AND-combined in
`LibraryState.requirements`; `PluginRequirementBadges` shows the same labels on catalog and installed cards
(REQ-UX-8a9de6eb). A catalog
card (`CatalogItem`) shows name, version and badge, tier badge, id, ecosystem and the manifest `summary` (1-160
characters, required); the full description, programs, sources and rules stay in the install review. It adds a
`data-catalog-warning="platform"` note when the host's plugin platform (from `app.info` via shared `pluginPlatform`)
is known and not in the entry's `platforms`, and a `data-catalog-warning="risk"` note when the index entry's `risk`
(`pluginHighestRisk` of the rules below `blocked`, written by `vera catalog build`) is `device-write` or
`irreversible`; an unknown or unsupported host shows no platform warning. Its details also list the index entry's
`dependencies` (shared `pluginDependencies(manifest)`, written by `vera catalog build`, which reports a find program
without `hint` as a `dependency` issue) with `requires` (`plugin-dependencies.tsx` `CatalogDependencies`): each required
plugin with whether it is installed, each program as automatic (into VERA's program folder: pip requirement, script
path, the host's download with its declared `bytes` and SHA-256) or manual (range and vendor guide), before any package
download. When confirmation is required, a modal above the library summarizes the package origin, where it is
installed or trusted, requirements and operation risks. Details disclose the complete package review and hash.
Updates with program or rule changes expose both definitions. An unreadable installed copy is identified separately.
Eligible official skills packages install directly using the reviewed hash. Install with dependencies
(`data-action="catalog-install-all"`) requests confirmation and then calls
`plugins.provision` for each plugin it installed, one at a time, and shows a `data-install-results` block (the
Programs list per plugin, the not-ready ones with problem and guide, Check again = `plugins.check`). The expanded
installed card lists the manifest's required plugins and, per checked program, `data-automatic` and the found `path`
(ready find/external programs) or "In VERA's program folder". Re-install (`plugins.reinstall`, `Provisioner.reinstall`)
installs every managed program again (uv `--reinstall`; downloads fetched again, verified and swapped in through the
staging folder), never a find program; a failed re-download keeps the ready copy resolvable and reports the problem.
A fresh check hashes a single-file download and reports `unavailable/sha256` on a mismatch; Install dependencies also
repairs `sha256`. A download transfer longer than its declared `bytes` is `sha256`. State
counts respect other filters; the results line shows the total. Recently added/updated sort known dates
before unknown, with stable name/id/source ties. New is UTC day age 0..29. Page sizes are 6/12/24;
filter changes reset and loaded snapshot mutations clamp pages after catalog metadata settles
(including failure, which retains offline Installed management). The UI key uses gcTime Infinity;
QueryClient lifetime retains global filter/tab/page state after long navigation and result-cache expiry,
independently from workbench draft state. Local/trial/scoped entries never borrow catalog tier or
publication metadata from id matches. Global folder/ZIP/trial imports retain catalog update
filter/action when the catalog installed version agrees; same-id scoped records never do. Packs are installed through Install a pack (below); global activation stays absent.
Browsing/expansion uses disabled observers only, avoiding `plugins.programs` cache-miss probes.
Explicit Check/provision observations and failures update row/readiness filters. A rejected check
cannot show stale Ready; unknown, needs configuration and unavailable remain distinct. Check-all
continues after failures without provisioning or enabling. Manual imports select Installed after review.
Fixture-driven `plugin-library.test.ts` and the retained native/browser flows cover these boundaries.

Status block and packs (REQ-UX-492e89fb, REQ-UX-157f139c, REQ-UX-5d984350, REQ-FUNC-0817ec80,
REQ-UX-21440e02, REQ-REL-baf16878): `renderer/components/plugin-status.tsx` renders one block per healthy installed
card with Dependencies (`dependencyCheck`: unavailable, missing required plugins or VERA-installed programs, external
vendor programs, not checked, ready; holds Check, Install and Re-install), Configuration (`configurationCheck`; Configure
expands the card on its Configuration section) and Use (enabled in the open workbench only, since `plugins.list`
reports `enabled` for it; Open workbench comes from App: the open workbench's editor, or the folder chooser). The block
shows Ready only when all three are ready and otherwise names the others; it keeps `data-readiness` (`programReadiness`)
for the library filter. `renderer/components/plugin-packs.tsx`: Install a pack lists the index packs with their default
groups checked; `packPlan` orders the checked groups' plugins after their required catalog plugins (`installOrder`),
leaves out plugins of another platform, missing from the catalog or requiring a left-out plugin, and lists installed
ones. Its one review is built from the index entries (risk, dependencies) because core keeps only the latest reviewed
zip; Install then runs `plugins.catalogReview` and `plugins.catalogInstall` per plugin without the single review
screen and provisions each. A failure stops the run, shows that plugin's error in the install results and still
provisions the plugins installed before it.

## Public interface

- Desktop main `RunPresentation` projects args, command text/canonical cwd, run errors and tail/full
  logs through live Program runs masking, default false. Explicit workbench choices override app
  defaults; global unscoped program status requests use app defaults. Raw records/logs stay intact.
  Owner ID/folder is captured before asynchronous reads and rechecked before publication; stale,
  closed or foreign workbenches return CONFLICT. Status detail/hint/link/version/range/path are
  projected and bounded without changing schema identities or credential admission.
  App owns `useRunPresentation`, resetting Runs/log/program-status query caches and cancelling old
  replies on settings/config events. Previously observed disabled status queries re-read only passive
  plugins.programs; unchecked entries stay unchecked and action query functions are never replayed.
  Check/install/archive actions retain their own completion, then publish a fresh passive observation;
  their direct replies never overwrite the presentation cache. Completion retires any passive read
  started during the action before a fresh read or failure publication; original action errors propagate. Dialogs resolve the selected run ID from fresh rows. Finished
  full-log viewer tabs invalidate attempts across inactive session caches. Display does not decide
  run masking. No provisioning status event contains output; consumers refresh existing query IPC.
  Tests: main/run-presentation.test.ts, program-statuses.test.ts, renderer hook/Runs/document-tabs
  tests and native tests/e2e/run-masking.spec.ts (REQ-FUNC-2bd4a3a4/7ddb3926, REQ-SEC-ff8ae422).
- The global manager starts with compact accessible rows and unknown dependency state, grouped top catalog/folder/zip/refresh/check-all actions, explicit Check/Install controls, expandable descriptions/program diagnostics, and secondary export/uninstall actions. Find-only tools retain vendor guidance, including when ready, and never enable automatic installation. Ready managed fallbacks keep a correctly labeled Install action. Managed version/range failures permit repair (uv reinstall); discovered hybrid tools explicitly mark external:true and retain the no-replacement policy unless preferDownload permits it. Same-hash reinstallation clears old dependency UI observations. Redaction is followed by schema-length caps. Workbench selection stays draft-only and compact, with no implicit enablement.
- Renderer: `Plugins({workbench?})` (`renderer/components/plugins.tsx`), `RunsTab({workbenchId})`
  (`renderer/components/runs-tab.tsx`), a `runs` slot in `Shell`.

## Invariants

- The app's QueryClient defaults to `staleTime: Infinity`; plugin lists, runs and logs use `staleTime: 0` for fresh disk state. Disabled program observers consume only cached explicit check/provision/archive results; opening, filtering or expanding either plugin page never probes versions.
- Workbench plugin checkboxes read config.plugins.enabled from the owner draft, never list enabled flags. Filtering, paging and list refresh cannot overwrite hidden choices. Private per-workbench presentation queries retain filters for the app session (gcTime Infinity only on UI keys); page clamping waits for list and catalog metadata. Readonly users may browse while mutation controls stay disabled. Unresolved selected IDs remain removable; invalid/untrusted packages cannot be newly selected. Global Plugins navigation hides the existing editor owner (hidden/inert) without discarding its config/instructions draft. Only the plugin presentation unmounts to avoid hidden duplicate controls; its private cache restores filters/section on return to the same workbench and re-reads packages. Switching workbenches or truly leaving the draft still uses the existing confirmation. Top Save/Cancel reuse the config/instructions lifecycle; enabled-set comparison restores clean Save state after a reorder. Explicit dependency configuration never enables a package and find-only SDK setup remains vendor-managed.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Workbench selection UI | renderer `workbench-plugins.tsx`, `workbench-config-form.tsx`, `workbench-create.tsx`, `workbench-editor.tsx` | `workbench-plugins.test.ts`, native workbench draft case in `plugins-ui.spec.ts` |
| Dependency summary, card dependencies, Install with dependencies, Re-install | shared `plugins.ts`, core `catalog-source.ts`, `provisioning.ts`, renderer `plugin-dependencies.tsx`, `plugin-catalog.tsx`, `plugins.tsx` | `shared/src/plugins.test.ts`, `catalog-source.test.ts`, `provisioning.test.ts`, `plugin-catalog.test.ts`, `plugins.test.ts` |
| Plugins page or Runs tab | renderer `plugins.tsx`, `runs-tab.tsx`, `shell.tsx`, `App.tsx`, locales | `plugins.test.ts`, `runs-tab.test.ts`, `tests/e2e/plugins-ui.spec.ts` (native), `plugins-mock.spec.ts` (languages, themes, sizes) |
| Catalog section, review queue, update buttons | renderer `plugin-catalog.tsx`, `plugins.tsx`, `mocks/mockApi.ts`, locales | `plugin-catalog.test.ts`, `mockApi.test.ts`, `tests/e2e/plugins-catalog.spec.ts`, `plugins-mock.spec.ts` |

## Key behaviors

- `REQ-UX-c49dc727` / `REQ-UX-b62eb1e0` — Composition and Operations sections on the plugin page.
- `REQ-UX-28503c97` / `REQ-UX-41c19e62` / `REQ-UX-e6056763` / `REQ-UX-8904f319` / `REQ-UX-acc04fbc` / `REQ-UX-fd6bc95d` / `REQ-UX-d51c6e3c` / `REQ-UX-c1de1651` / `REQ-UX-e07790cb` — Plugins page.
- `REQ-UX-e0e51891` / `REQ-UX-25921e97` / `REQ-UX-93fd56dc` — Runs tab: list, log dialog, Stop.
- `REQ-UX-72a349a1` / `REQ-UX-c55a0fe1` / `REQ-UX-9207423e` — prerequisite-aware catalog review, catalog list and updates, catalog URL field.
- `REQ-UX-714c27e6` / `REQ-UX-b3fb479b` / `REQ-FUNC-34191c6f` — dependencies on the catalog card and the installed card,
  Install with dependencies.

## Files

- `05_Software/src/apps/desktop/src/renderer/components/plugins.tsx`, `plugins.test.ts` — library/action owner and tests.
- `05_Software/src/apps/desktop/src/renderer/components/plugin-contents.tsx` — Composition and Operations sections (tested in `plugins.test.ts`).
- `05_Software/src/apps/desktop/src/renderer/components/plugin-library.ts`, `plugin-library-controls.tsx`, `plugin-library.test.ts` — passive projection, filters/counts/sort/paging and session state.
- `05_Software/src/apps/desktop/src/renderer/components/runs-tab.tsx`, `runs-tab.test.ts` — the Runs tab and its tests.
- `05_Software/tests/e2e/plugins-ui.spec.ts` — native install through the review, enable, Runs log and Stop, broken plugin.
- `05_Software/tests/e2e/plugins-mock.spec.ts` — browser mock flow and overflow in every language, theme and size.
- `05_Software/tests/fixtures/llm-scripts/program-serve.jsonl` — replay script starting `echo serve` in the background.
- `05_Software/src/apps/desktop/src/renderer/components/plugin-catalog.tsx`, `plugin-catalog.test.ts` — catalog settings/rows.
- `05_Software/tests/e2e/plugins-catalog.spec.ts` — native install and rule-changing update from a loopback catalog.

Workbench selection UI: `05_Software/src/apps/desktop/src/renderer/components/workbench-plugins.tsx` and `workbench-plugins.test.ts` own draft selection. Global package management remains in plugins.tsx; shared Programs renders dependency diagnostics in workbench explicit configuration. REQ-UX-840fad9c/e5d617d7/69b54580 cover top actions, discovery and passive readiness.

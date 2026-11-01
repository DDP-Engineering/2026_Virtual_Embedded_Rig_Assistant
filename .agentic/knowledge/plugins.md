# Plugins

## Routing

Select for plugin.yaml validation, the installed plugin store under `<userData>/plugins`,
install.json, the integrity hash ("changed since review"), install from a folder or zip, uninstall,
plugin listing issues, `plugins.enabled` in workbench.yaml and the `plugins.*` IPC channels. Start at
`05_Software/src/libraries/shared/src/plugins.ts` (schema) and
`05_Software/src/libraries/core/src/plugins/store.ts` (store); focused tests sit next to each.
[Workbench](workbench.md) owns workbench.yaml, its write queue and warnings; [Skills](skills.md)
owns Agent Skills discovery (plugin skills are not loaded yet); [IPC boundary](ipc-boundary.md)
owns channel registration and frame authorization.

## Purpose and boundaries

Shared defines plugin.yaml format 1, the issue codes and the plugin summaries exchanged over IPC.
Core's `PluginStore` imports a package (folder or zip) into `installed/<id>/` with `install.json`,
lists installed plugins with every issue, loads only issue-free ones and uninstalls them. Every
list and load re-reads the files and recomputes the hash; nothing is cached. Enablement is a list
in each workbench's `.vera/workbench.yaml`, written by `WorkbenchService.togglePlugin`. Nothing
runs programs, matches rules or provisions tools yet; desktop main composes one store at
`<userData>/plugins`.

## Public interface

- Shared: `pluginManifestSchema`, `validatePluginManifest(data)` → `{manifest?, issues}`,
  `pluginIdSchema`, `pluginRiskSchema`, `pluginTierSchema`, `pluginPlatformSchema`,
  `pluginIssueSchema` (`manifest`, `yaml`, `field`, `id`, `record`, `changed`, `unavailable`),
  `pluginInstalledSchema`, `pluginSummarySchema` (adds `enabled`), `PLUGIN_LIMITS`,
  `isPluginRelativePath`.
- Core: `new PluginStore({ root, now?, uuid? })` with `install(path)`, `list()`, `load(id)` →
  `{manifest, record, folder}`, `uninstall(id)`, `ids()`; `pluginIntegrity(files)`;
  `pluginRecordSchema` (install.json format 1).
- WorkbenchService: `togglePlugin(workbenchId, pluginId, enabled)`, `enabledPlugins(workbenchId)`;
  `configWarnings` takes `catalogs.plugins`, filled from `PluginStore.ids()` of
  `<userData>/plugins`.
- IPC: `plugins.list {workbenchId?}` → summaries with `enabled`; `plugins.install {path}` (absolute
  folder or .zip) → installed summary; `plugins.uninstall {id}`; `plugins.toggle {workbenchId, id,
  enabled}`. The browser mock keeps installed plugins in memory.

## Invariants

- The manifest is strict format 1: unknown keys, a second install kind, a version regex without
  exactly one capture group, placeholders other than `${workbench}`/`${pluginDir}` (env) or
  `${pluginDir}` (prefix) are field issues with dotted paths. `id` equals the folder name.
- Imports refuse symbolic links and junctions (DENIED), unsafe or case-colliding paths, a root
  `install.json`, more than 4096 files, 64 MiB of content, a 64 MiB zip or a 256 KiB manifest
  (INVALID), before anything is written. Zip sizes are summed from the central directory before
  inflating.
- An invalid manifest refuses install with INVALID and `params {issue, path?}`; the installed
  plugins stay unchanged. A valid reinstall replaces the whole folder through `staging/`.
- The integrity hash covers every file except the root install.json, in sorted path order, framed
  as path NUL length NUL bytes. A mismatch lists `changed` and `load` refuses; any issue refuses
  `load` with INVALID; an unknown id is NOT_FOUND.
- `plugins.enabled` defaults to `[]`, is opt-in per workbench and never enables a plugin elsewhere;
  an id that is not installed is an UNKNOWN_NAME warning, not an error.
- Store mutations run one at a time per store instance.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Manifest field or limit | `pluginManifestSchema` in shared `plugins.ts` | `shared/src/plugins.test.ts` |
| Import, limits, hash, list, load, uninstall | `PluginStore`, `readFolder`, `readZip`, `examine` in `core/src/plugins/store.ts` | `core/src/plugins/store.test.ts` |
| Workbench enablement or warnings | `workbench.ts` (`plugins`, `configWarnings`), `WorkbenchService.togglePlugin` | `shared/src/workbench.test.ts`, `core/src/workbench/service.test.ts` |
| IPC or mock | `ipc.ts` `plugins.*`, desktop `main/index.ts`, `renderer/mocks/mockApi.ts` | `shared/src/plugins-ipc.test.ts`, `renderer/mocks/mockApi.test.ts` |

## Key behaviors

- `REQ-DATA-4d4471f9` — plugin.yaml format 1 validation with field paths (spec REQ-DATA-4d4471f9.md).
- `REQ-FUNC-6dd00f25` — install from a folder, install.json, valid after restart.
- `REQ-FUNC-6db9dc8f` — install from a zip with the package at the root or in one top folder.
- `REQ-FUNC-77843ccc` — an invalid manifest refuses install, store unchanged.
- `REQ-SEC-9b266629` — unsafe or oversized packages refused.
- `REQ-FUNC-deaa76d1` — reinstall replaces the whole installation.
- `REQ-FUNC-f003e3e5` — list with metadata and field-level issues.
- `REQ-SEC-892a67e8` — changed files list "changed since review" and never load.
- `REQ-FUNC-1d6999a7` — load only issue-free plugins.
- `REQ-FUNC-9ba5f19c` — uninstall; NOT_FOUND for unknown ids.
- `REQ-FUNC-41f5c03b` — plugins.enabled per workbench.
- `REQ-FUNC-0c4bc419` — UNKNOWN_NAME/UNKNOWN_KEY warnings for plugins.
- `REQ-FUNC-9dd7413b` — plugins.* IPC channels and browser mock.

## Files

- `05_Software/src/libraries/shared/src/plugins.ts` — manifest, issue, summary and request schemas; limits.
- `05_Software/src/libraries/shared/src/plugins.test.ts` — manifest validity and field paths.
- `05_Software/src/libraries/shared/src/plugins-ipc.test.ts` — strict channel requests and responses.
- `05_Software/src/libraries/core/src/plugins/store.ts` — PluginStore, integrity hash, install.json.
- `05_Software/src/libraries/core/src/plugins/store.test.ts` — install/zip/limits/reinstall/list/changed/load/uninstall.
- `05_Software/src/libraries/shared/src/workbench.ts` — `plugins.enabled`, patch, merge, warnings.
- `05_Software/src/libraries/core/src/workbench/service.ts` — `togglePlugin`, `enabledPlugins`, plugin warnings.
- `05_Software/src/apps/desktop/src/main/index.ts` — store composition and `plugins.*` handlers.
- `05_Software/src/apps/desktop/src/renderer/mocks/mockApi.ts` — in-memory mock of the channels.

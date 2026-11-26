# Plugin store, trust and integrity

## Routing

Select for the installed plugin store under `<userData>/plugins`, workbench-scoped packages under
`.vera/plugins`, machine-local hash trust, install.json, the integrity hash ("changed since review"),
install from a folder or zip, uninstall, plugin listing issues, `plugins.enabled` in workbench.yaml and
the `plugins.*` IPC channels for list, choose, review, install, uninstall and toggle. Start at
`05_Software/src/libraries/core/src/plugins/store.ts` (store); focused tests sit next to it.
[Plugin manifest and rules](plugins-manifest-rules.md) owns the plugin.yaml schema;
[Plugin catalog, channels and signing](plugins-catalog.md) owns catalog installs;
[Plugins page and Runs tab](plugins-ui.md) owns the review screen and the workbench selection UI;
[Plugin builder and authoring](plugins-builder.md) owns trial installs, promotion and export.
[Workbench](workbench.md) owns workbench.yaml, its write queue and warnings; [Skills](skills.md)
owns Agent Skills discovery, plugin skills included; [IPC boundary](ipc-boundary.md)
owns channel registration and frame authorization. [Plugins](plugins.md) is the index of the plugin pages.

## Purpose and boundaries

Core's `PluginStore` imports a package (folder or zip) into `installed/<id>/` with `install.json`,
lists installed plugins with every issue, loads only issue-free ones and uninstalls them. Every
list and load re-reads the files and recomputes the hash; nothing is cached. Enablement is a list
in each workbench's `.vera/workbench.yaml`, written by `WorkbenchService.togglePlugin`. Desktop main
composes one global store at `<userData>/plugins` and workbench-bound views.

A clean review marks the package eligible for catalog skills-only admission when it contains a valid skill,
all skill metadata is valid, and it declares no programs, rules, required plugins or settings. Files consist of
the manifest and UTF-8 Markdown in recognized localized help pages, declared local documents or valid skill folders.

A bound `PluginStore` discovers immediate `.vera/plugins/<id>` packages, including invalid entries,
and combines them with global installations. Scoped ids reserve the name; a global/scoped collision
lists `collision` and blocks both. Case aliases reserve names on Windows. Source paths refuse
linked/junction ancestors and package entries through the existing package reader.
`reviewScoped(id)` reuses the package review; user-only `trustScoped(id, sha256)` copies the verified
package into `<userData>/plugins/workbenches/<canonical-workbench-path-hash>/snapshots/<package-hash>/installed/<id>` using
format-1 install records. A machine-local reserved/<id> install record selects the current trusted hash. No trust is read from or written to workbench files. Different locations
and userData roots need separate trust. `load` verifies source plus snapshot and returns the snapshot
folder with a final `verify` callback and workbench-specific managed-runtime key. Changed files,
deleted sources or corrupt snapshots prevent consumption; restoring bytes of the currently selected trusted hash at the same
location restores consumption. An older retained hash requires a new explicit user review. One current reviewed hash per id is selected; earlier hash-addressed code is retained for prepared/running processes, but those bytes alone grant no trust. Source/reserved and combined views exceeding 1024 ids fail with INVALID; collision checks use physical installed entries independently of presentation limits.
No mode grants trust. The agent cannot call scoped trust or edit `.vera/plugins`; drafts live elsewhere.
Enablement remains explicit `plugins.enabled`; `requires` remains descriptive with no dependency action.
Program ambiguity and skill precedence retain existing rules. Desktop `plugins.scopedReview/scopedTrust`
bind the open workbench id and hash; full review shows SHA and risks. Refresh rehashes source;
session prompt caches include fresh plugin hashes. CLI `plugin list/review/trust/provision` shares this
boundary and requires persistent `--data`. Provisioner checks integrity before resolution/probes and
installs; ProgramTools rechecks after approval consumption and before spawn. Package code runs from the
machine snapshot. Source changes after that last check cannot alter snapshot bytes; already running
processes continue. Managed pip environments are partitioned by workbench and package hash, download blobs by content hash.
Portable exports exclude install records. Desktop ProvisionerHosts tracks request-bound hosts, closes active probes/installs at quit, awaits their operations/process exits/tree kills and rejects new admission.

## Public interface

- Desktop package listing runs the complete PluginStore integrity path in `plugin-list-worker`, with only identical pending scopes coalesced and shutdown termination. No completed integrity result is reused by this seam. Main rechecks current workbench/database before returning.
- Core: `new PluginStore({ root, now?, uuid? })` with `review(path)` → `PluginReview`, `install(path, sha256?)`
  (CONFLICT when the package's hash differs from `sha256`), `list()`, `load(id)` →
  `{manifest, record, folder}`, `uninstall(id)`, `ids()`; `pluginIntegrity(files)`;
  `pluginRecordSchema` (install.json format 1).
- WorkbenchService: `togglePlugin(workbenchId, pluginId, enabled)`, `enabledPlugins(workbenchId)`;
  `configWarnings` takes `catalogs.plugins`, filled from `PluginStore.ids()` of
  `<userData>/plugins`.
- IPC: `plugins.list {workbenchId?}` → summaries with `enabled`; `plugins.choose {kind: folder|zip}` →
  `{path|null}` (instrumented builds: `VERA_TEST_PLUGIN_PATH`); `plugins.review {path}` → `pluginReviewSchema`
  `{path, kind, sha256, issues, manifest?, installed?}`; `plugins.install {path, sha256}` (absolute
  folder or .zip, the reviewed hash) → installed summary; `plugins.uninstall {id}`; `plugins.toggle {workbenchId, id,
  enabled}`. The browser mock keeps installed plugins in memory.
- WorkbenchService `loadPlugins(id)` -> the enabled plugins that load (installed, issue-free,
  unchanged), in plugins.enabled order.
- Summaries: `pluginInstalledSchema.irreversible` lists `{match, note?}` of a plugin without issues;
  `plugins.list` carries it. An issue-free summary (global or trusted scoped) also carries `manifest` and
  `composition`; a review carries `composition` whenever its manifest parses. Composition: each
  `skills/<name>/SKILL.md` with the front-matter description of core `parseSkill` (none when it does not parse), and
  the data files outside `plugin.yaml`, `skills/`, `scripts/`, `help/<en|ro|de|fr>.md` and the package-relative docs,
  in path order; `help` lists the languages of the package's `help/<language>.md` pages when it has any.

## Invariants

- Imports refuse symbolic links and junctions (DENIED), unsafe or case-colliding paths, a root
  `install.json`, more than 4096 files or a 256 KiB manifest (INVALID), before anything is written; the
  package size is not limited. Zip entries are counted from the central directory before inflating.
- An invalid manifest refuses install with INVALID and `params {issue, path?}`; the installed
  plugins stay unchanged. A valid reinstall replaces the whole folder through `staging/`.
- The integrity hash covers every file except the root install.json, in sorted path order, framed
  as path NUL length NUL bytes. A mismatch lists `changed` and `load` refuses; any issue refuses
  `load` with INVALID; an unknown id is NOT_FOUND.
- `plugins.enabled` defaults to `[]`, is opt-in per workbench and never enables a plugin elsewhere;
  an id that is not installed is an UNKNOWN_NAME warning, not an error.
- Store mutations run one at a time per store instance.
- The desktop app installs only a package with the hash its review showed; `plugins.review` never writes.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Scoped discovery/trust/isolation | `PluginStore` scoped methods, `WorkbenchService.loadPlugins` | `scoped-store.test.ts`, scoped CLI Git fixture in `cli.test.ts`, native scoped `plugins-ui.spec.ts` |
| Import, limits, hash, list, load, uninstall | `PluginStore`, `readFolder`, `readZip`, `examine` in `core/src/plugins/store.ts` | `core/src/plugins/store.test.ts` |
| Workbench enablement or warnings | `workbench.ts` (`plugins`, `configWarnings`), `WorkbenchService.togglePlugin` | `shared/src/workbench.test.ts`, `core/src/workbench/service.test.ts` |
| IPC or mock | `ipc.ts` `plugins.*`, desktop `main/index.ts`, `renderer/mocks/mockApi.ts` | `shared/src/plugins-ipc.test.ts`, `renderer/mocks/mockApi.test.ts` |
| Review, picker, hash-bound install | `PluginStore.review`/`install` in `store.ts`, `plugins.choose`/`review`/`install` in `main/index.ts` | `store.test.ts`, `plugins-ipc.test.ts`, `mockApi.test.ts` |

## Key behaviors

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
- `REQ-DATA-3f62c8c1` — irreversible rules in plugin summaries.
- `REQ-DATA-b065d2a4` / `REQ-FUNC-8af265ac` — composition on review and summary; operations from the approval rules.
- `REQ-FUNC-a5be5e53` / `REQ-SEC-8e281f52` / `REQ-FUNC-6c76f25a` — review without installing, install bound to the reviewed hash, native pickers.

## Files

- `05_Software/src/libraries/shared/src/plugins-ipc.test.ts` — strict channel requests and responses.
- `05_Software/src/libraries/core/src/plugins/store.ts` — PluginStore, integrity hash, install.json.
- `05_Software/src/libraries/core/src/plugins/store.test.ts` — install/zip/limits/reinstall/list/changed/load/uninstall.
- `05_Software/src/libraries/shared/src/workbench.ts` — `plugins.enabled`, patch, merge, warnings.
- `05_Software/src/libraries/core/src/workbench/service.ts` — `togglePlugin`, `enabledPlugins`, plugin warnings.
- `05_Software/src/apps/desktop/src/main/index.ts` — store composition and `plugins.*` handlers.
- `05_Software/src/apps/desktop/src/renderer/mocks/mockApi.ts` — in-memory mock of the channels.

Scoped request lifetime is implemented by desktop `main/provisioner-hosts.ts` and verified by the real hanging-probe quit case in the native Plugins page spec ([Plugins page and Runs tab](plugins-ui.md)); content-addressed approval/spawn binding is verified by `tests/integration/scoped-programs.test.ts`.

# Plugin provisioning and dependency kits

## Routing

Select for provisioning: the bundled uv, install kinds pip/script/download/find (including find with a
pinned download fallback), the runtime folder, version probes and supported ranges, program statuses,
`plugins.programs`/`plugins.provision`/`plugins.reinstall`/`plugins.check`/`plugins.installArchive`,
`vera plugin install`, the package index/proxy settings and the offline dependency kit (`plugins.kit`,
`vera catalog kit`). Start at `05_Software/src/libraries/core/src/plugins/provisioning.ts` (provisioning, with
`archive.ts`); real processes run in `05_Software/tests/integration/provisioning.test.ts`.
[Native packaging](native-packaging.md) owns `prepare:uv` and the `<resources>/uv/` payload;
[Headless CLI](headless-cli.md) owns the `vera plugin install` command.
[Plugin program tools and approvals](plugins-program-tools.md) owns the resolver seam that run_program
uses; [Plugins page and Runs tab](plugins-ui.md) owns the dependency rows, Install with dependencies and
the status block. [Plugins](plugins.md) is the index of the plugin pages.

## Purpose and boundaries

Core's `Provisioner` (`provisioning.ts`) installs and locates declared programs under
`<userData>/plugins/runtime/` (spec `.agentic/specs/REQ-FUNC-714e26bc.md`): `install(id)` is the user's action
(desktop `plugins.provision`, CLI `vera plugin install`), `statuses(id)` and `resolve(plugin, program)` never
install. pip and script programs run the bundled uv (pinned by `src/uv/uv-manifest.json`) with every uv folder
inside the runtime and one managed CPython 3.13; downloads are verified, extracted (zip in core through
`archive.ts`, tar archives through the system tar, Windows-only `.7z` through System32 bsdtar) and kept per SHA-256;
find programs are searched on PATH and absolute globs (on Windows `%PATH%` looks for `<program>.exe`). A program may
declare `uses: [<program>]` - find or download programs of the same plugin; resolving it also resolves each used
program and adds its absolute path to the run as `VERA_PROGRAM_<NAME>` (upper case, `-`/`.` -> `_`), and it does not
resolve when a used program does not. A program that opens windows declares `gui: true`: its runs (and only
its runs) also receive the host's DISPLAY, WAYLAND_DISPLAY, XAUTHORITY and XDG_RUNTIME_DIR (`DISPLAY_VARIABLES`,
`programEnvironment(..., display)`, RunRequest `display`); kicad-layout-tool uses it for KiCad's PCB editor. A
download-only program may declare `file: true` (a Java archive): provisioning never runs it, its version is
`version.match` on the downloaded file's name, run_program refuses it, and programs that `use` it get its path
(freerouting's jar). Format-1 find may include a download fallback: by default a found executable is probed first, and a miss permits only the user-triggered installer to fetch. A failed found probe remains unavailable. With `preferDownload: true`, an installed managed executable is selected before discovery, and a discovery result with a managed entry for the host reports `downloadAvailable` so the user can still provision. Combined statuses use kind download and the review screen lists both sources. Archive entry points share the SHA-256 tree but retain separate recorded versions. Launchers remain find-only. Versions come from probes, are recorded in install.json and checked against `version.range`.

## Public interface

- `plugins.check` explicitly refreshes all program probes without installing. Pending checks share package/runtime identity and serialize with provisioning; fresh per-program cache entries are populated together, so passive reads cannot replace a fresh check with a recorded version. A replaced package rejects the pending check. Scoped check observations, including negative states, propagate atomically into the singleton session resolver; concurrent runtime invalidation rejects the older pending check. Scoped passive status reads use the same resolver observations for the verified scoped package, so reopening the page cannot restore a rejected Ready state. Completed checked failures survive later unrelated invalidation, bound to runtime/plugin/program, package SHA, installation timestamp and per-program record. A fresh check or actual provisioning supersedes them. Ready observations clear prior failures and remain in the ordinary resolution cache so missing discovered files are detected after invalidation. Invalid archive selection preserves healthy runtime authority. Version probes of found programs allow 8 s, other version probes 30 s; declared activation launchers allow 120 s. A timed-out probe's detail names the timeout. At most four version probes run at once across all provisioners of a process (a module-level limiter); a plugin's programs are inspected concurrently and listed sorted by name, with `verify()` once before them.
- `plugins.installArchive {id,program,sha256,workbenchId?}` uses a native archive picker. Current workbench/database, package hash, program/platform and trust are checked before and after selection. Selected regular bytes are streamed through SHA-256 before cache reuse; staging, extraction confinement and a second identity check precede publication. No URL or hash comes from the selected file. Verified blobs may remain when a later version probe fails.
- Offline dependency kit (spec REQ-DATA-532b02f5): settings `plugins.kit` (an absolute local folder). Install and Re-install
  take a download program's file from `<kit>/files/<sha256>/<name>` (`dependencyKitFile(entry)`) through the same
  `download(..., localPath)` verification as `plugins.installArchive`. A mismatch is `missing/sha256` with a detail naming
  the kit file, and there is no URL fallback. A kit without that file uses the pinned URL. uv gets `UV_OFFLINE=1`,
  `UV_FIND_LINKS=<kit>/wheels` and `UV_PYTHON_INSTALL_MIRROR=<file URL of kit/python>`, never `UV_DEFAULT_INDEX`, and each
  pip/script install first runs `uv python install` (offline uv never downloads CPython implicitly). The bench
  never reads `kit.json`.
- Managed Python uses pinned uv0.13.7; an exact known minor-link failure can retry once after unlinking only an independently validated runtime-owned alias, never its patch interpreter or an escaping nested Python directory.
- Provisioning (core): `new Provisioner({store, root, uv?, host, clock, platform, fetch, settings, timeouts?})`
  with `install(id, signal?)`, `close()`, awaited `drain()` and `statuses(id, signal?)` -> `PluginProgramStatus[]` (name order),
  `resolve(plugin, program, signal?)` -> `{executable, prefix?, env?, version}` or undefined, `invalidate()`,
  `uvEnvironment(plugin)`; `pluginPlatform(platform, arch)`; `UV_PYTHON` "3.13"; `PluginStore.recordPrograms(id,
  sha256, versions)` (CONFLICT when the hash changed); `extractZip`, `checkTree`, `tarCommand`, `ArchiveError`.
- Shared: `pluginProgramStatusSchema` `{name, kind, state: ready|missing|unavailable, version?, range?, hint?,
  link?, problem?, detail?}`, `pluginProgramProblemSchema` (notFound, install, download, sha256, archive,
  platform, uv, version, range), `downloadForm(url)`, `downloadName(entry)`, `versionInRange(version,
  range)`, `urlParts(url)`; settings `pluginSettingsSchema {index?, proxy?}`.
- IPC: `plugins.programs {id}`, `plugins.provision {id}` and `plugins.reinstall {id}` -> statuses (NOT_FOUND unknown
  id, INVALID plugin with issues); the browser mock answers them. Shared `pluginDependencies(manifest)`,
  `pluginDependencySchema`, `pluginProgramKind(program)`, `pluginHintLink(hint)`; status `path` (found programs).
  Catalog entries require `dependencies`. CLI: `vera plugin install --path <folder|zip> --data <dir>`.
- Dependency kit (core): `buildDependencyKit(source, platform, out, tools, {skip?})` -> `{issues, kit?}` (kit.json, `skipped`; an unknown
  skipped id throws), throws `DependencyKitError` naming
  the program or file and leaves no `out` or staging folder; tools `{fetch, wheels(platform, {requirement}|{script},
  folder), python(platform)}` (CLI `cliKitTools(uv)` in `kit-tools.ts`); `DEPENDENCY_KIT_PLATFORMS` windows-x64 and linux-x64.

## Invariants

- Provisioning writes only below `<userData>/plugins/runtime/`: `cache/`, `python/` (+ `python/bin`),
  `tools/<plugin id>/` (+ `bin/`), `downloads/<sha256>/`, `downloads/.staging/<uuid>/` (always removed). Every
  uv call carries the minimal program environment plus `UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`,
  `UV_PYTHON_BIN_DIR`, `UV_TOOL_DIR`, `UV_TOOL_BIN_DIR`, `UV_MANAGED_PYTHON=1`, `UV_PYTHON=3.13`,
  `UV_PYTHON_INSTALL_BIN=0`, `UV_PYTHON_INSTALL_REGISTRY=0`, `UV_NO_CONFIG=1`, `UV_NO_PROGRESS=1`, and
  `UV_DEFAULT_INDEX`/`HTTPS_PROXY`/`HTTP_PROXY` from settings; no uv variable of VERA's own environment passes.
- A program is installed when `install.json.programs` records its version (a reinstall resets it). Platform
  (plugin, download entry, find list) exclusions are decided before any spawn or fetch. Installs
  run one at a time per provisioner; each failure is a status, store errors throw. Each program has one
  deadline (15 min) over transfer, extraction, uv and probe; each version is recorded as soon as it is probed;
  `close()` aborts running installs and probes and refuses new ones; `drain()` also waits for process exits/tree kills at desktop `before-quit`; each install first
  removes staging folders older than the install deadline (younger ones may be another process's). Cached inspections run under the provisioner's lifetime and each caller only
  races its own signal against them.
- Resolve never fetches or runs uv: pip -> `tools/<id>/bin/<program>[.exe]`; script -> uv with `run --quiet
  --offline --script <file>` and the uv environment; download -> `downloads/<sha256>/<path>` with its prefix;
  find -> the first file of the search, probed. Results are cached per plugin id, hash, recorded versions and
  program until `install` or `invalidate(pluginId?)`, which forgets only that plugin's entries (all without an id);
  desktop main invalidates the changed plugin after plugins.install, promote, trust, uninstall, toggle, catalog
  install and provision, and everything after a settings patch with `plugins`.
- Found programs' versions (launchers excluded: their version follows the activated SDK) persist in `runtime/probes.json` (`{format: 1, probes: {key: {stamp, version,
  probedAt}}}`), keyed by executable, probe argv and version.match. A stamp of dev, inode/NTFS file index, size
  and mtimeNs (stat follows links) that still matches returns the stored version without starting the program;
  `check` always probes; a failed probe removes the entry. All provisioners of a process share one in-memory map per file; writes are
  serialized in-process through a temp file and rename, best effort. A program replaced with identical size, mtime and identity keeps its old version
  until Check again.
- After workbench create/open, desktop main reads the enabled plugins' statuses in the background (not awaited,
  errors ignored) so the Plugins panel and first tool call find a warm cache.
- Downloads: at most 2 GiB, hashed while streamed; another SHA-256 is `sha256`; transfer failures and HTTP
  errors are `download`; zip entries must be plugin-relative after `\` -> `/` and are written as plain files
  (no links), tar archives (and on Windows `.7z`, declared for windows-x64 only) go through
  `%SystemRoot%\System32\tar.exe` or `/usr/bin/tar` (`/bin/tar`) - for a `.7z`, bsdtar's exit 1 is accepted only
  when its whole output is its notice of skipped entries with unreadable (non-ASCII) names - then every
  link must resolve inside the tree and every other entry be a file or folder (`archive`); the declared path must
  be a file (`archive`); single files and, off Windows, the archive's executable get mode 0755. Any failure
  removes the staging folder, so nothing of it remains. Limit: extraction is bounded only by the pinned download.
- find: `%PATH%` (Windows) or `$PATH` (Linux) searches PATH for `<program>.exe`/`<program>`; other entries
  expand a leading `~` and `%NAME%` or `$NAME`/`${NAME}` (an unset variable skips the entry), then match `*`
  within one segment, highest name first (numeric-aware); only absolute local patterns are searched; a folder
  match means `<folder>/<program>[.exe]`; on Windows only `.exe` files count, on Linux only files the user may
  execute (`access X_OK`). The schema allows `*` in at most two segments, so a search reads few folders.
- Probes: 30 s, first 64 KiB of output with ANSI removed, any exit code; `version.match` evaluated with a 100 ms
  bound; no match, a start failure or a timeout is `version`; a version outside `range` (dotted numbers,
  component-wise, missing components 0, non-numeric versions never in range) is `range`.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Install kinds, probes, ranges, statuses, uv environment | `core/src/plugins/provisioning.ts` | `provisioning.test.ts`, `tests/integration/provisioning.test.ts` |
| Zip extraction, tree check, system tar | `core/src/plugins/archive.ts` | `archive.test.ts`, `tests/integration/provisioning.test.ts` |
| Program status schema, range grammar, download form | shared `plugins.ts` | `shared/src/plugin-provisioning.test.ts` |
| plugins.programs / plugins.provision / plugins.reinstall, prompt-entry cache | desktop `main/index.ts`, `main/sessions.ts`, `mocks/mockApi.ts` | `main/sessions.test.ts`, `mocks/mockApi.test.ts` |
| `vera plugin install` | `cli/src/{args,plugin,provisioning}.ts` | `tests/integration/cli.test.ts` |
| Offline dependency kit: build, layout, `vera catalog kit`, bench use (`plugins.kit`) | core `dependency-kit.ts`, `catalog-source.ts` (`readCatalogSource`), `provisioning.ts` (`installOne`, `uvEnvironment`), CLI `kit-tools.ts`, `catalog.ts`, `args.ts`, shared `settings.ts`; procedure `02_Tools/release/catalog-release.md` | `dependency-kit.test.ts`, `provisioning.test.ts` (dependency kit), `catalog-args.test.ts`, `plugins-ipc.test.ts` (kit setting) |

## Key behaviors

- `REQ-FUNC-20b10001` / `REQ-FUNC-20b10002` — find-first combined provisioning and shared verified fallback; `REQ-DATA-4d4471f9` accepts the format-1 declaration.
- `REQ-SEC-e0567486` / `REQ-PLAT-c99d7918` / `REQ-SEC-1a151052` / `REQ-PLAT-1ecf3d4f` — uv runs inside the runtime; pinned uv prepared, refused when altered, shipped and re-checked.
- `REQ-FUNC-714e26bc` / `REQ-REL-e27cda96` / `REQ-FUNC-e7cb0626` / `REQ-FUNC-edbe037c` — pip and script installs, uv failures, offline script runs.
- `REQ-FUNC-aa09d82e` / `REQ-FUNC-d30d568c` / `REQ-SEC-cde8b481` / `REQ-SEC-e51bc0d8` / `REQ-REL-e068dcd7` — downloads: archives, single files, wrong hash, escaping archives, failed transfers.
- `REQ-FUNC-c9dde429` / `REQ-UX-46085ddf` / `REQ-FUNC-514708b5` / `REQ-SEC-ba78d876` — find search, missing hint and link, version probe and range.
- `REQ-SEC-49ff111b` / `REQ-FUNC-5491d410` — resolve never installs; platform exclusions.
- `REQ-FUNC-13ef1c0c` / `REQ-FUNC-86daf060` / `REQ-FUNC-c44675ed` / `REQ-FUNC-c12941f3` / `REQ-SEC-0bc97768` — statuses and installs over IPC and the CLI; index and proxy settings.
- `REQ-FUNC-565e908d` / `REQ-NFR-a881a281` / `REQ-PLAT-8b3408cb` — provisioner composed in the apps; cached prompt entries; clean-machine run (manual).
- `REQ-FUNC-751e430e` / `REQ-REL-4cef9c7b` — Re-install of managed programs, hash mismatch of an installed download.
- `REQ-DATA-532b02f5` / `REQ-REL-7d6dc443` — `vera catalog kit` builds a complete platform kit or none.
  `REQ-FUNC-b1afbd8c` / `REQ-SEC-51f93776` / `REQ-FUNC-41582b95` / `REQ-DATA-6cd3e1ec` — the bench installs from it
  with the manifest hashes, refuses a changed file, and points uv at it.

## Files

- `tests/plugins/binutils.test.ts` — ordered find roots, prompt filtering and optional offline real-archive acceptance of combined provisioning.
- `05_Software/src/libraries/core/src/plugins/provisioning.ts` — Provisioner, uv environment, probes, find search, downloads.
- `05_Software/src/libraries/core/src/plugins/archive.ts` — streaming zip extraction, tree check, system tar command.
- `05_Software/src/libraries/core/src/plugins/provisioning.test.ts`, `archive.test.ts` — scripted-host and file-system tests.
- `05_Software/src/libraries/shared/src/plugin-provisioning.test.ts` — range, download form, statuses, channels, settings.
- `05_Software/tests/integration/provisioning.test.ts` — real system tar and a real probed program.
- `05_Software/src/apps/cli/src/plugin.ts`, `provisioning.ts` — `vera plugin install` and the CLI provisioner.
- `05_Software/src/uv/uv-manifest.json`, `02_Tools/environment/prepare-uv.mjs` — the pinned uv.
- `05_Software/src/libraries/core/src/plugins/dependency-kit.ts`, `dependency-kit.test.ts` — offline dependency kit plan and writer.
- `05_Software/src/apps/cli/src/kit-tools.ts` — the kit build's uv/pip tools; `catalog-args.test.ts` — `catalog kit` arguments.

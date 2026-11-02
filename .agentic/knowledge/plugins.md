# Plugins

## Routing

Select for plugin.yaml validation, the installed plugin store under `<userData>/plugins`,
install.json, the integrity hash ("changed since review"), install from a folder or zip, uninstall,
plugin listing issues, `plugins.enabled` in workbench.yaml and the `plugins.*` IPC channels; also for
running plugin programs: the `ProcessHost` port, `ProgramRunner`, run logs in `.vera/runs/`, timeouts,
Stop and process-tree kills, background runs, the serial-port guard and launcher quoting. Start at
`05_Software/src/libraries/shared/src/plugins.ts` (schema),
`05_Software/src/libraries/core/src/plugins/store.ts` (store) or
`05_Software/src/libraries/core/src/plugins/runner.ts` (runner); focused tests sit next to each, and
real processes run in `05_Software/tests/integration/process-hosts.test.ts`.
[Workbench](workbench.md) owns workbench.yaml, its write queue and warnings; [Skills](skills.md)
owns Agent Skills discovery (plugin skills are not loaded yet); [IPC boundary](ipc-boundary.md)
owns channel registration and frame authorization.

## Purpose and boundaries

Shared defines plugin.yaml format 1, the issue codes and the plugin summaries exchanged over IPC.
Core's `PluginStore` imports a package (folder or zip) into `installed/<id>/` with `install.json`,
lists installed plugins with every issue, loads only issue-free ones and uninstalls them. Every
list and load re-reads the files and recomputes the hash; nothing is cached. Enablement is a list
in each workbench's `.vera/workbench.yaml`, written by `WorkbenchService.togglePlugin`. Desktop main
composes one store at `<userData>/plugins`.

Core's `ProgramRunner` runs a resolved executable with an argument array through the `ProcessHost`
port (`ports.ts`). `NodeProcessHost` implements the port around an injected `spawn`: desktop main
(`main/process-host.ts`) and the CLI (`cli/src/process-host.ts`) pass `child_process.spawn`, and core
never imports `child_process` (Biome boundary). The runner owns the policy: guarded cwd, minimal
environment, decoded output, tail, log, retention, timeout, Stop, tree kill, background limit and
serial-port guard. Nothing resolves programs, matches rules, asks for approval or provisions tools
yet; no agent tool calls the runner yet. Desktop main and the CLI each compose one runner and stop
its runs on session stop, workbench create/open/close and app exit (CLI: on closing resources).

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

- Runner: `ProcessHost {platform, env, spawn(executable, args, {cwd, env, group, output}) ->
  {pid, exit}, signal(pid, name)}`; `new NodeProcessHost(spawn)`; `new ProgramRunner({host, clock,
  toolPaths?, tailChars=12000, maxBackground=4, logsKept=200, killGraceMs=3000, id?})` with
  `start(request)` -> `ProgramRun {id, done, read(), stop()}`, `run(request)` -> `RunResult
  {runId, exitCode, signal, error?, durationMs, output, truncated, log, timedOut, stopped}`,
  `get(handle)`, `stopSession(id)`, `stopWorkbench(root)`, `stopAll()`; helpers
  `programEnvironment`, `serialPorts`, `launcherArgs(launcher, command, "argv" | "string")`.

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
- Every program starts with `shell: false`, `windowsHide: true`, stdio `[ignore, pipe, pipe]` (stdin
  closed) and, off Windows, `detached` so it leads its own process group.
- The environment holds only PATH (tool paths first), SystemRoot, HOME, USERPROFILE, TEMP, TMP,
  TMPDIR, LANG, LANGUAGE and LC_* from the host, then the program's variables, then PYTHONUTF8=1 and
  NO_COLOR=1; names compare case-insensitively on Windows, so one PATH key remains.
- `cwd` resolves through `PathGuard` and must be a directory, else DENIED; a symlinked `.vera/runs`
  is DENIED. All refusals (DENIED, BUSY) happen before anything is spawned.
- Timeout, Stop, abort and the lifecycle stops kill the tree: Windows
  `%SystemRoot%\System32\taskkill.exe /T /F /PID <pid>`; Linux SIGTERM to `-pid`, SIGKILL 3 s
  later unless the group is gone. `done` settles on the host's exit: both pipes closed, or at most
  2 s (`closeGraceMs`) after the program exited, when a descendant still holds them (pipes destroyed).
  `NodeProcessHost` turns a synchronous spawn throw (EINVAL, NUL argument) into a start error.
- Output: one UTF-8 decoder (U+FFFD for invalid bytes) and one ANSI stripper per stream; escapes
  split across chunks are held back up to 4096 characters. The result carries the last 12 000
  characters; `.vera/runs/<ULID>.log` keeps all of it, plus a line naming a start error. After a run
  opens its log, ULID-named logs beyond the newest 200 are deleted, except logs of unfinished runs;
  a log that cannot be deleted is skipped and never blocks the run.
- At most 4 unfinished background runs per session (BUSY `{limit}`). A run naming a serial port
  (`COM<n>` with optional `\\.\`, upper-cased; `/dev/tty*`; `/dev/serial/by-id/*`; whole argument or
  the value of `--name=value`) that an unfinished background run also names is BUSY `{handle, port}`.
- `launcherArgs` in `string` mode wraps each token in double quotes, doubles trailing backslashes and
  refuses (INVALID `{index}`) a token with `" ' & | ; < > ^ % $`, a backtick, NUL or a line break.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Manifest field or limit | `pluginManifestSchema` in shared `plugins.ts` | `shared/src/plugins.test.ts` |
| Import, limits, hash, list, load, uninstall | `PluginStore`, `readFolder`, `readZip`, `examine` in `core/src/plugins/store.ts` | `core/src/plugins/store.test.ts` |
| Workbench enablement or warnings | `workbench.ts` (`plugins`, `configWarnings`), `WorkbenchService.togglePlugin` | `shared/src/workbench.test.ts`, `core/src/workbench/service.test.ts` |
| IPC or mock | `ipc.ts` `plugins.*`, desktop `main/index.ts`, `renderer/mocks/mockApi.ts` | `shared/src/plugins-ipc.test.ts`, `renderer/mocks/mockApi.test.ts` |
| Run policy: env, cwd, log, retention, background, serial guard | `core/src/plugins/runner.ts` | `core/src/plugins/runner.test.ts` |
| Spawn options or tree kill | `node-process-host.ts`, `process-tree.ts` | `node-process-host.test.ts`, `process-tree.test.ts`, `tests/integration/process-hosts.test.ts` |
| Decoding, ANSI, tail | `core/src/plugins/run-output.ts` | `run-output.test.ts` |
| Launcher quoting | `core/src/plugins/launcher.ts` | `launcher.test.ts` |
| Runner lifecycle in the apps | desktop `main/index.ts`, `cli/src/run.ts` | inspection; `process-hosts.test.ts` for the hosts |

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
- `REQ-FUNC-e08c858b` — arguments reach the program unchanged, no shell.
- `REQ-FUNC-dbcd3311` — stdin is closed.
- `REQ-SEC-f5c114de` — minimal environment without VERA's credentials.
- `REQ-FUNC-cb84887a` / `REQ-SEC-7a6c3f5f` — guarded cwd; DENIED outside, ignored or not a directory.
- `REQ-FUNC-58d65f31` / `REQ-FUNC-691dd257` — timeout and Stop/abort kill the tree.
- `REQ-PLAT-8423a400` / `REQ-PLAT-c76610c6` — taskkill on Windows; process group SIGTERM then SIGKILL on Linux.
- `REQ-FUNC-2871462b` — UTF-8 decoding and ANSI removal across chunks.
- `REQ-FUNC-85bf8a14` / `REQ-DATA-6491c211` / `REQ-DATA-49ebfb15` — 12 000-character tail, full ULID log, newest 200 kept.
- `REQ-FUNC-b7e0b968` / `REQ-FUNC-f678fbd7` — background runs, incremental reads, at most 4 per session.
- `REQ-FUNC-39d5e6d9` — session stop, workbench close and app exit stop runs.
- `REQ-SEC-016c9aad` — serial-port guard.
- `REQ-FUNC-efbc6124` / `REQ-SEC-7b3e7ed4` — launcher composition and metacharacter refusal.
- `REQ-REL-e594e725` — a program that cannot start reports its error code.
- `REQ-NFR-d056ff66` — core never imports child_process.

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
- `05_Software/src/libraries/core/src/ports.ts` — `ProcessHost`, `SpawnedProcess`, `ProcessExit`.
- `05_Software/src/libraries/core/src/plugins/runner.ts` — ProgramRunner, environment, serial ports.
- `05_Software/src/libraries/core/src/plugins/node-process-host.ts` — Node ProcessHost with injected spawn.
- `05_Software/src/libraries/core/src/plugins/process-tree.ts` — taskkill and process-group kill.
- `05_Software/src/libraries/core/src/plugins/run-output.ts` — OutputDecoder, TailBuffer.
- `05_Software/src/libraries/core/src/plugins/launcher.ts` — launcher arguments and quoting.
- `05_Software/src/apps/desktop/src/main/process-host.ts`, `05_Software/src/apps/cli/src/process-host.ts` — inject `child_process.spawn`.
- `05_Software/tests/integration/process-hosts.test.ts` — real runs through both compiled hosts.
- `05_Software/tests/fixtures/echo-program/echo.mjs` — the echo-program fixture.

# Plugins

## Routing

Select for plugin.yaml validation, the installed plugin store under `<userData>/plugins`,
install.json, the integrity hash ("changed since review"), install from a folder or zip, uninstall,
plugin listing issues, `plugins.enabled` in workbench.yaml and the `plugins.*` IPC channels; also for
running plugin programs: the `ProcessHost` port, `ProgramRunner`, run logs in `.vera/runs/`, timeouts,
Stop and process-tree kills, background runs, the serial-port guard and launcher quoting; and for rule
matching, risk levels, the mode matrix, trial plugins, run_program approval requests, typed
confirmation and the irreversible rules listed by the bypass warning. Start at
`05_Software/src/libraries/shared/src/plugins.ts` (schema),
`05_Software/src/libraries/core/src/plugins/store.ts` (store),
`05_Software/src/libraries/core/src/plugins/runner.ts` (runner),
`05_Software/src/libraries/shared/src/program-rules.ts` (matcher and policy) or
`05_Software/src/libraries/core/src/plugins/program-request.ts` (approval requests); focused tests sit
next to each, the gate's run_program branch is tested in `core/src/agent/program-approvals.test.ts`,
and real processes run in `05_Software/tests/integration/process-hosts.test.ts`.
[Workbench](workbench.md) owns workbench.yaml, its write queue and warnings; [Skills](skills.md)
owns Agent Skills discovery (plugin skills are not loaded yet); [IPC boundary](ipc-boundary.md)
owns channel registration and frame authorization; [Sessions](sessions.md) owns the ApprovalGate
lifecycle, and [Chat UI](chat-ui.md) and [Renderer foundation](renderer-foundation.md) own the
approval card and the permission picker that show program approvals and the bypass warning.

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
serial-port guard.

Shared `program-rules.ts` classifies a command line with the declaring plugin's rules and maps
(permission mode, risk, trial) to a policy; the matcher, policy table and confirmation word are
specified in `.agentic/specs/REQ-FUNC-80b2033a.md`. Core `program-request.ts` finds the one enabled
plugin declaring a program and prepares the frozen `run_program` ChangeRequest with the hashes of the
workbench files its arguments name. The ApprovalGate decides that request by policy: safe commands of
non-trial plugins run without a record, refused ones return `aborted`, mode decisions are recorded as
`decided_by: mode`, the rest wait for the user, irreversible ones with the typed word checked in
core. Nothing resolves executables or provisions tools yet, and no agent tool prepares or runs
programs yet (PLG-04 composes find, prepare, request, re-prepare, consume and the runner). Desktop main and the CLI each compose one runner and stop
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
- Rules (shared): `classifyCommand(rules, program, args)` -> `{risk, notes, confirm}`,
  `programArgumentRefusal(args)` -> `{reason: count|length|control|argument-file, index?}` or null,
  `programPolicy(mode, risk, trial)` -> `run|refuse|mode|user|confirm`, `confirmationMatches(word,
  typed)`, `programCommandLine(program, args)`, `PROGRAM_ARGUMENTS {count 64, length 4096}`,
  `programApprovalSchema` (the event payload) and `validProgramApproval`.
- Requests (core): `findProgram(enabled, program)` -> LoadedPlugin, DENIED `{reason: undeclared |
  ambiguous}`; `prepareProgramRequest({workbench, plugin, program, executable, args, cwd?, sessionId,
  turnId, callId, signal?})` -> frozen `ProgramChangeRequest {tool "run_program", workbench, sessionId,
  turnId, callId, pluginId, pluginSha256, trial, program, executable, programVersion, args, cwd, risk,
  confirm, notes, files[{arg, path, sha256}]}`; `programApproval(request)` -> event payload.
- Summaries: `pluginInstalledSchema.irreversible` lists `{match, note?}` of a plugin without issues;
  `plugins.list` carries it.

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
- Matching costs O(pattern tokens × command tokens) per rule (a failed `*` is never retried from a
  later token). Matching lowercases every token, turns `_` into `-` and splits `--name=value` into two tokens, for
  the command and the pattern alike; a pattern must cover the whole command line. All matching rules
  apply, the highest risk wins (blocked > irreversible > device-write > device-read > safe), notes of
  every matching rule are kept once in manifest order, and an unmatched command is device-write.
- Before any rule or file: more than 64 arguments, an argument over 4096 characters, NUL/CR/LF or a
  leading `@` is DENIED with its reason; a program not declared by the plugin is DENIED undeclared.
- `files` lists each argument (or `--name=value` value) that resolves, relative to cwd or absolute
  inside the workbench, through the workbench PathGuard to an existing regular file, with its SHA-256;
  everything else is an ordinary argument. On Windows `app.bin.`, `app.bin ` and `app.bin::$DATA` bind
  `app.bin`, the file Windows opens. A guard-accepted file that cannot be read fails the request.
  Limit: on Linux a real file whose name the guard reserves (`aux.bin`, `con.txt`, a trailing dot) is
  not bound. A changed file changes the digest, so consuming the
  approval with the re-prepared request is CONFLICT.
- The confirmation word of an irreversible command is the token matched by the first non-wildcard
  pattern token after the program in the first matching irreversible rule, else the program name.
  `decide` under policy `confirm` refuses missing or different typed text with INVALID
  `approval.confirmMismatch` (still pending) and refuses `switchToAutoEdit` with INVALID.
- Switching to bypass approves pending non-trial program approvals by mode; trial ones keep waiting.
  A mode-decided program approval consumes only while the current policy is still `mode`.
- Desktop main redacts known credentials from the program payload (executable, args, cwd, notes, file
  paths) of events and snapshots; the confirmation word is not redacted.

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
| Matching, policy table, confirmation word | `shared/src/program-rules.ts` | `shared/src/program-rules.test.ts` |
| Program request, files, lookup | `core/src/plugins/program-request.ts` | `program-request.test.ts` |
| Gate decisions for run_program | `core/src/agent/approvals.ts` | `core/src/agent/program-approvals.test.ts` |
| Card, bypass warning, mock | renderer `approval-card.tsx`, `permission-picker.tsx`, `mocks/sessions.ts` | `permission-picker.test.ts`, `mocks/sessions.test.ts`, `tests/e2e/program-approvals.spec.ts` |
| CLI typed confirmation | `cli/src/approval-prompt.ts`, `run.ts` | `cli/src/approval-prompt.test.ts` |

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
- `REQ-FUNC-5bb9429f` / `REQ-FUNC-80b2033a` — token normalisation and pattern grammar (spec REQ-FUNC-80b2033a.md).
- `REQ-FUNC-2819a97e` / `REQ-FUNC-9ca99463` — highest risk wins; unmatched is device-write.
- `REQ-SEC-28b53f44` — pre-rule argument refusals.
- `REQ-SEC-59880d86` / `REQ-SEC-a4d1ac21` — undeclared and ambiguous programs refused.
- `REQ-FUNC-8d305364` / `REQ-SEC-94998c85` / `REQ-SEC-2b4bcdf5` — mode matrix, blocked, trial override.
- `REQ-DATA-b4e317de` / `REQ-SEC-f98d4fd3` — run_program request with file hashes; a changed file voids it.
- `REQ-SEC-e8695b28` / `REQ-SEC-08fbf962` / `REQ-SEC-f40ac584` — typed word, mismatch, no switch.
- `REQ-FUNC-43114b84` / `REQ-SEC-ce28991b` — bypass switch approvals; mode decisions revoked on mode change.
- `REQ-UX-9744e270` / `REQ-UX-12185f60` — approval card; bypass warning lists irreversible rules.
- `REQ-DATA-3f62c8c1` — irreversible rules in plugin summaries.
- `REQ-FUNC-7cf311ae` — CLI typed confirmation.

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
- `05_Software/src/libraries/shared/src/program-rules.ts` — matcher, refusals, policy, typed word, approval payload schema.
- `05_Software/src/libraries/core/src/plugins/program-request.ts` — findProgram, prepareProgramRequest, programApproval.
- `05_Software/src/libraries/core/src/plugins/program-fixtures.test-support.ts` — LoadedPlugin fixture for tests.
- `05_Software/src/libraries/core/src/agent/approvals.ts` — the gate's run_program branch.
- `05_Software/src/apps/desktop/src/renderer/components/session/approval-card.tsx` — program card and typed field.
- `05_Software/src/apps/desktop/src/renderer/components/permission-picker.tsx` — bypass warning rule list.
- `05_Software/tests/e2e/program-approvals.spec.ts` — browser-mock e2e of the card and the warning.

# Plugin program runner

## Routing

Select for running plugin programs: the `ProcessHost` port, `ProgramRunner`, run logs and run records in
`.vera/runs/`, timeouts, Stop and process-tree kills, background runs, the serial-port and volume guards,
launcher quoting and the `runs.*` channel schemas. Start at `05_Software/src/libraries/core/src/plugins/runner.ts`
(runner); focused tests sit next to it and real processes run in
`05_Software/tests/integration/process-hosts.test.ts`.
[Plugin bench resources, leases and HIL plans](plugins-bench-resources.md) owns the runner's `lease`
option, `hold` and `parent`; [Plugin program tools and approvals](plugins-program-tools.md) owns the agent
tools and approvals that start a run; [Plugins page and Runs tab](plugins-ui.md) owns the Runs tab and
the masked run presentation. [Plugins](plugins.md) is the index of the plugin pages.

## Purpose and boundaries

Core's `ProgramRunner` runs a resolved executable with an argument array through the `ProcessHost`
port (`ports.ts`). `NodeProcessHost` implements the port around an injected `spawn`: desktop main
(`main/process-host.ts`) and the CLI (`cli/src/process-host.ts`) pass `child_process.spawn`, and core
never imports `child_process` (Biome boundary). The runner owns the policy: guarded cwd, minimal
environment, decoded output, tail, log, retention, timeout, Stop, tree kill, background limit and
serial-port guard.

## Public interface

- Limits (ADV-03): `limits?()` returns the host's application Background programs per session, Run logs kept and
  Run log size; the runner refreshes them into its shared settings at each start, hold and prune, so a change
  applies to the next run and to running runs' next log write (REQ-FUNC-dd50ebed, REQ-FUNC-ddcd96b8,
  REQ-FUNC-1e7d6449). Desktop main and the CLI pass it.
- Runner: `ProcessHost {platform, env, spawn(executable, args, {cwd, env, group, output}) ->
  {pid, exit}, signal(pid, name)}`; `new NodeProcessHost(spawn)`; `new ProgramRunner({host, clock,
  toolPaths?, tailChars=12000, maxBackground=4, logsKept=200, logBytes=64 MiB, killGraceMs=3000, id?, now?, limits?})` with
  `start(request)` -> `ProgramRun {id, done, read(), stop()}`, `run(request)` -> `RunResult
  {runId, exitCode, signal, error?, durationMs, output, truncated, log, timedOut, stopped}`,
  `get(handle)`, `stopSession(id)`, `stopWorkbench(root)`, `stopAll()`, `list(root)` → `ProgramRunInfo[]`
  (newest 50), `log(root, id, maxBytes=RUN_LOG_BYTES)` → `{id, text, truncated, running}`, `stopRun(root, id)`;
  `RunRequest.label {plugin, program, args}` names a run in its record; helpers
  `programEnvironment`, `serialPorts`, `launcherArgs(launcher, command, "argv" | "string", platform?)`
  and `programInvocation(resolved, args)`. `RunRequest.programArgs` carries original tokens for serial locking.
- Built-in command records carry optional strict `command: {text,cwd}` metadata in format 1; only the command tool supplies it and the runner captures canonical cwd. Declared plugin names never classify commands. Runs shows actual command/folder, a scrolling last-12000-character output tail polling each second, elapsed/final duration and exit code, retaining current-session filtering. Running logs retain the existing live dialog; finished logs open a `runId` target in the existing text viewer through full=true. Full and tail reads fill the stat-sized byte window even across short reads, keep workbench-owned ULID identity and refuse linked/nonregular logs. UI Stop uses the existing tree kill; subsequent session-owned program_output includes stopped=true. Local raw logs remain unchanged. Focused acceptance: command-tools/runner/shared IPC/Runs/document-tabs tests, native `tests/e2e/command-runs.spec.ts` and `tests/support/command-runs-platform-probe.ts` for pinned WSL2 Linux.
- Runs (shared): `programRunIdSchema` (ULID), `programRunRecordSchema` (format 1), `programRunSchema` (adds
  `state: running|exited|stopped|timedOut|interrupted` and `log`), `programRunLogSchema`. IPC `runs.list
  {workbenchId}` → `{runs}`, `runs.log {workbenchId, id, full?}`, `runs.stop {workbenchId, id}`; another workbench id
  is CONFLICT, a run id without a log or not running there is NOT_FOUND. The browser mock seeds one running
  and one ended run per workbench and answers the review with an echo-tools-like manifest.

## Invariants

- Windows minimal program environments preserve PATHEXT case-insensitively.
- Every program starts with `shell: false`, `windowsHide: true`, stdio `[ignore, pipe, pipe]` (stdin
  closed; a run with `input` gets stdin as a pipe that receives exactly the input and is then closed, an early exit's
  EPIPE ignored) and, off Windows, `detached` so it leads its own process group. Provisioner probes and uv calls start
  the same way: started detached on Windows, a console program such as KiCad's kicad-cli prints nothing.
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
  the value of `--name=value`) that another unfinished run of the runner also names, foreground or
  background, is BUSY `{handle, port}`. Off Windows a device path is compared by the device its links
  resolve to (`ProgramRunnerOptions.devicePath`, realpath by default), so a `/dev/serial/by-id` link and its
  `/dev/tty*` device are one port; an unresolvable path stays as written. With a lease registry each such port is
  also a non-actuating lease of kind `serial` (alias = the port, key `serial:<port>`), taken in the same `acquire` as
  the run's registry claims and released when the run settles, so a port another VERA process (desktop app or CLI)
  holds is BUSY `{resource: <port>, holder}`; a stale port lease is replaced without a state marker. Without a lease
  registry the in-process guard alone applies.
- A run naming a volume with `--volume <value>` or `--volume=<value>` (the circuitpython plugin's CIRCUITPY drive)
  claims `volume:<value>`: a Windows drive as `<LETTER>:`, an absolute path as `devicePath` resolves it (as written when
  that throws), trailing separators removed. Another unfinished run of the runner naming or claiming that key is BUSY
  `{handle, resource}`; with a lease registry it is also a non-actuating lease of kind `volume`, taken and released with
  the run's other claims (BUSY `{resource, holder}` across processes). `volumeKeys(args, resolve)` is exported.
- Format 1 requires `launcherMode: argv|string` iff `launcher` is present, with a find installation.
  Find locates launcher[0]; the resolver carries its remaining prefix and `{command, mode, platform}`.
  `programInvocation` builds probe and run argv. String launchers bind the generated invocation in
  `executableArgs`; original agent args still drive risk rules, file hashes and serial-port locking.
- `launcherArgs` in `string` mode wraps each token in double quotes, escapes all backslashes for Bash,
  keeps them literal for PowerShell with a generated call operator before the quoted executable, and
  refuses (INVALID `{index}`) a token with `" ' & | ; < > ^ % $`, a backtick, NUL or a line break.
- `runs.list` arguments, explicit command text/canonical cwd and errors and `runs.log` text reach the renderer with known credentials redacted; a
  truncated log tail starts after its first line break.
- A run record holds the agent's arguments only, never the executable, download prefix or program prefix.
  It is written right before spawn and rewritten at the end before `done` settles (through a temporary file
  and a rename), so a list after Stop reads `stopped`; the last stop check follows the first write. Record writes are best effort; pruning removes a run's log and record
  together and never an unfinished run's. A run that never spawned (a failed `beforeSpawn`) has a log only.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Run policy: env, cwd, log, retention, background, serial guard | `core/src/plugins/runner.ts` | `core/src/plugins/runner.test.ts` |
| Spawn options or tree kill | `node-process-host.ts`, `process-tree.ts` | `node-process-host.test.ts`, `process-tree.test.ts`, `tests/integration/process-hosts.test.ts` |
| Decoding, ANSI, tail | `core/src/plugins/run-output.ts` | `run-output.test.ts` |
| Launcher quoting | `core/src/plugins/launcher.ts` | `launcher.test.ts` |
| Runner lifecycle in the apps | desktop `main/index.ts`, `cli/src/run.ts` | inspection; `process-hosts.test.ts` for the hosts |
| Run records, list, log, stop | `ProgramRunner` in `runner.ts`, `runs.*` in `main/index.ts`, label in `program-tools.ts` | `runner.test.ts`, `program-tools.test.ts` |

## Key behaviors

- `REQ-FUNC-e08c858b` — original argument values reach the process host unchanged, no shell.
- `REQ-FUNC-dbcd3311` — stdin ends at once: closed, or the run's input then end of input.
- `REQ-SEC-f5c114de` — minimal environment without VERA's credentials.
- `REQ-REL-380ee422` — provisioner probes and uv calls are not detached on Windows (process group only elsewhere).
- `REQ-FUNC-cb84887a` / `REQ-SEC-7a6c3f5f` — guarded cwd; DENIED outside, ignored or not a directory.
- `REQ-FUNC-58d65f31` / `REQ-FUNC-691dd257` — timeout and Stop/abort kill the tree.
- `REQ-PLAT-8423a400` / `REQ-PLAT-c76610c6` — taskkill on Windows; process group SIGTERM then SIGKILL on Linux.
- `REQ-FUNC-2871462b` — UTF-8 decoding and ANSI removal across chunks.
- `REQ-FUNC-85bf8a14` / `REQ-DATA-6491c211` / `REQ-DATA-49ebfb15` — 12 000-character tail, full ULID log, newest 200 kept.
- `REQ-FUNC-b7e0b968` / `REQ-FUNC-f678fbd7` — background runs, incremental reads, at most 4 per session.
- `REQ-FUNC-39d5e6d9` — session stop, workbench close and app exit stop runs.
- `REQ-SEC-016c9aad` / `REQ-FUNC-868fc8ab` — serial-port guard for foreground and background holders; Linux links resolved.
- `REQ-FUNC-b9a25608` — serial-port leases across VERA processes (identity kind `serial`).
- `REQ-FUNC-96c2f1de` — volume leases across VERA processes (identity kind `volume`).
- `REQ-FUNC-efbc6124` / `REQ-SEC-7b3e7ed4` — launcher composition and metacharacter refusal.
- `REQ-REL-e594e725` — a program that cannot start reports its error code.
- `REQ-NFR-d056ff66` — core never imports child_process.
- `REQ-DATA-10e10001` / `REQ-FUNC-10e10002` / `REQ-FUNC-10e10004` — explicit vendor launcher transport, probes and prompt/run support.
- `REQ-SEC-10e10003` / `REQ-SEC-10e10005` / `REQ-SEC-10e10006` — string refusals, generated invocation approvals and original-argument serial locking.
- `REQ-DATA-f563074f` / `REQ-FUNC-39617f81` / `REQ-FUNC-f024d73c` / `REQ-FUNC-8c38d223` — run records, runs list, log tail, stop (spec REQ-DATA-f563074f.md).

## Files

- `05_Software/src/libraries/core/src/ports.ts` — `ProcessHost`, `SpawnedProcess`, `ProcessExit`.
- `05_Software/src/libraries/core/src/plugins/runner.ts` — ProgramRunner, environment, serial ports, leases and supervision.
- `05_Software/src/libraries/core/src/plugins/node-process-host.ts` — Node ProcessHost with injected spawn.
- `05_Software/src/libraries/core/src/plugins/process-tree.ts` — taskkill and process-group kill.
- `05_Software/src/libraries/core/src/plugins/run-output.ts` — OutputDecoder, TailBuffer.
- `05_Software/src/libraries/core/src/plugins/launcher.ts` — launcher arguments and quoting.
- `05_Software/src/apps/desktop/src/main/process-host.ts`, `05_Software/src/apps/cli/src/process-host.ts` — inject `child_process.spawn`.
- `05_Software/tests/integration/process-hosts.test.ts` — real runs through both compiled hosts.
- `05_Software/tests/fixtures/echo-program/echo.mjs` — the echo-program fixture.
- `05_Software/src/libraries/core/src/plugins/fake-process-host.test-support.ts` — scripted ProcessHost for tests.

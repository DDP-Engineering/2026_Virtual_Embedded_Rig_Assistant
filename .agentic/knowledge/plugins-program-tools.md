# Plugin program tools and approvals

## Routing

Select for the agent's program tools run_program/program_output/program_stop, the ProgramHost and
executable resolver seam, the `<programs>` prompt entries and the timeout cap; for run_program approval
requests, file hashes, typed confirmation and the irreversible rules listed by the bypass warning; and
for the built-in run_command shell tool. Start at
`05_Software/src/libraries/core/src/plugins/program-request.ts` (approval requests) or
`05_Software/src/libraries/core/src/plugins/program-tools.ts` (agent tools); focused tests sit next to
each and the gate's run_program branch is tested in `core/src/agent/program-approvals.test.ts`.
[Plugin manifest and rules](plugins-manifest-rules.md) owns the matcher, the policy table and the
confirmation word; [Plugin program runner](plugins-runner.md) owns the run;
[Plugin provisioning and dependency kits](plugins-provisioning.md) owns the Provisioner behind the
resolver; [Plugin bypass input policy](plugins-bypass.md) owns paths outside the workbench.
[Sessions](sessions.md) owns the ApprovalGate lifecycle, and [Chat UI](chat-ui.md) and
[Renderer foundation](renderer-foundation.md) own the approval card and the permission picker that show
program approvals and the bypass warning. [Plugins](plugins.md) is the index of the plugin pages.

## Purpose and boundaries

Core `program-request.ts` finds the one enabled
plugin declaring a program and prepares the frozen `run_program` ChangeRequest with the hashes of the
files its arguments name through the current host tool policy. The ApprovalGate decides that request by policy: safe commands of
non-trial plugins run without a record, refused ones return `aborted`, mode decisions are recorded as
`decided_by: mode`, the rest wait for the user, irreversible ones with the typed word checked in
core. Core `program-tools.ts` gives the agent run_program (class `program`), program_output and
program_stop over a `ProgramHost {runner, clock, plugins(), resolver}`: find the program, refuse a
unresolved program, prepare the request, let the session ask the gate, then at execution
prepare again, consume the approval and start the runner, whose `beforeSpawn` re-hashes the approved
files. Desktop main (outside instrumented builds that set `VERA_TEST_PROGRAMS`) and the CLI compose
the `Provisioner` as the `ProgramResolver`. Desktop main and the CLI each compose one runner; session stop (core), workbench create/open/close and app exit (CLI: on
closing resources) stop its runs.

Desktop `SessionsHost` caches the `<programs>` entries until a plugin changes.

## Public interface

Built-in shell commands use `plugins/command-tools.ts` and `shell.ts` with the existing runner and
ProgramSession handles. `ProgramHost.shell` resolves current settings and supplies filtered user
environment. `run_command {command,cwd?,timeout?,background?}` requires exact single-use user approval
in Ask and unmatched Auto-edit commands, is absent/refused in Read-only and uses durable mode approval in Bypass. Auto-edit uses current workbench agent.allowed_commands through shared command-prefix policy; complex syntax, executable spelling changes, destructive tool families and dangerous flags cannot inherit or save a prefix. Prefix removal and mode changes are rechecked at exact grant consumption. Explicitly approved shell syntax remains unsandboxed. The shared
program approval payload adapts command display without a plugin risk claim. The request binds the
literal command (at most 4096 characters, matching the run-record argument bound), resolved shell/argv, canonical cwd, original cwd, timeout and background flag.
Original cwd is re-resolved before spawn with host data exclusions and captured Bypass epochs;
run_command also accepts live user-selected additional workbench folders outside Bypass, with
normal command approvals and removal rechecked at apply/spawn. This does not widen run_program,
plugin arguments, indexing or fixed storage authority;
background lifetime excludes the completed turn signal. Commands are arbitrary shell syntax under
OS-account permissions, not a filesystem sandbox. `RunRequest.commandEnvironment` is host-only and
used by built-in commands; declared plugins retain the minimal environment policy. NodeProcessHost
keeps stdin closed; logs remain local raw Program runs logs and output disclosure is scrubbed.
Focused proof: `plugins/{command-tools,shell}.test.ts`, `agent/program-approvals.test.ts`,
`sessions/programs.test.ts` and `tests/integration/commands.test.ts`.

- Requests (core): `findProgram(enabled, program)` -> LoadedPlugin, DENIED `{reason: undeclared |
  ambiguous}`; `prepareProgramRequest({workbench, plugin, program, executable, executableArgs?, args,
  cwd?, sessionId, turnId, callId, signal?, platform?})` -> frozen `ProgramChangeRequest {tool
  "run_program", workbench, sessionId, turnId, callId, pluginId, pluginSha256, trial, program, executable,
  executableArgs, programVersion, args, cwd, risk, confirm, notes, files[{arg, path, sha256}]}`; `programApproval(request)` -> event payload.
- Agent tools (core `program-tools.ts`): `run_program {program, args?, cwd?, timeout? 1..3600 s,
  background?}` -> foreground `{exitCode, durationMs, risk, output, truncated, log, timedOut?, stopped?,
  signal?, error?}` or background `{handle, risk, log}`; `program_output {handle, waitMs? 0..30000,
  until? 1..512}` -> `{output, truncated, running, exitCode?, matched?}`; `program_stop {handle}` ->
  `{exitCode, stopped, timedOut, durationMs, output, truncated, log}`. `ProgramResolver.resolve(plugin,
  program)` -> `{executable, prefix?, launcher?, env?, version?}` or undefined; `unresolvedPrograms`; `ProgramHost`;
  `ProgramSession` (per-session handles); `programTimeout`; `programError`; `programPromptEntries(host,
  skills)` -> `{name, version, plugin, description, skills}[]`; `DEFAULT_PROGRAM_TIMEOUT` 600 is the default of the Program timeout ceiling (workbench or application, REQ-FUNC-e1d2f670): `programTimeout(..., ceiling)` and `timeoutCap(current, ceiling)` use rule ?? program ?? ceiling; run_program and HIL read `toolLimit(ctx, "programTimeout")`; run_command binds min(requested, Shell command timeout ceiling) into its approval at prepare (REQ-FUNC-ae2806b9).
- `verifyProgramFiles(request, signal?)` re-hashes a request's files (CONFLICT on any difference);
  `RunRequest.beforeSpawn` runs it after the log opens, right before spawn.
- `ResolvedProgram` carries `env` (applied after the manifest env by run_program) and `version` (prompt).

## Invariants

- `files` lists each argument (or `--name=value` value) that resolves, relative to cwd or absolute
  in the host tool scope, through PathGuard to an existing regular file, with its SHA-256;
  outside paths are canonical absolute in Bypass and recognized existing outside files and directories are DENIED in other modes.
  Missing files and opaque values remain ordinary arguments; outside directories receive canonical argument-index/path metadata without content hashing; inside directories receive path validation. On Windows `app.bin.`, `app.bin ` and `app.bin::$DATA` bind
  `app.bin`, the file Windows opens. A guard-accepted file that cannot be read fails the request.
  On Windows each segment loses trailing dots and spaces, then one `::$DATA`, `::$INDEX_ALLOCATION` or
  `:$I30:$INDEX_ALLOCATION` suffix, so `app.bin::$DATA.` and `dir::$INDEX_ALLOCATION/app.bin` bind the
  file Windows opens; a drive-relative `X:rest` resolves from the working directory on its drive and
  from `X:\` elsewhere (programs start without `=X:` variables); `\\.\X:` binds like the plain path,
  `\\?\X:` names are taken literally (no trimming), and a rooted `\x` is on the working directory's
  drive. A remaining `:` names a stream: when its base exists the request is DENIED
  `{reason: stream, index}`. The NT prefix `\??\` reads like `\\?\`, and `//?/` like `\\.\`. Without any
  file-system access, a share path on this machine (`localhost`, loopback addresses such as `[::1]` and
  `0--1.ipv6-literal.net`, the host name with or without a domain, the addresses of its network
  interfaces) and a path below a volume or device (`\\?\Volume{…}\…`, GLOBALROOT) are DENIED
  `{reason: unbound, index}`, while a share path on another host and a bare device (`\\.\COM10`) are
  ordinary arguments that VERA never opens (opening them would connect to that host). Limit: another
  name of this machine (a DNS alias) reads as another host, so such a share path stays unbound. An existing
  workbench file whose name the guard reserves (`aux.bin` on Linux, a literal `app.bin.` reached through
  `\\?\` or `::$DATA` on Windows) is DENIED `{reason: unbound, index}`. A changed file changes the digest, so consuming the approval with the re-prepared request is
  CONFLICT.
- Switching to bypass approves pending non-trial program approvals by mode; trial ones keep waiting.
  A mode-decided program approval consumes only while the current policy is still `mode`.
- The resolver's leading arguments are part of the request (`executableArgs`), so a change of them after
  approval is CONFLICT like a change of the executable.
- run_program prepares only with the session's per-call ids and `consume`; its `execute` always throws,
  so no path runs a program without the approval path. With a host PermissionEngine the re-prepared
  request must equal the allowed one (CONFLICT otherwise). Session stop and delete stop the session's
  background runs; delete also drops its handles.
- run_program: the command line is the resolver prefix, the manifest prefix (`${pluginDir}` = the
  installed folder) and the agent's arguments; env values replace `${workbench}` and `${pluginDir}`;
  rules see only the agent's arguments. An unresolved program, an undeclared or ambiguous
  one and a policy refusal end the call before any approval or spawn, with a message naming the reason
  (risk and mode for refusals; matching notes for blocked commands). After approval the request is prepared again from the current plugins,
  resolver and files and consumed; any difference ends the call and starts nothing. Right before spawn
  the runner re-hashes the approved files. Remaining window: a program opens its files after it starts
  and Node cannot hold share-deny handles on Windows; during a run the agent's own tools wait, so only
  the user, another session or a background run can write in that window.
- Timeout: the agent's value clamped to the cap (largest timeout of the matching rules, else the
  program's, else the Program timeout ceiling, default 600 s); foreground default is the cap; background runs have none unless given.
- Handles are session-scoped; at most 32 are kept, oldest finished first dropped; program_stop removes
  one. program_output polls every 50 ms up to waitMs and tests `until` (flag `m`) against the output
  gathered in the call (its last 12 000 characters), in one node:vm context per call with a 100 ms limit
  per attempt (invalid or slow -> error). A refused start writes a `[VERA] The program did not start`
  line to its run log.
- The prompt lists programs of enabled, issue-free plugins that resolve, including launcher programs, in
  plugin id then name order; the run rule joins the rules only with such programs.
- Desktop `SessionsHost` recomputes `<programs>` entries only when the workbench, its plugin skill list or the
  generation (`invalidatePrograms()`) changes. A plugin edited after install still lists until then, but
  run_program loads plugins on every call and refuses it.
- Desktop main redacts known credentials from the program payload (executable, args, cwd, notes, file
  paths) of events and snapshots; the confirmation word is not redacted.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Program request, files, lookup | `core/src/plugins/program-request.ts` | `program-request.test.ts` |
| Gate decisions for run_program | `core/src/agent/approvals.ts` | `core/src/agent/program-approvals.test.ts` |
| Card, bypass warning, mock | renderer `approval-card.tsx`, `permission-picker.tsx`, `mocks/sessions.ts` | `permission-picker.test.ts`, `mocks/sessions.test.ts`, `tests/e2e/program-approvals.spec.ts` |
| CLI typed confirmation | `cli/src/approval-prompt.ts`, `run.ts` | `cli/src/approval-prompt.test.ts` |
| Agent tools, timeout, until, handles, prompt entries | `core/src/plugins/program-tools.ts` | `program-tools.test.ts` |
| Session wiring, modes end to end, stop | `core/src/sessions/service.ts`, `agent/runtime.ts` | `core/src/sessions/programs.test.ts` |
| Desktop composition, test resolver | `main/sessions.ts`, `main/index.ts`, `main/program-resolver.ts` | `program-resolver.test.ts`, `tests/e2e/program-runs.spec.ts` |
| CLI composition | `cli/src/run.ts` | `tests/integration/cli.test.ts` |

## Key behaviors

- `REQ-SEC-59880d86` / `REQ-SEC-a4d1ac21` — undeclared and ambiguous programs refused.
- `REQ-DATA-b4e317de` / `REQ-SEC-f98d4fd3` — run_program request with file hashes; a changed file voids it.
- `REQ-FUNC-43114b84` / `REQ-SEC-ce28991b` — bypass switch approvals; mode decisions revoked on mode change.
- `REQ-UX-9744e270` / `REQ-UX-12185f60` — approval card; bypass warning lists irreversible rules.
- `REQ-FUNC-7cf311ae` — CLI typed confirmation.
- `REQ-FUNC-bce7d786` / `REQ-FUNC-9b38f5a8` / `REQ-FUNC-8e22989a` / `REQ-FUNC-90a95bef` — run_program
  foreground and background results, command line, timeout cap.
- `REQ-SEC-affac265` / `REQ-SEC-08f730b3` / `REQ-SEC-c730711e` / `REQ-SEC-370f2d9b` / `REQ-SEC-b9d4244f` —
  refusals before approval, policy refusals, re-prepare and consume, re-hash before spawn, credentials.
- `REQ-FUNC-e54f89a4` / `REQ-FUNC-da3adc80` / `REQ-SEC-e9bc4628` / `REQ-FUNC-c6761a12` /
  `REQ-FUNC-b70bb17e` — program_output, waitMs/until, until bound, unknown handles, program_stop.
- `REQ-FUNC-ea2dfb26` / `REQ-FUNC-29dd2b92` — session stop stops runs; tools only with a program host.
- `REQ-FUNC-48cc01a9` / `REQ-FUNC-fa6222a5` — `<programs>` block and its entries.
- `REQ-FUNC-59308834` / `REQ-FUNC-83ad0f58` — CLI composition; native card-driven run.
- `REQ-SEC-0e45a496` / `REQ-SEC-13954028` / `REQ-SEC-43a0b743` / `REQ-SEC-aaeae5cb` — drive-relative,
  aliases, streams, unbindable files outside Windows.
- `REQ-FUNC-10e10009` — blocked refusals include explanatory notes.

## Files

- `05_Software/src/libraries/core/src/plugins/program-request.ts` — findProgram, prepareProgramRequest, programApproval.
- `05_Software/src/libraries/core/src/plugins/program-fixtures.test-support.ts` — LoadedPlugin fixture for tests.
- `05_Software/src/libraries/core/src/agent/approvals.ts` — the gate's run_program branch.
- `05_Software/src/apps/desktop/src/renderer/components/session/approval-card.tsx` — program card and typed field.
- `05_Software/src/apps/desktop/src/renderer/components/permission-picker.tsx` — bypass warning rule list.
- `05_Software/tests/e2e/program-approvals.spec.ts` — browser-mock e2e of the card and the warning.
- `05_Software/src/libraries/core/src/plugins/program-tools.ts` — agent tools, ProgramHost, resolver seam, prompt entries.
- `05_Software/src/libraries/core/src/sessions/programs.test.ts` — replay sessions running echo-tools in every mode.
- `05_Software/src/apps/desktop/src/main/program-resolver.ts` — `VERA_TEST_PROGRAMS` resolver of instrumented builds.
- `05_Software/tests/fixtures/plugins/echo-tools/` — the fixture plugin (program `echo`, skill `echo-guide`).
- `05_Software/tests/e2e/program-runs.spec.ts` — native Electron run through the approval card.

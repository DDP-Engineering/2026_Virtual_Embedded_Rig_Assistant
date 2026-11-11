# Plugins

## Routing

Select for plugin.yaml validation, the installed plugin store under `<userData>/plugins`,
workbench-scoped packages under `.vera/plugins`, machine-local hash trust,
install.json, the integrity hash ("changed since review"), install from a folder or zip, uninstall,
plugin listing issues, `plugins.enabled` in workbench.yaml and the `plugins.*` IPC channels; also for
running plugin programs: the `ProcessHost` port, `ProgramRunner`, run logs in `.vera/runs/`, timeouts,
Stop and process-tree kills, background runs, the serial-port guard and launcher quoting; and for rule
matching, risk levels, the mode matrix, trial plugins, run_program approval requests, typed
confirmation and the irreversible rules listed by the bypass warning; and for the agent's program
tools run_program/program_output/program_stop, the ProgramHost and executable resolver seam, the
`<programs>` prompt entries and the timeout cap; and for provisioning: the bundled uv, install kinds
pip/script/download/find (including find with a pinned download fallback), the runtime folder, version probes and supported ranges, program statuses,
`plugins.programs`/`plugins.provision`, `vera plugin install` and the package index/proxy settings; and for the
desktop UI: the Plugins page (pickers, review screen, install bound to the reviewed hash, workbench draft selection,
program installs, uninstall), run records beside run logs and the right panel's Runs tab (`runs.*`); and for the
plugin catalog client: index read with the bundled fallback, verified zip downloads, the review decision, installs
with the catalog tier, update marks, `plugins.catalog*` IPC, the catalog URL setting, the 24 h checks and the
Plugins page catalog section (spec `.agentic/specs/REQ-DATA-b40d3f9b.md`). Start at
`05_Software/src/libraries/shared/src/plugins.ts` (schema),
`05_Software/src/libraries/core/src/plugins/store.ts` (store),
`05_Software/src/libraries/core/src/plugins/runner.ts` (runner),
`05_Software/src/libraries/shared/src/program-rules.ts` (matcher and policy) or
`05_Software/src/libraries/core/src/plugins/program-request.ts` (approval requests) or
`05_Software/src/libraries/core/src/plugins/program-tools.ts` (agent tools) or
`05_Software/src/libraries/core/src/plugins/provisioning.ts` (provisioning, with `archive.ts`) or
`05_Software/src/apps/desktop/src/renderer/components/plugins.tsx` and `runs-tab.tsx` (UI) or
`05_Software/src/libraries/core/src/plugins/catalog.ts` (catalog client), `catalog-source.ts` (catalog check and
build), shared `plugin-catalog.ts` (formats) and renderer `plugin-catalog.tsx` (catalog section); focused tests sit
next to each, the gate's run_program branch is tested in `core/src/agent/program-approvals.test.ts`,
and real processes run in `05_Software/tests/integration/process-hosts.test.ts` and
`05_Software/tests/integration/provisioning.test.ts`. [Native packaging](native-packaging.md) owns `prepare:uv`
and the `<resources>/uv/` payload; [Headless CLI](headless-cli.md) owns the `vera plugin install` command.
[Official plugins](official-plugins.md) owns the shipped plugin packages in `05_Software/plugins/` (today
`serial-monitor`, `esp32-esptool`, `esp32-idf` and `binutils`) and that folder's catalog source files (`packs.yaml`, `catalog.yaml`). [Workbench](workbench.md) owns workbench.yaml, its write queue and warnings; [Skills](skills.md)
owns Agent Skills discovery, plugin skills included; [IPC boundary](ipc-boundary.md)
owns channel registration and frame authorization; [Sessions](sessions.md) owns the ApprovalGate
lifecycle, and [Chat UI](chat-ui.md) and [Renderer foundation](renderer-foundation.md) own the
approval card and the permission picker that show program approvals and the bypass warning.

## Purpose and boundaries

Shared defines plugin.yaml format 1, the issue codes and the plugin summaries exchanged over IPC.
Core's `PluginStore` imports a package (folder or zip) into `installed/<id>/` with `install.json`,
lists installed plugins with every issue, loads only issue-free ones and uninstalls them. Every
list and load re-reads the files and recomputes the hash; nothing is cached. Enablement is a list
in each workbench's `.vera/workbench.yaml`, written by `WorkbenchService.togglePlugin`. Desktop main
composes one global store at `<userData>/plugins` and workbench-bound views.

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
core. Core `program-tools.ts` gives the agent run_program (class `program`), program_output and
program_stop over a `ProgramHost {runner, clock, plugins(), resolver}`: find the program, refuse a
unresolved program, prepare the request, let the session ask the gate, then at execution
prepare again, consume the approval and start the runner, whose `beforeSpawn` re-hashes the approved
files. Desktop main (outside instrumented builds that set `VERA_TEST_PROGRAMS`) and the CLI compose
the `Provisioner` as the `ProgramResolver`. Desktop main and the CLI each compose one runner; session stop (core), workbench create/open/close and app exit (CLI: on
closing resources) stop its runs.

Core's `Provisioner` (`provisioning.ts`) installs and locates declared programs under
`<userData>/plugins/runtime/` (spec `.agentic/specs/REQ-FUNC-714e26bc.md`): `install(id)` is the user's action
(desktop `plugins.provision`, CLI `vera plugin install`), `statuses(id)` and `resolve(plugin, program)` never
install. pip and script programs run the bundled uv (pinned by `src/uv/uv-manifest.json`) with every uv folder
inside the runtime and one managed CPython 3.13; downloads are verified, extracted (zip in core through
`archive.ts`, tar archives through the system tar) and kept per SHA-256; find programs are searched on PATH and
absolute globs. Format-1 find may include a download fallback: by default a found executable is probed first, and a miss permits only the user-triggered installer to fetch. A failed found probe remains unavailable. With `preferDownload: true`, an installed managed executable is selected before discovery, and a discovery result with a managed entry for the host reports `downloadAvailable` so the user can still provision. Combined statuses use kind download and the review screen lists both sources. Archive entry points share the SHA-256 tree but retain separate recorded versions. Launchers remain find-only. Versions come from probes, are recorded in install.json and checked against `version.range`.
Desktop `SessionsHost` caches the `<programs>` entries until a plugin changes.

The desktop UI (spec `.agentic/specs/REQ-DATA-f563074f.md`): the sidebar's Plugins page
(`renderer/components/plugins.tsx`) installs in two steps, `plugins.choose` (native picker) and `plugins.review`
(the store reads and validates the package, installs nothing), then `plugins.install {path, sha256}` with the
reviewed hash. It lists installed plugins with their program statuses and issues, installs programs (`plugins.provision`) and uninstalls after a
confirmation. The runner writes `.vera/runs/<run id>.json` beside each log; the right panel's Runs tab
(`renderer/components/runs-tab.tsx`) lists them (`runs.list`, polled every second), shows a log (`runs.log`) and
stops a run (`runs.stop`). WorkbenchConfigForm's Plugins section embeds WorkbenchPlugins: installed packages are draft checkboxes saved through workbench.create or workbench.config.update with plugins.enabled. New workbenches default to none; existing choices are retained. Missing/invalid selected entries can be removed; invalid or untrusted packages cannot be newly selected. Read-only/pending forms disable controls; list failures show retry and do not clear the draft. Cancel performs no activation write. The global manager has no enable switches and points to Edit workbench → Plugins. Scoped package trust remains a separate action.

The plugin catalog (spec `.agentic/specs/REQ-DATA-b40d3f9b.md`, ADR-0019): core `catalog-source.ts` checks a catalog
source (plugin folders, `packs.yaml`, `catalog.yaml`) with the store's own package reader and builds its release
(`<id>-<version>.zip` per plugin and `index.json` format 1); the CLI's `vera catalog check|build` are the catalog's CI
and release steps. Core `PluginCatalog` (`catalog.ts`) is the client: it reads `index.json` from the catalog folder URL
(settings `plugins.catalog`, else the build input `VERA_PLUGIN_CATALOG_URL`), else from the bundled release of the
official plugins, verifies each zip's size and SHA-256 against the index, keeps it for the review, decides whether the
review must be shown, and installs it bound to the reviewed integrity hash with the entry's tier and source
`catalog` (the zip URL, or the bundled zip's file path). Desktop main
composes it with `net.fetch`, serves `plugins.catalog`, `plugins.catalogReview` and `plugins.catalogInstall`, and its
`CatalogChecks` (`main/catalog-checks.ts`) reads the index after the window opens and every 24 h. The Plugins page
opens the catalog section (`renderer/components/plugin-catalog.tsx`) from the grouped top Catalog control, above the installed list. The index is not
signed (ADR-0019 defers it).

## Authoring

`plugin_validate {path}` reads a confined workbench draft folder and returns schema errors plus warnings
for dangerous tokens in safe/device-read rules, programs without rules, and find without hint.
`plugin_install {path}` is a program-class prepared tool. Its inline review shows the complete manifest;
ApprovalGate always waits for a user decision, including bypass, and refuses read-only. The exact
request binds the draft path, manifest and integrity hash. The store installs only matching bytes as
trial, does not enable or provision, and permits the agent to replace only another trial.

`plugins.promote {id,sha256}` is a user-only IPC action bound to a healthy trial's displayed hash;
it atomically changes install.json tier to local. The Plugins button asks the user to confirm trust.
`plugins.export {id,sha256}` verifies a healthy package and saves a zip through the native save picker,
without install.json or runtime files. A generated zip above the existing 64 MiB archive cap is INVALID before the save picker opens. Promotion and export invalidate/reload the relevant UI state.
The agent has no promotion, enablement or session-mode tools. Its file tools refuse workbench.yaml,
managed application data and multiply linked write targets even in bypass. Trials retain the existing
per-command override and irreversible typed confirmation in every writable mode. The official
create-plugin skill is built into SkillCatalog; CONTRIBUTING.md explains draft/trial/sharing.

Focused proof: core plugins/authoring.test.ts, agent/program-approvals.test.ts, tools/write-edit.test.ts,
renderer plugins.test.ts, tests/integration/plugin-builder.test.ts and tests/e2e/plugin-builder.spec.ts.

## Public interface

- `plugins.check` explicitly refreshes all program probes without installing. Pending checks share package/runtime identity and serialize with provisioning; fresh per-program cache entries are populated together, so passive reads cannot replace a fresh check with a recorded version. A replaced package rejects the pending check. Scoped check observations, including negative states, propagate atomically into the singleton session resolver; concurrent runtime invalidation rejects the older pending check. Scoped passive status reads use the same resolver observations for the verified scoped package, so reopening the page cannot restore a rejected Ready state. Completed checked failures survive later unrelated invalidation, bound to runtime/plugin/program, package SHA, installation timestamp and per-program record. A fresh check or actual provisioning supersedes them. Ready observations clear prior failures and remain in the ordinary resolution cache so missing discovered files are detected after invalidation. Invalid archive selection preserves healthy runtime authority. Ordinary version probes allow30s; declared activation launchers allow120s because observed EIM startup can exceed the ordinary boundary.
- `plugins.installArchive {id,program,sha256,workbenchId?}` uses a native archive picker. Current workbench/database, package hash, program/platform and trust are checked before and after selection. Selected regular bytes are streamed through SHA-256 before cache reuse; staging, extraction confinement and a second identity check precede publication. No URL or hash comes from the selected file. Verified blobs may remain when a later version probe fails.
- Desktop package listing runs the complete PluginStore integrity path in `plugin-list-worker`, with only identical pending scopes coalesced and shutdown termination. No completed integrity result is reused by this seam. Main rechecks current workbench/database before returning.
- The global manager starts with compact accessible rows and unknown dependency state, grouped top catalog/folder/zip/refresh/check-all actions, explicit Check/Install controls, expandable descriptions/program diagnostics, and secondary export/uninstall actions. Find-only tools retain vendor guidance, including when ready, and never enable automatic installation. Ready managed fallbacks keep a correctly labeled Install action. Managed version/range failures permit repair (uv reinstall); discovered hybrid tools explicitly mark external:true and retain the no-replacement policy unless preferDownload permits it. Same-hash reinstallation clears old dependency UI observations. Redaction is followed by schema-length caps. Workbench selection stays draft-only and compact, with no implicit enablement.
- Windows minimal program environments preserve PATHEXT case-insensitively. Managed Python uses pinned uv0.13.7; an exact known minor-link failure can retry once after unlinking only an independently validated runtime-owned alias, never its patch interpreter or an escaping nested Python directory.


- Shared: `pluginManifestSchema`, `validatePluginManifest(data)` → `{manifest?, issues}`,
  `pluginIdSchema`, `pluginRiskSchema`, `pluginTierSchema`, `pluginPlatformSchema`,
  `pluginIssueSchema` (`manifest`, `yaml`, `field`, `id`, `record`, `changed`, `unavailable`, `untrusted`, `collision`),
  `pluginInstalledSchema`, `pluginSummarySchema` (adds `enabled`), `PLUGIN_LIMITS`,
  `isPluginRelativePath`.
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

- Runner: `ProcessHost {platform, env, spawn(executable, args, {cwd, env, group, output}) ->
  {pid, exit}, signal(pid, name)}`; `new NodeProcessHost(spawn)`; `new ProgramRunner({host, clock,
  toolPaths?, tailChars=12000, maxBackground=4, logsKept=200, killGraceMs=3000, id?, now?})` with
  `start(request)` -> `ProgramRun {id, done, read(), stop()}`, `run(request)` -> `RunResult
  {runId, exitCode, signal, error?, durationMs, output, truncated, log, timedOut, stopped}`,
  `get(handle)`, `stopSession(id)`, `stopWorkbench(root)`, `stopAll()`, `list(root)` → `ProgramRunInfo[]`
  (newest 50), `log(root, id, maxBytes=RUN_LOG_BYTES)` → `{id, text, truncated, running}`, `stopRun(root, id)`;
  `RunRequest.label {plugin, program, args}` names a run in its record; helpers
  `programEnvironment`, `serialPorts`, `launcherArgs(launcher, command, "argv" | "string", platform?)`
  and `programInvocation(resolved, args)`. `RunRequest.programArgs` carries original tokens for serial locking.
- Rules (shared): `classifyCommand(rules, program, args)` -> `{risk, notes, confirm, timeout}` (timeout:
  the largest timeout of the matching rules, or null),
  `programArgumentRefusal(args)` -> `{reason: count|length|control|argument-file, index?}` or null,
  `programPolicy(mode, risk, trial)` -> `run|refuse|mode|user|confirm`, `confirmationMatches(word,
  typed)`, `programCommandLine(program, args)`, `PROGRAM_ARGUMENTS {count 64, length 4096}`,
  `programApprovalSchema` (the event payload) and `validProgramApproval`.
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
  skills)` -> `{name, version, plugin, description, skills}[]`; `DEFAULT_PROGRAM_TIMEOUT` 600.
- `verifyProgramFiles(request, signal?)` re-hashes a request's files (CONFLICT on any difference);
  `RunRequest.beforeSpawn` runs it after the log opens, right before spawn.
- Provisioning (core): `new Provisioner({store, root, uv?, host, clock, platform, fetch, settings, timeouts?})`
  with `install(id, signal?)`, `close()`, awaited `drain()` and `statuses(id, signal?)` -> `PluginProgramStatus[]` (name order),
  `resolve(plugin, program, signal?)` -> `{executable, prefix?, env?, version}` or undefined, `invalidate()`,
  `uvEnvironment(plugin)`; `pluginPlatform(platform, arch)`; `UV_PYTHON` "3.13"; `PluginStore.recordPrograms(id,
  sha256, versions)` (CONFLICT when the hash changed); `extractZip`, `checkTree`, `tarCommand`, `ArchiveError`.
- Shared: `pluginProgramStatusSchema` `{name, kind, state: ready|missing|unavailable, version?, range?, hint?,
  link?, problem?, detail?}`, `pluginProgramProblemSchema` (notFound, install, download, sha256, archive,
  platform, uv, version, range), `downloadForm(url)`, `downloadName(entry)`, `versionInRange(version,
  range)`, `urlParts(url)`; settings `pluginSettingsSchema {index?, proxy?}`.
- IPC: `plugins.programs {id}` and `plugins.provision {id}` -> statuses (NOT_FOUND unknown id, INVALID plugin
  with issues); the browser mock answers both. CLI: `vera plugin install --path <folder|zip> --data <dir>`.
- `ResolvedProgram` carries `env` (applied after the manifest env by run_program) and `version` (prompt).
- WorkbenchService `loadPlugins(id)` -> the enabled plugins that load (installed, issue-free,
  unchanged), in plugins.enabled order.
- Summaries: `pluginInstalledSchema.irreversible` lists `{match, note?}` of a plugin without issues;
  `plugins.list` carries it.
- Runs (shared): `programRunIdSchema` (ULID), `programRunRecordSchema` (format 1), `programRunSchema` (adds
  `state: running|exited|stopped|timedOut|interrupted` and `log`), `programRunLogSchema`. IPC `runs.list
  {workbenchId}` → `{runs}`, `runs.log {workbenchId, id}`, `runs.stop {workbenchId, id}`; another workbench id
  is CONFLICT, a run id without a log or not running there is NOT_FOUND. The browser mock seeds one running
  and one ended run per workbench and answers the review with an echo-tools-like manifest.
- Catalog (shared `plugin-catalog.ts`): `catalogIndexSchema` (index.json format 1 `{format, plugins, packs}`),
  `catalogEntrySchema`, `catalogPackSchema`, `catalogPacksSchema` (packs.yaml), `catalogMaintainersSchema`
  (catalog.yaml `{format, official, reviewed}`), `CATALOG_LIMITS`, `DANGEROUS_TOKENS`, `dangerousToken(match)`,
  `compareVersions(a, b)` (semantic version precedence), `catalogUrl(value)` (normalised folder URL or undefined),
  `catalogUrlSchema`, `pluginCatalogViewSchema`, `pluginCatalogReviewSchema`; `ruleNamesProgram(match, program)` in
  `program-rules.ts`; settings `plugins.catalog?`.
- Catalog (core): `checkCatalogSource(folder)` -> `CatalogIssue[] {where, code, detail}`;
  `buildCatalogRelease(folder, out)` -> `{issues, index?}`; `new PluginCatalog({store, root, location, bundled?, fetch,
  now?, uuid?})` with `view({refresh?, signal?})`, `review(id, signal?)`, `install(id, sha256)`; store
  `readPluginPackage(path)` and `install(path, sha256?, origin?: {tier, url})` (source kind `catalog`).
- IPC: `plugins.catalog {refresh}` -> view `{source: remote|bundled|none, url?, problem?: unreachable|invalid,
  checkedAt?, plugins (entries + installed? + update), packs}`; `plugins.catalogReview {id}` -> `{review, id, version,
  tier, required}`; `plugins.catalogInstall {id, sha256}` -> installed summary; app event `plugins.catalog`. The
  browser mock serves an ESP32 pack and a community plugin.
- Renderer: `Plugins({workbench?})` (`renderer/components/plugins.tsx`), `RunsTab({workbenchId})`
  (`renderer/components/runs-tab.tsx`), a `runs` slot in `Shell`.

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
- Format 1 requires `launcherMode: argv|string` iff `launcher` is present, with a find installation.
  Find locates launcher[0]; the resolver carries its remaining prefix and `{command, mode, platform}`.
  `programInvocation` builds probe and run argv. String launchers bind the generated invocation in
  `executableArgs`; original agent args still drive risk rules, file hashes and serial-port locking.
- `launcherArgs` in `string` mode wraps each token in double quotes, escapes all backslashes for Bash,
  keeps them literal for PowerShell with a generated call operator before the quoted executable, and
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
  On Windows each segment loses trailing dots and spaces, then one `::$DATA`, `::$INDEX_ALLOCATION` or
  `:$I30:$INDEX_ALLOCATION` suffix, so `app.bin::$DATA.` and `dir::$INDEX_ALLOCATION/app.bin` bind the
  file Windows opens; a drive-relative `X:rest` resolves from the working directory on its drive and
  from `X:\` elsewhere (programs start without `=X:` variables); `\\.\X:` binds like the plain path,
  `\\?\X:` names are taken literally (no trimming), and a rooted `\x` is on the working directory's
  drive. A remaining `:` names a stream: when its base exists in the workbench the request is DENIED
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
- The confirmation word of an irreversible command is the token matched by the first non-wildcard
  pattern token after the program in the first matching irreversible rule, else the program name.
  `decide` under policy `confirm` refuses missing or different typed text with INVALID
  `approval.confirmMismatch` (still pending) and refuses `switchToAutoEdit` with INVALID.
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
  program's, else 600 s); foreground default is the cap; background runs have none unless given.
- Handles are session-scoped; at most 32 are kept, oldest finished first dropped; program_stop removes
  one. program_output polls every 50 ms up to waitMs and tests `until` (flag `m`) against the output
  gathered in the call (its last 12 000 characters), in one node:vm context per call with a 100 ms limit
  per attempt (invalid or slow -> error). A refused start writes a `[VERA] The program did not start`
  line to its run log.
- The prompt lists programs of enabled, issue-free plugins that resolve, including launcher programs, in
  plugin id then name order; the run rule joins the rules only with such programs.
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
  program until `install` or `invalidate` (desktop main invalidates after plugins.install, uninstall, toggle and
  provision).
- Downloads: at most 2 GiB, hashed while streamed; another SHA-256 is `sha256`; transfer failures and HTTP
  errors are `download`; zip entries must be plugin-relative after `\` -> `/` and are written as plain files
  (no links), tar archives go through `%SystemRoot%\System32\tar.exe` or `/usr/bin/tar` (`/bin/tar`), then every
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
- Desktop `SessionsHost` recomputes `<programs>` entries only when the workbench, its plugin skill list or the
  generation (`invalidatePrograms()`) changes. A plugin edited after install still lists until then, but
  run_program loads plugins on every call and refuses it.
- Desktop main redacts known credentials from the program payload (executable, args, cwd, notes, file
  paths) of events and snapshots; the confirmation word is not redacted.
- The desktop app installs only a package with the hash its review showed; `plugins.review` never writes.
- `runs.list` arguments and errors and `runs.log` text reach the renderer with known credentials redacted; a
  truncated log tail starts after its first line break.
- A run record holds the agent's arguments only, never the executable, download prefix or program prefix.
  It is written right before spawn and rewritten at the end before `done` settles (through a temporary file
  and a rename), so a list after Stop reads `stopped`; the last stop check follows the first write. Record writes are best effort; pruning removes a run's log and record
  together and never an unfinished run's. A run that never spawned (a failed `beforeSpawn`) has a log only.
- The app's QueryClient defaults to `staleTime: Infinity`; the plugin list, program statuses, runs list and run
  log use `staleTime: 0`, so opening the page or a log reads disk state (integrity is rechecked per list).
- Workbench plugin checkboxes read config.plugins.enabled from the draft, not the list response's enabled flags; a package-list refresh cannot overwrite draft choices. Save persists the whole selected list with the other workbench fields; Cancel leaves the saved list unchanged.
- Catalog check: every plugin folder (not starting with `.`) must pass the store's import checks and examination
  (folder name = id, so ids are unique); every program needs a rule whose first pattern token names it; a `safe` or
  `device-read` rule whose pattern contains a dangerous token as a case-insensitive substring is an issue unless
  `catalog.yaml` lists `{plugin, match}` under `reviewed`; packs, `requires`, `official` and `reviewed` must name
  existing plugins and rules. The build writes nothing with any issue or a non-empty output folder; zips are
  deterministic (sorted entries under `<id>/`, dated 1980-01-01).
- Catalog URL: https, or http on localhost/127.0.0.1/[::1], no credentials, query or fragment; an invalid setting
  counts as none. A read whose final redirected URL is neither https nor loopback http is unreachable. A failed or
  invalid remote index falls back to the bundled release with `problem`; the bundled release's own failures leave
  the view `none`. The view is cached per location; `refresh` or a changed location reads again.
- Catalog downloads: an index above 4 MiB is invalid; a zip is read with its entry's `bytes` as the cap and refused
  INVALID `plugins.catalogError.sha256` unless its size and SHA-256 match; a transfer failure is OFFLINE
  `plugins.catalogError.download`; a package whose id or version differs from its entry, or with any issue, is
  INVALID `plugins.catalogError.mismatch`; a lower version than the installed one is CONFLICT
  `plugins.catalogError.downgrade`. A review empties `<userData>/plugins/catalog/` first and keeps only its verified
  zip; install re-hashes it against the entry (CONFLICT when missing or changed) and removes it.
- Catalog reviews and installs run one at a time per `PluginCatalog`, since they share the kept-zip folder. The catalog
  URL form saves only after the settings have loaded: its patch replaces the whole `plugins` object (index, proxy).
- `npm run prepare:plugins` builds a private CLI bundle in `node_modules/.cache` and never rewrites `src/apps/cli/dist`.
- A catalog review is required for a plugin that is not installed, an installed plugin with an issue, or a manifest
  whose `programs` or `rules` (canonical JSON) differ from the installed one; otherwise the page installs at once.
- Catalog checks run at start and every 24 h only while a catalog location is set and the update mode is not Off;
  they read the index only and never install. Install selected reviews the checked groups' plugins that are not
  installed, each after its catalog requirements, one by one; Cancel drops the rest.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Scoped discovery/trust/isolation | `PluginStore` scoped methods, `WorkbenchService.loadPlugins` | `scoped-store.test.ts`, scoped CLI Git fixture in `cli.test.ts`, native scoped `plugins-ui.spec.ts` |
| Manifest field or limit | `pluginManifestSchema` in shared `plugins.ts` | `shared/src/plugins.test.ts` |
| Import, limits, hash, list, load, uninstall | `PluginStore`, `readFolder`, `readZip`, `examine` in `core/src/plugins/store.ts` | `core/src/plugins/store.test.ts` |
| Workbench selection UI | renderer `workbench-plugins.tsx`, `workbench-config-form.tsx`, `workbench-create.tsx`, `workbench-editor.tsx` | `workbench-plugins.test.ts`, native workbench draft case in `plugins-ui.spec.ts` |
| Workbench enablement or warnings | `workbench.ts` (`plugins`, `configWarnings`), `WorkbenchService.togglePlugin` | `shared/src/workbench.test.ts`, `core/src/workbench/service.test.ts` |
| IPC or mock | `ipc.ts` `plugins.*`, desktop `main/index.ts`, `renderer/mocks/mockApi.ts` | `shared/src/plugins-ipc.test.ts`, `renderer/mocks/mockApi.test.ts` |
| Run policy: env, cwd, log, retention, background, serial guard | `core/src/plugins/runner.ts` | `core/src/plugins/runner.test.ts` |
| Spawn options or tree kill | `node-process-host.ts`, `process-tree.ts` | `node-process-host.test.ts`, `process-tree.test.ts`, `tests/integration/process-hosts.test.ts` |
| Decoding, ANSI, tail | `core/src/plugins/run-output.ts` | `run-output.test.ts` |
| Launcher quoting | `core/src/plugins/launcher.ts` | `launcher.test.ts` |
| Runner lifecycle in the apps | desktop `main/index.ts`, `cli/src/run.ts` | inspection; `process-hosts.test.ts` for the hosts |
| Git option roles, helpers, listings and destructive escalation | `shared/src/git-options.ts`, `ProgramTools.request`, manifest `optionSyntax: git` | `tests/integration/git.test.ts` |
| tshark option roles (info, file, capture, unknown, execute, credentials) | `shared/src/tshark-options.ts`, manifest `optionSyntax: tshark` | `tests/integration/wireshark-tshark.test.ts` |
| Matching, policy table, confirmation word | `shared/src/program-rules.ts` | `shared/src/program-rules.test.ts` |
| Program request, files, lookup | `core/src/plugins/program-request.ts` | `program-request.test.ts` |
| Gate decisions for run_program | `core/src/agent/approvals.ts` | `core/src/agent/program-approvals.test.ts` |
| Card, bypass warning, mock | renderer `approval-card.tsx`, `permission-picker.tsx`, `mocks/sessions.ts` | `permission-picker.test.ts`, `mocks/sessions.test.ts`, `tests/e2e/program-approvals.spec.ts` |
| CLI typed confirmation | `cli/src/approval-prompt.ts`, `run.ts` | `cli/src/approval-prompt.test.ts` |
| Agent tools, timeout, until, handles, prompt entries | `core/src/plugins/program-tools.ts` | `program-tools.test.ts` |
| Session wiring, modes end to end, stop | `core/src/sessions/service.ts`, `agent/runtime.ts` | `core/src/sessions/programs.test.ts` |
| Desktop composition, test resolver | `main/sessions.ts`, `main/index.ts`, `main/program-resolver.ts` | `program-resolver.test.ts`, `tests/e2e/program-runs.spec.ts` |
| CLI composition | `cli/src/run.ts` | `tests/integration/cli.test.ts` |
| Install kinds, probes, ranges, statuses, uv environment | `core/src/plugins/provisioning.ts` | `provisioning.test.ts`, `tests/integration/provisioning.test.ts` |
| Zip extraction, tree check, system tar | `core/src/plugins/archive.ts` | `archive.test.ts`, `tests/integration/provisioning.test.ts` |
| Program status schema, range grammar, download form | shared `plugins.ts` | `shared/src/plugin-provisioning.test.ts` |
| plugins.programs / plugins.provision, prompt-entry cache | desktop `main/index.ts`, `main/sessions.ts`, `mocks/mockApi.ts` | `main/sessions.test.ts`, `mocks/mockApi.test.ts` |
| `vera plugin install` | `cli/src/{args,plugin,provisioning}.ts` | `tests/integration/cli.test.ts` |
| Review, picker, hash-bound install | `PluginStore.review`/`install` in `store.ts`, `plugins.choose`/`review`/`install` in `main/index.ts` | `store.test.ts`, `plugins-ipc.test.ts`, `mockApi.test.ts` |
| Run records, list, log, stop | `ProgramRunner` in `runner.ts`, `runs.*` in `main/index.ts`, label in `program-tools.ts` | `runner.test.ts`, `program-tools.test.ts` |
| Plugins page or Runs tab | renderer `plugins.tsx`, `runs-tab.tsx`, `shell.tsx`, `App.tsx`, locales | `plugins.test.ts`, `runs-tab.test.ts`, `tests/e2e/plugins-ui.spec.ts` (native), `plugins-mock.spec.ts` (languages, themes, sizes) |
| Catalog formats, token lint, URL rule, version order | shared `plugin-catalog.ts` | `plugin-catalog.test.ts` |
| Catalog check or release build, `vera catalog` | core `catalog-source.ts`, CLI `catalog.ts`, `args.ts` | `catalog-source.test.ts`, `tests/integration/cli.test.ts` |
| Catalog client: sources, downloads, review decision, install | core `catalog.ts`, store `install` origin | `catalog.test.ts` (loopback server) |
| Catalog IPC, checks, build-time URL | main `index.ts`, `catalog-checks.ts`, `electron.vite.config.ts`, `scripts/update-config.mjs` | `catalog-checks.test.ts`, `plugins-ipc.test.ts`, `tests/packaging/updates.test.ts` |
| Catalog section, review queue, update buttons | renderer `plugin-catalog.tsx`, `plugins.tsx`, `mocks/mockApi.ts`, locales | `plugin-catalog.test.ts`, `mockApi.test.ts`, `tests/e2e/plugins-catalog.spec.ts`, `plugins-mock.spec.ts` |

## Key behaviors

Rule parsing canonicalizes adjacent sequence wildcards to one before whole-command matching; risk, notes, timeout and the first irreversible confirmation word retain their original semantics. The wildcard-heavy regression keeps its existing 300 ms bound.

- `REQ-FUNC-20b10001` / `REQ-FUNC-20b10002` — find-first combined provisioning and shared verified fallback; `REQ-DATA-4d4471f9` accepts the format-1 declaration.

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
- `REQ-FUNC-e08c858b` — original argument values reach the process host unchanged, no shell.
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
- `REQ-SEC-e0567486` / `REQ-PLAT-c99d7918` / `REQ-SEC-1a151052` / `REQ-PLAT-1ecf3d4f` — uv runs inside the runtime; pinned uv prepared, refused when altered, shipped and re-checked.
- `REQ-FUNC-714e26bc` / `REQ-REL-e27cda96` / `REQ-FUNC-e7cb0626` / `REQ-FUNC-edbe037c` — pip and script installs, uv failures, offline script runs.
- `REQ-FUNC-aa09d82e` / `REQ-FUNC-d30d568c` / `REQ-SEC-cde8b481` / `REQ-SEC-e51bc0d8` / `REQ-REL-e068dcd7` — downloads: archives, single files, wrong hash, escaping archives, failed transfers.
- `REQ-FUNC-c9dde429` / `REQ-UX-46085ddf` / `REQ-FUNC-514708b5` / `REQ-SEC-ba78d876` — find search, missing hint and link, version probe and range.
- `REQ-SEC-49ff111b` / `REQ-FUNC-5491d410` — resolve never installs; platform exclusions.
- `REQ-DATA-10e10001` / `REQ-FUNC-10e10002` / `REQ-FUNC-10e10004` — explicit vendor launcher transport, probes and prompt/run support.
- `REQ-SEC-10e10003` / `REQ-SEC-10e10005` / `REQ-SEC-10e10006` — string refusals, generated invocation approvals and original-argument serial locking.
- `REQ-FUNC-10e10009` — blocked refusals include explanatory notes.
- `REQ-FUNC-13ef1c0c` / `REQ-FUNC-86daf060` / `REQ-FUNC-c44675ed` / `REQ-FUNC-c12941f3` / `REQ-SEC-0bc97768` — statuses and installs over IPC and the CLI; index and proxy settings.
- `REQ-FUNC-565e908d` / `REQ-NFR-a881a281` / `REQ-PLAT-8b3408cb` — provisioner composed in the apps; cached prompt entries; clean-machine run (manual).
- `REQ-FUNC-a5be5e53` / `REQ-SEC-8e281f52` / `REQ-FUNC-6c76f25a` — review without installing, install bound to the reviewed hash, native pickers.
- `REQ-DATA-f563074f` / `REQ-FUNC-39617f81` / `REQ-FUNC-f024d73c` / `REQ-FUNC-8c38d223` — run records, runs list, log tail, stop (spec REQ-DATA-f563074f.md).
- `REQ-UX-28503c97` / `REQ-UX-41c19e62` / `REQ-UX-e6056763` / `REQ-UX-8904f319` / `REQ-UX-acc04fbc` / `REQ-UX-fd6bc95d` / `REQ-UX-d51c6e3c` / `REQ-UX-c1de1651` / `REQ-UX-e07790cb` — Plugins page.
- `REQ-UX-e0e51891` / `REQ-UX-25921e97` / `REQ-UX-93fd56dc` — Runs tab: list, log dialog, Stop.
- `REQ-DATA-b40d3f9b` — catalog source and release formats (spec REQ-DATA-b40d3f9b.md).
- `REQ-FUNC-3b9f62f8` / `REQ-SEC-dfc6a26d` / `REQ-SEC-5fa5cd5e` / `REQ-FUNC-f4381792` — catalog check, programs without
  rules, dangerous tokens, release build.
- `REQ-FUNC-98ded47a` / `REQ-SEC-a3c31442` — catalog location with the bundled fallback; URL rule.
- `REQ-SEC-449e334b` / `REQ-SEC-6305d7b7` / `REQ-SEC-69f9d44d` — wrong size or hash, entry mismatch, downgrade refused.
- `REQ-FUNC-f244f8f6` / `REQ-FUNC-46079512` / `REQ-FUNC-ce542246` — install with tier, review decision, 24 h checks.
- `REQ-UX-72a349a1` / `REQ-UX-c55a0fe1` / `REQ-UX-9207423e` — pack browser, catalog list and updates, catalog URL field.
- `REQ-PLAT-720aa4f2` — official plugins shipped as a bundled catalog release.

## Files

- `tests/integration/binutils.test.ts` — ordered find roots, prompt filtering and optional offline real-archive acceptance of combined provisioning.

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
- `05_Software/src/libraries/core/src/plugins/program-tools.ts` — agent tools, ProgramHost, resolver seam, prompt entries.
- `05_Software/src/libraries/core/src/plugins/fake-process-host.test-support.ts` — scripted ProcessHost for tests.
- `05_Software/src/libraries/core/src/sessions/programs.test.ts` — replay sessions running echo-tools in every mode.
- `05_Software/src/apps/desktop/src/main/program-resolver.ts` — `VERA_TEST_PROGRAMS` resolver of instrumented builds.
- `05_Software/tests/fixtures/plugins/echo-tools/` — the fixture plugin (program `echo`, skill `echo-guide`).
- `05_Software/tests/e2e/program-runs.spec.ts` — native Electron run through the approval card.
- `05_Software/src/libraries/core/src/plugins/provisioning.ts` — Provisioner, uv environment, probes, find search, downloads.
- `05_Software/src/libraries/core/src/plugins/archive.ts` — streaming zip extraction, tree check, system tar command.
- `05_Software/src/libraries/core/src/plugins/provisioning.test.ts`, `archive.test.ts` — scripted-host and file-system tests.
- `05_Software/src/libraries/shared/src/plugin-provisioning.test.ts` — range, download form, statuses, channels, settings.
- `05_Software/tests/integration/provisioning.test.ts` — real system tar and a real probed program.
- `05_Software/src/apps/cli/src/plugin.ts`, `provisioning.ts` — `vera plugin install` and the CLI provisioner.
- `05_Software/src/uv/uv-manifest.json`, `05_Software/scripts/prepare-uv.mjs` — the pinned uv.
- `05_Software/src/apps/desktop/src/renderer/components/plugins.tsx`, `plugins.test.ts` — the Plugins page and its tests.
- `05_Software/src/apps/desktop/src/renderer/components/runs-tab.tsx`, `runs-tab.test.ts` — the Runs tab and its tests.
- `05_Software/tests/e2e/plugins-ui.spec.ts` — native install through the review, enable, Runs log and Stop, broken plugin.
- `05_Software/tests/e2e/plugins-mock.spec.ts` — browser mock flow and overflow in every language, theme and size.
- `05_Software/tests/fixtures/llm-scripts/program-serve.jsonl` — replay script starting `echo serve` in the background.
- `05_Software/src/libraries/shared/src/plugin-catalog.ts`, `plugin-catalog.test.ts` — catalog formats and rules.
- `05_Software/src/libraries/core/src/plugins/catalog-source.ts`, `catalog-source.test.ts` — catalog check and build.
- `05_Software/src/libraries/core/src/plugins/catalog.ts`, `catalog.test.ts` — catalog client.
- `05_Software/src/apps/cli/src/catalog.ts` — `vera catalog check|build`.
- `05_Software/src/apps/desktop/src/main/catalog-checks.ts`, `catalog-checks.test.ts` — start and 24 h checks.
- `05_Software/src/apps/desktop/src/renderer/components/plugin-catalog.tsx`, `plugin-catalog.test.ts` — catalog section.
- `05_Software/tests/e2e/plugins-catalog.spec.ts` — native install and rule-changing update from a loopback catalog.

Scoped request lifetime is implemented by desktop `main/provisioner-hosts.ts` and verified by the real hanging-probe quit case in `tests/e2e/plugins-ui.spec.ts`; content-addressed approval/spawn binding is verified by `tests/integration/scoped-programs.test.ts`.

Workbench selection UI: `05_Software/src/apps/desktop/src/renderer/components/workbench-plugins.tsx` and `workbench-plugins.test.ts` own draft selection. Package-level controls remain in plugins.tsx.

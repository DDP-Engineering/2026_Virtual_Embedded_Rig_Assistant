# Headless CLI

## Routing

Select for `vera run`, `vera index`, `vera search`, arguments, event/usage formatting, Node host ports and lifecycle. Start at05_Software/src/apps/cli/src/{index,args,run,host-ports,replay-output}.ts and scripts/build-cli.mjs. Focused tests are tests/integration/cli.test.ts and src/apps/cli/src/host-ports.test.ts. [Sessions](sessions.md) owns durable transcript/events/recovery; [agent runtime](agent-runtime.md) owns context policy; [LLM gateway](llm-gateway.md) owns providers/replay; [file tools](file-tools.md) owns confinement and worker deadlines; [software tooling](software-tooling.md) owns npm/TypeScript/verification.

## Purpose and boundaries

CLI runs one durable SessionService turn over core/shared with Node-only host adapters. WorkbenchService owns locking and SQLite lifetime. Explicit headless ReplayGateway selects an isolated supplied script; desktop composition owns its separate compiled test boundary.

## Public interface

- parse_log exposes the same read-tool contract, full scanned counts, source SHA and cited filtered events as desktop agents. tests/integration/cli.test.ts compares replay SessionService results against real npm-built vera run and validates baseline WARN and candidate ERROR citations. The common grep-worker entry dispatches kind parse_log to its isolated scanner.

- CLI supplies anonymous ExaWebProvider to SessionService; enabled web_search/web_read use the shared port and existing read-tool events/errors, without account configuration or startup egress. [Web search](web-search.md) owns this boundary.

- run composes [skills](skills.md) from the selected workbench and authorized CLI
  userData (`--data` or its owned temporary data root), includes fresh enabled
  metadata in the prompt and binds load_skill through the production registry.

- `vera plugin install --path <folder|zip> --data <dir>` installs the plugin into `<data>/plugins`, then its programs
  through the provisioner (`src/apps/cli/src/{plugin,provisioning}.ts`; uv only from `05_Software/src/uv/<platform>/`
  relative to the CLI build), and prints one JSON status per program; exit 0 when all are ready, 1 otherwise, 2
  for usage. `vera run` resolves enabled plugins' programs through the same provisioner and never installs.
- `vera plugin list|review|trust|provision --workbench <dir> --data <dir>` uses portable packages
  in `.vera/plugins` and the machine-local scoped store. review/trust/provision name `--id`; trust also
  requires the exact `--sha256` from review. Trust never enables or provisions. list/review/trust return
  JSON and 0 on success, 1 for operational errors, 2 for usage; provision returns 0 only when all programs
  are ready. The scoped Git clone/pull case in tests/integration/cli.test.ts observes real process output,
  refusal in Bypass and actual loopback system prompts before and after trust/invalidation.
- `vera catalog check --source <dir>` prints one `<where>: <code>: <detail>` line per issue of a plugin catalog source
  and exits 1 with issues, 0 without; `vera catalog build --source <dir> --out <dir>` writes the release (zips and
  `index.json`) only without issues into a missing or empty folder and prints `<n> plugins written to <out>`
  (`src/apps/cli/src/catalog.ts`; spec `.agentic/specs/REQ-DATA-b40d3f9b.md`). Usage errors exit 2.
- `vera index --workbench <dir>` rebuilds documents through owned local extraction/embedding and reports statuses; `vera search --workbench <dir> --query <text>` supplies hybrid/k8 with mode/k/path-glob options. Search uses the current protected snapshot; index requires writable ownership. Both close all owned resources on exits. [Document search](document-search.md) owns retrieval/read contracts and the eval gate.

- `npm run vera -- run --workbench <dir> --prompt <text>` with explicit provider options. OpenAI(default) requires model; custom requires base-url/model; replay requires script. Optional --approve all|none supplies explicit user decisions for ask/protected requests. Without it, stdin+stderr TTY opens an abortable A/D prompt on stderr; non-TTY denies safely. A run_program approval shows risk, command, notes and file hashes; one that needs the typed word approves only after the prompt receives it, and flags or a non-TTY deny it (REQ-FUNC-7cf311ae). Ordinary auto-edit uses mode decisions. Optional session/data/key-file/format follow the [CLI spec](../specs/REQ-FUNC-1ed659ec.md). Unknown/duplicate/missing/incompatible flags return usage and2.
- artifact_save uses the shared session-class tool, emits artifact.saved without approval and stores verified UTF8 session files; tooling/cli.test.ts covers saved summary and valid/missing citations in the real process. [Artifacts](artifacts.md) owns the storage contract.
- JSONL(default) writes sessionId/optional seq/shared event in order; pretty writes escaped single-line details. stderr contains scrubbed structured operational errors, console JSON log lines and interactive approval prompts with terminal controls escaped. End/help returns0; operational error/error/aborted/limit returns1.
- Resume subscribes after the stored sequence and uses explicit invocation model; core preserves the historical transcript. New sessions include creation metadata from sequence0.
- PathProvider points to preserved supplied data or an owned temporary folder. Node Clock and atomic FileAccess supply settings/workbench operations. MemoryCredentials serializes mutations, clones values and honors abort. ConsoleLogger retains all registered raw/escaped secrets through exit.

## Plugin drafts

`vera run` composes the same draft validator and prepared trial installer as desktop, using its
owned plugin store and application-data write exclusions. A plugin_install approval prints the full
manifest and uses the interactive CLI user decision (or denies without a TTY); bypass cannot
approve it by mode. `--approve all` cannot preapprove a draft install or trial command; a TTY still asks and non-TTY denies. It neither enables nor provisions. The official create-plugin skill is in the
same catalog. Promotion/export controls remain user actions on the desktop Plugins page.

## Invariants

- Credentials load from ambient OPENAI_API_KEY or a single-read UTF8 key-file override; successful key-file reads register before parser diagnostics. Credentials stay in memory; settings store non-secret fields. Known-secret invocation fields are rejected before persistence. Event/tool outputs are scrubbed through the core host, and each serialized output line passes shared scrub again.
- ContextPolicy and SessionService limits use desktop defaults/settings. CLI supplies WorkbenchService.getWriteQueue and awaits SessionService.waitReady before session operations. Grep and parse_log run through the shared host-owned worker adapter with10000ms absolute admission/execution deadline, termination and fresh-worker capacity; main thread performs no regex matching.
- `run` composes a plugin ProgramRunner over `createCliProcessHost()`; its `stopAll` is a closing resource, so every program run's process tree ends with the CLI run. The session's ProgramHost uses the workbench's enabled plugins (`loadPlugins`) and `unresolvedPrograms` until provisioning exists, so run_program reports programs as not available while plugin skills load and every event prints like other session events (REQ-FUNC-59308834).
- SIGINT/SIGTERM request active-turn abort; reverse cleanup drains session before SQLite/workbench close and disposes workers, credentials/settings and owned temporary locations. Provided data survives. Cleanup attempts all owned resources even after a close error.
- CLI bundle uses exact installed esbuild and external dependencies/native addon; shared/core source aliases build without previous library output. Independent grep-worker entry resides beside index. Workspace bin points to dist/index.js.
- Process tests preload the existing Node loopback guard, use fictional keys and copied demo files, and exercise production deadline/context policy. Linux also executes the unflagged CLI in a real PTY, approves/denies and interrupts the waiting prompt, and sends an actual native SIGINT; a harness emits the same registered signal handlers inside real processes on both platforms.

- Repository .npmrc suppresses npm run-script banners to preserve event-only stdout and avoid raw argument reflection. Explicit replay records decode JSON escapes before canonical serialization is scrubbed and staged, preserving comment/blank-line support and core validation. Process receipts bind the actual executed index/worker paths and bytes, including npm-built dist. Process evidence uses a unique suite directory, exclusive writes, original byte streams and copied bundle hashes for each child.

Replay output passes through the CLI scrubReplayOutput adapter after bindings/interpolation: it aggregates the existing in-memory response deltas, scrubs complete text/tool argument values, then scrubs terminal/partial objects before runtime consumption or persistence. Replay emits one safe delta per complete text/tool value, retains original source-delta counts and source order. OpenAI/custom incremental streaming remains the shared gateway contract.

## Change map

| Change | Start | Verification |
|---|---|---|
| Options/exits/event format/resume | index,args,run | tooling/cli.test.ts |
| Node adapters/redaction/cleanup | host-ports,run | host-ports.test.ts;process failures/signals |
| Bundle/bin/command | build-cli,package manifests | typecheck;real npm vera acceptance |
| Budgets/grep | shared core context/session and worker adapter | loopback first turn;real10000ms timeout/replacement;worker-host tests |

## Key behaviors

REQ-FUNC-1ed659ec session; FUNCe0645fcd output; REL88dd69b2 exits; SEC25008e88 redaction; PLAT83f14f47 ports/cleanup; NFR3d884630 policy parity.

## Files

Under05_Software: src/apps/cli/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/args.ts,src/run.ts,src/host-ports.ts,src/replay-output.ts,src/approval-prompt.ts,src/approval-prompt.test.ts,src/host-ports.test.ts,src/worker-pool.ts,src/grep-worker.ts};scripts/build-cli.mjs;package.json/package-lock.json;tests/integration/cli.test.ts;tests/fixtures/workbenches/demo-board/board.txt;README.md.

CLI selects Exa/Tavily/Brave through ConfiguredWebProvider and applies the same current global enabled/authentication preference. Anonymous ignores keys. API-key mode reads explicit EXA_API_KEY/TAVILY_API_KEY/BRAVE_SEARCH_API_KEY for the selected provider through MemoryCredentials with redaction; it fails closed when absent and never reads Electron safeStorage credentials. No extra CLI flags or endpoint configuration. See [web access](web-search.md).

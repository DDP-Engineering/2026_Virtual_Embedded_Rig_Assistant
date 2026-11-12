# M1 — Read-only agent

PURPOSE: open a workbench, configure a model, and get answers grounded in workbench files — the first
end-to-end slice of VERA.
STATE: 2026-11-01 — implemented; WP-06…WP-15 and the M1 epic are closed in Gitea. This file is now a
historical record of the plan: the WP text below is unchanged, and
[Implementation notes](#implementation-notes-2026-11-01) record what the code does. In "Start from"
lines, read `09_Others/benchpilot-reference/src/apps/…` as `…/apps/…` and the reference's
`src/libraries/shared/` as `packages/shared/`.
DONE-WHEN: in the demo workbench — with the replay script `read-then-answer` in tests, and with a real
OpenAI key or a local endpoint by hand — the agent greps and reads files and answers with a valid
citation; the session reloads after a restart; `vera run` prints the same events headless.
Every model request fits the M1 context budget, including a first turn with many tool results;
pathological grep patterns can be stopped without blocking IPC.

## WP-06 Workbench format, create and open, Welcome screen

**Goal:** users create or open a workbench folder; VERA validates it, prepares `.vera/`, locks it and
remembers it.
**Depends on:** WP-04. **Specs:** 02 §1–§3, §6, §8; ADR-0004; 06 §2; 08 §3.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/testbench/load.ts`, `content.ts` (YAML plus zod),
`src/apps/web/src/pages/NewTestbenchPage.tsx`, `components/testbench/OverviewTab.tsx`.

Scope:
- `src/libraries/shared/src/workbench.ts`: the zod schema of 02 §2; unknown keys kept and reported as warnings.
- `src/libraries/core/src/workbench/`:
  - `create(folder, name)`: the folder must be empty or lack `workbench.yaml`; writes `workbench.yaml`
    with a `wb_` ULID, the `WORKBENCH.md` template, `docs/`, `skills/`, `.vera/.gitignore`;
  - `open(folder)`: validates (`format` must be 1; any other value is `CONFIG_INVALID`, there is no `WORKBENCH_TOO_NEW`); takes `.vera/lock`, takes
    over a lock whose process is gone, opens read-only while the lock's process lives;
  - `close()`; the ignore rules of 02 §6, exposed for the tools.
- UNC paths open with a "network share unsupported" warning.
- The ten most recent workbenches in settings, with a missing-folder state.
- IPC `workbench.create | open | close | recent | config.get | config.update | pinned.get |
  pinned.update | files`; `files { query }` returns up to 50 workbench-relative paths for `@`
  completion. `WorkbenchEvent` `opened`, `closed`, `config.changed`.
- The Welcome screen (06 §2) and a `WORKBENCH.md` editor dialog; `app.chooseFolder` with the
  `VERA_TEST_DIALOG_PATH` switch (08 §3).
- `tests/fixtures/workbenches/demo-board/`: `workbench.yaml`, `WORKBENCH.md` (fictional board VERA-DEMO-01),
  `docs/notes/bringup.md`, `docs/pinout.csv`, `logs/boot-0412.log`.

Done when:
- [ ] Unit: create → open round trip; the written YAML validates.
- [ ] Unit: invalid YAML reports its line; `format: 2` is `CONFIG_INVALID`.
- [ ] Unit: a stale lock is taken over; a live lock opens the workbench read-only.
- [ ] Unit: unknown keys survive `config.update`.
- [ ] e2e: create a workbench on the Welcome screen, restart, reopen it from the recent list.
- [ ] e2e: a recent entry whose folder was deleted shows the missing state and can be removed.

## WP-07 Workbench database and migrations

**Status:** as built there are no migrations. Checksummed migrations and backups are deferred until
the first public release; until then the one complete schema has `schema_version` 1 and any other value
is INVALID (07 §6). The migration scope and Done-when items below are the original plan.

**Goal:** the per-workbench SQLite database with checksummed migrations, backups and the first repositories.
**Depends on:** WP-05, WP-06. **Specs:** 02 §9; 07 §6; ADR-0005 and the ADR filed by WP-05.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/db/index.ts`, `db/schema.sql`, `db/repos/sessions.ts`.

Scope:
- `storage/db.ts`: open with the driver WP-05 confirmed; `journal_mode=WAL`, `foreign_keys=ON`,
  `busy_timeout=5000`, `synchronous=NORMAL`.
- Migration runner: ordered migrations as TypeScript modules exporting SQL; the SHA-256 of each applied
  migration in `meta`; a changed applied migration is an error; a backup in
  `.vera/backups/vera.db.v<n>.bak` before pending migrations run; a higher `schema_version` throws
  `WORKBENCH_TOO_NEW` (original plan, not built).
- Migration `0001_initial`: the tables of 02 §9 except the FTS5 and embeddings tables (M3).
- Repositories for `sessions`, `messages` and `events`; other tables get theirs with their packages.
- Called from `workbench.open`.

Done when:
- [ ] Unit: a fresh database migrates to the latest version; reopening applies nothing.
- [ ] Unit: altering an applied migration's SQL makes opening fail with a checksum error.
- [ ] Unit: migrating a database that holds data leaves a backup.
- [ ] Unit: a database with a higher `schema_version` is refused and left untouched.
- [ ] Unit: the repositories create, read, list and delete sessions, messages and events in `seq` order.

## WP-08 Credential store and provider settings

**Goal:** keep API keys safe in the main process and let the user configure the OpenAI API and custom endpoints.
**Depends on:** WP-04. **Specs:** 04 §1, §2, §5; 01 §1 (L7), §6; ADR-0011.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/llm/credentials.ts`; the provider section of
`src/apps/web/src/pages/SettingsPage.tsx`.

Scope:
- A `CredentialStore` port matching pi-ai's contract (`read`, `list`, `modify`, `delete`).
- The main-process store over `<userData>/credentials.json` (`schemaVersion` 1, strict; another version or invalid content gives INVALID before decryption; values encrypted with
  `safeStorage`, base64); `modify` under a mutex.
- When encryption is unavailable, or Linux reports `basic_text`: ask before storing; on refusal keep
  secrets in memory for this run only.
- Every stored secret is registered with the log redaction hook and with `llm/scrub.ts`
  (`scrub(text, secrets)`).
- Non-secret provider configurations in settings: `openai { model? }` and `custom[] { name, slug,
  baseUrl, model, contextWindow, maxOutputTokens, supportsTools? }`.
- IPC `providers.list` (configurations plus `{ configured, hint }`), `providers.save`, `providers.remove`.
- Settings → Providers: OpenAI API key (masked input, hint, remove); custom endpoints (add, edit, remove).

Done when:
- [ ] Unit: `credentials.json` holds no plaintext secret; a round trip returns the original value.
- [ ] Unit: `providers.list` never includes a secret; the hint shows at most the first 3 and last 4 characters.
- [ ] Unit: `scrub` removes a key embedded in an error message, and the logger redacts it.
- [ ] Unit: with encryption unavailable, saving needs consent, and a refusal keeps the secret in memory only.
- [ ] e2e: after a key is saved, no part of it beyond the hint appears in the page or in any IPC response.

## WP-09 LLM gateway, connection test, replay provider

**Goal:** one core module through which every model call goes — catalogs, the connection test, error
mapping — and the scripted replay provider for core and test-build model scenarios (L11).
**Depends on:** WP-08. **Specs:** 04 §1–§4, §7, §8; 08 §3, §4; ADR-0002.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/llm/gateway.ts`, `providers.ts`, `replay.ts`, `llm.spec.ts`.

Scope:
- `@earendil-works/pi-ai` with an exact pin. `llm/`: the **api** and **subscription** collections
  (subscription empty until WP-21); providers from settings and the credential store; `custom:<slug>`
  providers through `createProvider()` and `openAICompletionsApi()` with the flags of 04 §2.
- Model references `<providerId>/<modelId>`; the precedence helper (session → workbench → app).
- Expose model context windows and effective output limits to the runtime; validate custom-provider
  budget settings. A model switch supplies fresh capabilities for the next request (04 §3).
- IPC `providers.models` (catalog per provider; `GET /models` for custom endpoints that offer it) and
  `providers.test` (04 §4).
- Error mapping to `VeraError` per 04 §7, always through `scrub`.
- The replay provider of 08 §3, registered only in test builds through `VERA_REPLAY_DIR`.
- `smoke:live -- --provider <id>`: `providers.test` against a configured real provider, by hand.
- The test network guard (08 §4).
- Settings → Providers: the Test button with per-step results.

Done when:
- [ ] Unit (replay): `providers.test` passes every step for a scripted tool-calling model and marks
  tool calling failed for a script that never calls tools.
- [ ] Unit (mock HTTP server on loopback): 401, 429 with retry-after, a refused connection and an
  over-long context map to the codes of 04 §7 with no secret in the message.
- [ ] Unit: model-reference precedence resolves session over workbench over app.
- [ ] Unit: model capabilities and output limits are available before streaming; invalid custom
  windows are rejected, and switching to a smaller model supplies the smaller budget.
- [ ] Manual: `smoke:live` passes against a real OpenAI key or a local Ollama.

## WP-10 Spike: agent runtime

**Goal:** confirm the runtime that carries VERA's turns — the reference loop, per ADR-0003 — and measure
the alternative, pi-agent-core, before the session engine depends on either.
**Depends on:** WP-09. **Specs:** 03 §1, §2, §6, §8; ADR-0003, ADR-0010.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/agent/loop.ts`, `agent/approval.ts`,
`agent/replay-e2e.spec.ts`, `agent/guards.spec.ts`.

Scope:
- `agent/runtime.ts` from the reference loop, behind the interface of 03 §2.
- Replay-provider tests with two dummy tools (one read, one write) proving the seven behaviours of 03 §2:
  streaming text and tool calls; parallel reads with ordered writes; approval wait with approve and
  deny; abort during a wait; resume from persisted messages; a throwing tool turned into an error
  result; bounded model requests within a long first turn.
- `agent/context.ts`: the M1 context policy of 03 §2, shared by both candidate runtimes. Document the
  token-counting strategy, output reserve and safety margin; keep full persisted messages unchanged.
- The same seven behaviours tried on `@earendil-works/pi-agent-core` (`beforeToolCall`, `abort()`,
  `executionMode`), with the replay provider adapted as its stream function; note the effort and gaps.
- The mapping from runtime events to `SessionEvent`s, written down.
- The zod → JSON Schema conversion for tool parameters (ADR-0010).

Done when:
- [ ] Seven passing behaviour groups on the chosen runtime, covering approve, deny and abort separately.
- [ ] Budget tests: system prompt and tool schemas count; output reserve and safety margin are honoured;
  several large results in the first turn are reduced before the next call; an irreducible request
  makes no model call and ends `limit`; reduced requests preserve complete tool-call/result pairs.
- [ ] The comparison and the event mapping are written down.
- [ ] A new ADR confirms ADR-0003 or switches to pi-agent-core, and the decisions index is updated;
  either way `runtime.ts` keeps the interface of 03 §2.

## WP-11 Path guard, tool registry, read-only file tools

**Goal:** the confinement layer every file tool relies on, the tool registry, and `read`, `list`,
`glob` and `grep`.
**Depends on:** WP-06. **Specs:** 03 §4, §5, §7; 02 §6, §7; 05 §7 (line references); ADR-0007, ADR-0010.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/tools/registry.ts`, `tools/caps.spec.ts`.

Scope:
- `workbench/path-guard.ts` (03 §5 steps 1–5) and binary detection.
- The `WorkerPool` port and reusable desktop/CLI worker hosts: one task per worker, host-owned
  absolute deadlines, termination on timeout/abort, and replacement after termination. `grep` runs
  discovery, file reads and JavaScript regex matching there; partial matches cross the worker boundary.
- `src/libraries/shared/src/refs.ts`: line references `<path>#L<a>-L<b>`; other kinds arrive in WP-27.
- `tools/registry.ts`: `{ name, class, description, params (zod), execute(ctx, args, signal) }`;
  `tools.disabled` filtering; JSON Schema for the model; capping at 32 000 characters with `truncated`.
- `read`, `list`, `glob`, `grep` per 03 §4, with the in-memory last-read fingerprints per session;
  `tinyglobby` and `ignore`.

Done when:
- [ ] The guard rejects absolute paths, `C:\…`, `\\server\share`, `\\?\…`, `CON`, `nul.txt`, `..`
  escapes, NUL bytes, `.vera/…` and links pointing outside the root; it accepts nested relative paths.
  OS-specific cases skip with a reason on the other OS.
- [ ] On Windows, `Docs/Notes.md` and `docs/notes.md` resolve to the same file for the guard.
- [ ] `read` numbers lines, honours `offset` and `limit`, refuses binaries, points PDFs to `read_doc`,
  records the fingerprint.
- [ ] `grep` honours `glob`, `ignoreCase`, `context`, `output`; skips binaries and files over 5 MB;
  its host terminates the worker after 10 s with partial results and `truncated`.
- [ ] A catastrophic-backtracking fixture times out; an abort terminates it; invalid regex syntax
  returns a tool error. The next grep succeeds with replacement worker capacity.
- [ ] Desktop-host integration: while a pathological grep runs, `app.info` responds and host abort
  remains effective; no regex matching falls back to the main thread. Deadline tests use a shorter
  injected test deadline; WP-14 checks the complete session Stop flow once the chat UI exists.
- [ ] `list` and `glob` exclude `.vera/`, `.git/`, `node_modules/` and `.veraignore` matches.
- [ ] Every tool schema converts to JSON Schema and validates a sample call.

## WP-12 System prompt builder

**Goal:** the system prompt of 03 §3 from the workbench, the available skills and the environment.
**Depends on:** WP-06. **Specs:** 03 §3; 02 §3, §5.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/agent/prompt.ts`.

Scope:
- `agent/prompt.ts`: `buildSystemPrompt({ workbench, pinned, skills, env })` in the order of 03 §3.
- A `WORKBENCH.md` above 16 KB contributes its first 16 KB and a truncation note.
- `skills` is `{ name, description }[]`, empty until WP-29.
- Environment: date (`Clock`), OS family, VERA version, permission mode, indexed document count.
- The prompt size in characters, for the UI.

Done when:
- [ ] Snapshot tests: no skills; two skills; a 20 KB `WORKBENCH.md`; each permission mode.
- [ ] The rules block holds every rule of 03 §3.

## WP-13 Session engine

**Goal:** sessions that run turns through the runtime, persist messages and events, stream them to
subscribers and resume after a restart.
**Depends on:** WP-07, WP-09, WP-10, WP-11, WP-12. **Specs:** 03 §1, §2, §7, §8, §9; 02 §9, §10; 01 §3.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/agent/sessions.ts`, `agent/hub.ts`, `agent/citations.ts`,
`evidence/resolve.ts`; `src/libraries/shared/src/events.ts`, `session.ts`, `session.test.ts`.

Scope:
- `events.ts`: the `SessionEvent` union of 03 §8. `session-state.ts`: `applySessionEvent` with golden tests.
- `sessions/`: create, list, get (`{ snapshot, seq }`), rename, delete (rows and the artifacts
  folder), statuses, title from the first message.
- Turn engine on `runtime.ts`: `BUSY` on a second send; persist messages at message end and every
  non-live event with its `seq`; `tool_calls` rows; limits of 03 §7; stop.
- Apply the M1 context policy before every gateway call; report context estimates through
  `usage.updated`. A context limit leaves the full transcript and tool results available.
- A permission-engine interface with an allow-all policy for read tools (completed in WP-17).
- The citation check of 03 §9 for line references.
- Subscriptions with `sinceSeq`: replay persisted events, then live ones; deltas coalesced in main.
- Restart: sessions found `running` or `awaiting_approval` become `idle` with `session.interrupted`
  and `turn.done`; complete unanswered tool-call/result pairs before resuming. WP-16 and WP-17 add
  `pending`-change resolution and approval cleanup to this recovery path (03 §6, §8).
- IPC `session.list | create | get | rename | delete | send | stop | model.set | mode.set`; topic `session`.
- `tests/fixtures/llm-scripts/read-then-answer.jsonl`.

Done when:
- [ ] Integration: `read-then-answer` yields `message.user`, `turn.started`, two tool pairs,
  `message.done` with one valid citation, `turn.done { end }`.
- [ ] Integration: deltas stream but are not persisted.
- [ ] Integration: a second `send` during a turn fails with `BUSY`; `stop` yields `turn.done { aborted }`.
- [ ] Integration: a new core instance on the same database returns the same snapshot and continues the
  conversation.
- [ ] Integration: exceeding the tool-call limit ends the turn with `limit`.
- [ ] Integration: a single long first turn stays within the configured input budget; an oversized
  mandatory context ends `limit` without calling the gateway; switching models recalculates the budget.
- [ ] Integration: restart recovery is idempotent, closes both active statuses and repairs unanswered
  tool calls; the next turn receives a valid context with the full persisted history retained.
- [ ] Unit: the reducer builds the same snapshot from persisted events as from the live stream.

## WP-14 Chat UI

**Goal:** the session workspace — session list, streaming transcript with tool rows and citations,
composer with model choice and Stop — on the IPC bridge and in mock mode.
**Depends on:** WP-04, WP-13. **Specs:** 06 §1, §3, §6, §7, §8; 03 §8, §9; 01 §3.
**Start from:** `09_Others/benchpilot-reference/src/apps/web/src/pages/SessionWorkspace.tsx`, `components/session/`
(`Transcript`, `ToolCallRow`, `Composer`, `SessionList`, `ContextTab`), `api/useSessionEvents.ts`,
`components/common/Markdown.tsx`, `components/evidence/EvidenceChip.tsx`.

Scope:
- Sidebar: workbench switcher; session list with New, rename, delete (with confirmation) and status badges.
- Transcript: messages with Markdown; collapsible reasoning; tool rows with expandable arguments and
  preview; citation chips, valid and invalid (the viewer arrives in WP-28); errors with Retry.
- Composer: Enter sends, Shift+Enter adds a line; `@` completion through `workbench.files`; model
  picker over the configured providers; Stop.
- Footer: token usage, context budget and output reserve from `usage.updated`; estimated counts
  labelled; actionable context-limit error. Right panel: Context; other tabs as placeholders.
- `session.get` snapshot, then `subscribe(sinceSeq)`; a renderer reload re-subscribes without duplicates.
- Mock fixtures: empty session, streaming answer, tool rows, invalid citation, provider error.
- Strings in `en`, `ro`, `de`.

Done when:
- [ ] e2e (replay `read-then-answer`): two tool rows and an answer with one citation chip.
- [ ] e2e: after an app restart the transcript is identical.
- [ ] e2e: Stop during a slowed scripted response ends the turn and re-enables the composer.
- [ ] e2e: during a pathological grep, `app.info` responds, Stop aborts the worker-backed call and
  the composer becomes usable; the next grep succeeds.
- [ ] e2e: reloading the renderer mid-stream shows no duplicated text.
- [ ] Component tests: the M1 context meter labels estimates, and a context-limit error leaves the
  composer usable and the full transcript visible.
- [ ] Component tests cover each mock fixture state; the session list, tool rows and composer work by keyboard alone.

## WP-15 Headless CLI

**Goal:** run VERA's core without the GUI, so behaviour can be checked end to end from a terminal.
**Depends on:** WP-13. **Specs:** 01 §4; 08 §3; 03 §2, §4, §7, §8; ADR-0009, ADR-0012.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/cli/chat.ts` (`--script` replay runs), `cli/bench.ts`.

Scope:
- `src/apps/cli` with a `vera` bin (`npm run vera -- …`).
- Node ports: `PathProvider` (`--data <dir>`, default a temporary folder), an in-memory
  `CredentialStore` from `OPENAI_API_KEY` or `--key-file`, a console `Logger` with redaction, a
  worker-thread `WorkerPool`.
- `vera run --workbench <dir> --prompt <text> [--session <id>] [--provider replay --script <file> |
  --provider openai --model <id> | --provider custom --base-url <url> --model <id>] [--format jsonl | pretty]`.
- Exit codes: 0 when the turn ends `end`; 1 on `error`, `aborted` or `limit`; 2 on a usage error.
- Context budgeting and worker deadlines use the same policy as the desktop host; a context-limit
  stop reports the structured error.
- Every output line passes through the scrubber.

Done when:
- [ ] `vera run` with `read-then-answer.jsonl` on a copy of the demo workbench prints the expected
  event types in order and exits 0.
- [ ] An unknown flag exits 2 with usage text.
- [ ] A key passed through the environment never appears in the output, even on a forced provider error.
- [ ] A long first-turn script respects the input budget; an irreducible request reports
  `CONTEXT_LIMIT` and exits 1 without a gateway call. A pathological grep times out in its worker,
  and a later grep succeeds after worker replacement.

NOTES:
- WP-10 gates WP-13: if the spike switches to pi-agent-core, only `runtime.ts` and the replay adapter change.

## Implementation notes (2026-11-01)

Checked against the working tree on `master` (33e72b8 plus uncommitted changes) by reading code and
tests; nothing was run. Paths are relative to `05_Software/`: `core/` = `src/libraries/core/src/`,
`shared/` = `src/libraries/shared/src/`, `main/` and `renderer/` = `src/apps/desktop/src/main/`,
`…/renderer/`, `cli/` = `src/apps/cli/src/`.

- WP-06: implemented with deviation: the workbench files live in `.vera/` (`.vera/workbench.yaml`,
  `.vera/WORKBENCH.md`, `.vera/skills/`, `.vera/.veraignore`); create makes no root `docs/` or
  `skills/` and refuses only when `.vera/workbench.yaml` exists (`core/workbench/service.ts:393-411,474-507`);
  the recent list is not capped at ten (`core/workbench/service.ts:536-548`); the demo fixture uses
  the `.vera/` layout and adds `board.txt`, `sources/*.md` and three PDFs. Done-when tests:
  `core/workbench/service.test.ts:272,606,627,782`, `tests/e2e/workbench.spec.ts:32,97`.
- WP-07: implemented with deviation: there are no migrations — one complete schema (`schema_version`
  `'1'`, FTS5 and embeddings tables included) is created in one transaction in an empty database only;
  there are no checksums, no migration runner and no backups (`.vera/backups/` is gone), and any other
  `schema_version` is refused with `INVALID` and the file stays untouched; `WORKBENCH_TOO_NEW` no
  longer exists (`core/storage/schema.ts`, `core/storage/db.test.ts`). The runner and migrations
  0001–0003 were deleted in commit 33e72b8, and the schema version was reset from 3 to 1 under the
  development compatibility policy, so the checksum and backup Done-when items no longer hold. Pragmas,
  better-sqlite3 and the repositories as planned (`core/storage/db.ts`, `core/storage/repositories.test.ts`).
- WP-08: implemented as planned (`main/credentials.ts:60-65,168-227`, `main/provider-settings.ts:14-19`,
  `tests/e2e/providers.spec.ts:114`).
- WP-09: implemented as planned: pi-ai pinned at 1.1.0, custom providers through
  `openAICompletionsApi` (`core/llm/providers.ts:31-66`), replay only through `VERA_REPLAY_DIR` in test
  builds (`main/index.ts:719`), loopback error-mapping tests (`core/llm/gateway.test.ts:342,367`);
  `smoke:live` exists (`02_Tools/release/smoke-live.mjs`), its manual run is not provable from code.
- WP-10: implemented as planned: `ReferenceRuntime` (`core/agent/runtime.ts:68`) and
  `core/agent/context.ts`, with one replay matrix run on both runtimes
  (`core/agent/runtime-matrix.test-support.ts`, `core/agent/pi-spike.test.ts`); ADR-0014 confirms
  ADR-0003; comparison and event mapping in `06_SoftwareDocu/agent-runtime-spike.md`.
- WP-11: implemented as planned (`core/workbench/path-guard.ts`, `core/workers/node-host.ts`,
  `core/tools/grep-worker.ts`, `tests/e2e/file-tools.spec.ts:15`, `tests/integration/worker-hosts.test.ts`);
  the later `bypass` mode widens the guard (see M2).
- WP-12: implemented with deviation: rule 2 reads "`search_docs` first, web tools only when the
  documents do not answer" and a `bypass` paragraph was added (`core/agent/prompt.ts:31,76-79`); the
  prompt size is computed (`prompt.ts:80`) but shown nowhere in the UI.
- WP-13: implemented with deviation: a second `send` during a running turn is queued as steering
  (`message.queued`, WP-35) instead of failing with `BUSY`, which remains for approval waits and
  stopping (`core/sessions/service.ts:573-597`); the integration items are vitest files in
  `core/sessions/service.test.ts`, not in `tests/integration/`.
- WP-14: implemented with deviation: no footer — usage and context budget sit in a Context dialog
  opened from a gauge in the composer (`renderer/components/session/session-inspector.tsx:179-185`,
  `workspace.tsx:197`); status badges are screen-reader-only (`session-list.tsx:172`); reasoning shows
  once at the top of the transcript (`transcript.tsx:59-63`). e2e: `tests/e2e/chat-ui.spec.ts:97-174`.
- WP-15: implemented as planned (`cli/args.ts:102-188`, `tests/integration/cli.test.ts:368,494,544,579,674`);
  `--format pretty` prints one `<id> <type> <json>` line per event.

Not in the plan, implemented in this area:
- Web tools `web_search` and `web_read` over Exa (anonymous MCP at `mcp.exa.ai` by default, or an
  API key), Tavily and Brave, configured in Settings › Web access; web access is on by default
  (`core/web/`, `core/tools/web.ts`, `shared/web-access.ts:18`, `tests/e2e/web-search.spec.ts`).
  `web_download` is noted in M2.
- LM Studio model discovery with per-model profiles (context, tools, reasoning, temperature) and an
  Ollama preset; providers split into Subscriptions and API connections
  (`main/provider-discovery.ts`, `renderer/components/lmstudio-editor.tsx`, `tests/e2e/lmstudio.spec.ts`).
- Per-session reasoning-effort picker from live provider capabilities
  (`renderer/components/session/reasoning-picker.tsx`, `tests/e2e/session-reasoning.spec.ts`).
- Session archive, manual sidebar ordering, reuse of an empty session, transcript scroll rail and
  search, an Activity dialog with per-prompt token statistics, and a confirmation before Escape stops
  a turn (`main/session-order.ts`, `tests/e2e/prompt-usage.spec.ts`, `sidebar-order.spec.ts`).
- Workbench extras: `workbench.inspect`, `scanDocs`, `previewDocs`; pin, move and reveal on recent
  entries; per-workbench `embeddings` and `retrieval` sections; tool checkboxes with descriptions
  (`shared/ipc.ts:390-431`, `shared/workbench.ts:9-24`, `renderer/components/workbench-tools.tsx`).
- CLI `vera index` and `vera search` (`cli/args.ts:11-12`).

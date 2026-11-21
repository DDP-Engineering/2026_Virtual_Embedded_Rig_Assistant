# VERA system architecture

VERA's laws, stack, processes, IPC boundary, module boundaries, source layout, data locations,
security baseline and network egress. The agent, tools and model providers are in
[Agent.md](Agent.md), plugins in [Plugins.md](Plugins.md), the user interface in
[Interface.md](Interface.md), packaging and updates in [Delivery.md](Delivery.md), and the workbench
folder and `.vera/` in [Workbench.md](Workbench.md).

## Laws

Other documents cite these by number. Changing one is an architecture decision.

| # | Law |
|---|---|
| L1 | `src/libraries/core` never imports `electron`, `react`, `child_process` or anything under `src/apps/`. Hosts give it services through the ports in [ports.ts](../05_Software/src/libraries/core/src/ports.ts) (`CredentialStore`, `WorkerPool`, `ProcessHost`, `WorkbenchHost`, `PathProvider`, `Clock`, `Logger`, `FileAccess`) and ports kept with their modules, such as `LlmGateway` and `DocumentProcessor`. |
| L2 | The renderer has no Node access. Its only way to the main process is `window.vera`, which carries the typed IPC contract in [ipc.ts](../05_Software/src/libraries/shared/src/ipc.ts), validated with zod on both sides. |
| L3 | Agent file tools act only inside the open workbench root and the folders the user added to it, and cannot reach `.vera/`. In the `bypass` permission mode the tools that take a path (`read`, `list`, `glob`, `grep`, `parse_log`, `write`, `edit` and others) take filesystem scope instead; the application data folder stays excluded, and the scope ends when the mode is lowered. Managed tools write only into their own `.vera/` folders (`artifact_save` into `.vera/artifacts/`, `web_download` into `.vera/downloads/`). Commands run only through `run_command`, plugin programs only through declared programs without a shell. |
| L4 | Every agent tool that changes files is a write tool and runs only as the session's permission mode allows: `read-only`, `ask`, `auto-edit` or `bypass`. `web_download` needs the user's approval in every mode except `bypass`. Commands and plugin programs follow their own approval rules ([Agent.md](Agent.md), [Plugins.md](Plugins.md)). |
| L5 | The app starts and works offline. Embedding models, renderer assets, pdf.js data and help pages are bundled; the UI uses system fonts. Network use happens only for the destinations in [Network egress](#network-egress). |
| L6 | Outbound connections go only to the destinations in [Network egress](#network-egress). VERA listens on no external port. No telemetry. |
| L7 | Secrets live only in the main-process credential store; the CLI keeps them in memory. They never reach the renderer, logs, events, the database or error text: IPC responses, events and logs are scrubbed of every stored secret. |
| L8 | Document, file, web and tool output content is data, never instructions. No tool executes content. |
| L9 | Every user-facing string goes through i18n. `en` is the source catalog; `ro`, `de` and `fr` also ship. Core returns error codes and message keys, not sentences. |
| L10 | Persisted formats stay at version 1 and have no migrations until the first public release. Any other version value is invalid data. There are no migrations, upgrade backups, legacy fallbacks or newer-version guards. |
| L11 | Automated tests never call a real model. They use the replay provider or a scripted loopback endpoint through the normal custom-provider path. Vitest projects and Playwright e2e runs block non-loopback connections ([network-guard.ts](../05_Software/tests/support/network-guard.ts)). |

## Stack

Versions are pinned exactly (`.npmrc`: `save-exact=true`, `engine-strict=true`). Node.js 24
(`engines` `>=24 <25`), npm workspaces `src/libraries/*` and `src/apps/*`.

| Component | Version | Why |
|---|---|---|
| TypeScript (strict, ESM, `tsc -b`) | 6.0.3 | One language for core, main, renderer and CLI |
| Electron | 44.11.4 | One Chromium on Windows and Linux; Node in main for ChatGPT sign-in and local ONNX. Tauri and Wails differ per webview; Python/Qt packaging is fragile |
| electron-vite on Vite; esbuild for the CLI | 5.0.0, 7.3.8; 0.25.12 | Separate main, preload and renderer bundles |
| React, Tailwind CSS, lucide-react | 19.3.0, 4.3.3, 1.55.0 | Renderer UI |
| TanStack Query | 5.104.1 | Renderer requests; event streams use the shared session reducer |
| zod (typebox wraps tool JSON Schema for pi-ai) | 4.6.7 (1.3.27) | The only schema language: one idiom for parsing and refinement |
| `@earendil-works/pi-ai` | 1.1.0 | Every model call; the only maintained library with ChatGPT-subscription sign-in |
| better-sqlite3 (WAL, FTS5 `unicode61` and `trigram`) | 13.0.3 | One database per workbench is enough at workbench scale; N-API prebuilds load in packaged builds |
| `@huggingface/transformers` on onnxruntime-node (CPU) | 4.3.1, 1.30.0 | Local embeddings: documents never leave the machine |
| pdfjs-dist | 6.4.299 | PDF text in Node and the PDF viewer in the renderer |
| electron-builder, electron-updater | 26.17.0, 6.8.10 | Per-user installers and a generic HTTPS feed without admin rights |
| Biome | 2.5.15 | Lint, format and import boundaries |
| Vitest, Playwright | 5.0.3, 1.64.0 | Unit and integration tests; Electron and browser-mock e2e |

The agent loop is VERA's own (`core/src/agent/runtime.ts`). Other libraries are pinned in the
workspace `package.json` files.

## Processes

| Process | Runs |
|---|---|
| Main | `@vera/core` (workbench, sessions, agent, tools, settings, every SQLite read and write), the IPC router, credential store, updater, download transfer, plugins, program runs and terminals (node-pty) |
| Renderer | The React app, sandboxed and context-isolated, loaded from `vera://app/`; talks to main only through the preload bridge |
| Preload | Refuses to run unless sandboxed and context-isolated; exposes one object, `window.vera` |
| VERA Indexer | Electron utility process (`main/indexer-process.ts`, driven by `main/indexer-host.ts`): document selection, hashing, extraction, chunking, embeddings and vector ranking. Main loads the results and writes them |
| Worker threads in main | `grep` and `parse_log` in the `WorkerPool` (`NodeWorkerPool`: 2 workers, 10 s deadline counted from when a task gets its worker); PDF text of web downloads; plugin listing |
| Worker threads in the Indexer | One disposable thread per PDF or Office extraction, with a deadline (120 s base, 30 s per MiB for large PDFs, at most 15 min); one persistent embedding thread per workbench |
| Child processes | Plugin programs, `run_command` shells, terminal shells and `uv`, started only through the `ProcessHost` port, never with a shell for programs |
| CLI | Its own Node process running the same core and worker entries, without a utility process |

- Each worker runs one task at a time. The host enforces deadlines and aborts by terminating the
  worker and replacing it, so a stalled worker blocks neither IPC nor other workers.
- An Indexer crash fails the calls in flight with a retryable error and restarts the process. Three
  crashes within 60 s stop it until `indexer.restart`. Its state reaches the renderer through
  `indexer.status` and the `indexer.status` app event.
- One app instance per data folder (`requestSingleInstanceLock`). One writing VERA process per
  workbench (`.vera/lock`); another process opens that workbench read-only.

## IPC

- Three Electron channels carry the contract: `vera:invoke` (every call), `vera:subscription`
  (session subscribe and unsubscribe) and `vera:event` (main to renderer).
- `window.vera` has `invoke(channel, request)` and `subscribe` for the topics `session` (with
  `sinceSeq`), `workbench` and `app`. `invoke` rejects with a `VeraError`: a `code`, an i18n
  `messageKey` and optional `params` (`shared/src/errors.ts`).
- Every channel has a zod request and response schema in `ipc.ts`. The bridge validates the request
  before sending and the response after. The router (`main/ipc-router.ts`) answers `DENIED` when the
  sender is not the window's main frame at the expected renderer URL, `NOT_FOUND` for an unknown
  channel and `INVALID` for a payload that fails its schema. It validates every response, turns any
  other failure into `INTERNAL` and scrubs secrets from error parameters.
- Events travel as `{ topic, id, seq?, subscriptionId?, event }`, validated by
  `eventEnvelopeSchema` on both sides. A session subscriber first receives the persisted events after
  `sinceSeq`, then live ones. Streaming deltas are coalesced every 50 ms; any other event flushes them
  first. App and workbench events are broadcast and filtered in the preload.
- Channels are named `namespace.method`. Namespaces: `app`, `window`, `workbench`, `session`, `docs`,
  `indexer`, `downloads`, `skills`, `plugins`, `runs`, `terminal`, `commands`, `providers`, `web`,
  `parts`, `mqtt`, `wokwi`, `artifacts`, `changes`, `help`, `update`.

## Module boundaries

Enforced by Biome `noRestrictedImports` overrides in [biome.json](../05_Software/biome.json) as part
of `npm run lint`, and proved by
[boundaries.test.ts](../05_Software/tests/tooling/boundaries.test.ts), which lints probe files at real
workspace paths.

| Package | Must not import | Uses |
|---|---|---|
| `shared` (`src/libraries/shared`) | `electron`, `react`, any `node:*` module, `@vera/core`, `@vera/desktop`, `@vera/cli` | zod only |
| `core` (`src/libraries/core`) | `electron`, `react`, `@vera/desktop`, `@vera/cli`, any path under `apps/`; outside tests also `child_process` and `node:child_process` (use `ProcessHost`) | `shared`, Node built-ins, its own dependencies |
| `desktop/main` | no lint rule | `core`, `shared`, `electron`, Node built-ins including `child_process` |
| `desktop/preload` | `@vera/core`, any path under `libraries/core`, `react` | `shared`, `electron` (`contextBridge`, `ipcRenderer`) |
| `desktop/renderer` | `electron`, any `node:*` module, `@vera/core`, any path under `libraries/core` | `shared`, UI libraries, pdfjs-dist |
| `cli` (`src/apps/cli`) | no lint rule | `core`, `shared`, Node built-ins including `child_process` |

## Source layout

```
05_Software/
  package.json  package-lock.json  .npmrc   # npm workspaces, exact pins
  biome.json  tsconfig*.json  vitest.config.ts  playwright.config.ts
  src/
    libraries/shared/   # contracts: IPC channels, events, errors, file-format schemas, session reducer
    libraries/core/     # product logic: agent, tools, sessions, storage, knowledge, llm, web,
                        # plugins, electrical, parts, skills, settings, workers, ports.ts
    apps/desktop/       # Electron main/, preload/, renderer/ (React, locales, browser mock);
                        # electron-builder.yml
    apps/cli/           # headless `vera`: run, index, search, plugin, catalog
    models/             # embedding model manifests (tracked) and prepared assets (ignored)
    uv/                 # pinned uv manifest and prepared binary
    windows_runtime/    # VC++ runtime manifest (tracked) and prepared DLLs (ignored)
  plugins/              # official plugin sources and catalog.yaml
  help/                 # help pages: en, de, fr, ro
  release-notes/        # per-version release notes
  tests/                # tooling, integration, packaging, plugins, e2e, fixtures, support
  evaluators/           # measurement harnesses (retrieval, performance)
```

Build output (`apps/desktop/out/`, `apps/cli/dist/`, the libraries' `dist/`), `release_tmp/`,
`evaluation-outputs/` and `node_modules/` are ignored. Environment, build, release and delivery
scripts are in `02_Tools/` and resolve packages from `05_Software/node_modules/`.

## Data locations

The application data folder (`<userData>`):

| Mode | Location |
|---|---|
| Installed, Windows | `%APPDATA%\VERA` |
| Installed, Linux | `~/.config/VERA` |
| Test builds | `VERA Test` instead of `VERA` |
| `--user-data-dir=<dir>` | that folder |
| Portable (a `vera.portable` file beside the executable, which the portable ZIP contains) | `<app folder>/data/`, created if missing, set before the app is ready; it wins over `--user-data-dir` |
| CLI | `--data <dir>`, or a temporary folder removed on exit |

What `<userData>` holds:

| Path | Content |
|---|---|
| `settings.json` | Preferences, provider configuration without secrets, web and parts access preferences, recent workbenches, session order, installation id. `schemaVersion` 1, strict schema; an unreadable or invalid file is left untouched and stops startup |
| `credentials.json` | Secrets, each encrypted with Electron `safeStorage`. When OS encryption is unavailable (Linux `basic_text`), a secret is stored unprotected only with the user's consent, otherwise kept in memory. A file that fails to load leaves credential operations failing; the window still opens |
| `logs/vera-YYYY-MM-DD.log` | JSON lines, secrets redacted, the 7 newest daily files kept |
| `skills/<name>/SKILL.md` | User skills, available in every workbench |
| `plugins/` | Installed plugins (`installed/`, `staging/`, workbench-scoped `workbenches/`), the managed runtime (`runtime/`: uv's CPython and plugin programs) and verified catalog downloads (`catalog/`) |
| `window-state.json` | Window bounds, `version` 1; invalid, other-version or off-screen data gives centred defaults |
| `display-identities.json` | Local key that keeps opaque document identities stable across restarts |

Read-only, inside the package (`<resources>`): embedding models (`models/<model-id>/`, both
registered models), the official plugin catalog release (`plugins/`), `uv/` and help pages (`help/`).
No caches live in `<userData>` besides the plugin catalog downloads. Workbench content stays in the
folder the user chose; its metadata, database, extraction cache, artifacts and downloads are in
`<workbench>/.vera/` ([Workbench.md](Workbench.md)).

Copying a portable folder copies settings, credentials and skills, but `safeStorage` secrets are bound
to the OS user account and do not decrypt on another machine.

## Security baseline

- Window: `contextIsolation`, `sandbox` and `webSecurity` on; `nodeIntegration`, `webviewTag` and
  `spellcheck` off. A preload error destroys the window. No application menu; `window.menu` pops up
  fixed native role menus, never renderer-supplied templates.
- The renderer loads only bundled files from the privileged `vera://app/` scheme
  (`main/security.ts`): GET and HEAD only, paths contained in the renderer folder after `realpath`, a
  MIME allowlist, `X-Content-Type-Options: nosniff`. Development builds load only the Vite server at
  `http://127.0.0.1:5173`.
- Content Security Policy, as a `<meta>` tag and a response header: `default-src 'self'; img-src
  'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; font-src
  'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`.
- Navigation (`will-navigate`, `will-frame-navigate`), new windows and webviews are blocked. Links
  open in the system browser through `app.openExternal` (http and https only) after a confirmation;
  ChatGPT sign-in may open only the `auth.openai.com` authorize URL.
- Electron denies permissions by default. The focused VERA window's main frame can make one
  audio-only request under a gesture-initiated dictation grant. Spell checking is off and the
  dictionary download URL points at `vera://`. ONNX Runtime telemetry is disabled.
- No listening sockets except on loopback: pi-ai's OAuth callback on `127.0.0.1:1455` during a
  ChatGPT sign-in, an ephemeral `127.0.0.1` CONNECT tunnel for each HTTPS `web_download` transfer,
  and the public-only proxy for an owned Desktop browser session.
- Single-user app: no accounts, roles or app login; the OS account is the boundary.

## Network egress

The complete list of outbound destinations. The app runs with HTTP/2 disabled in Chromium, because
datasheet CDNs reject its HTTP/2 streams; model calls use Node's network stack.

| Destination | When |
|---|---|
| OpenAI API (`api.openai.com`) | A session, model list or connection test uses the OpenAI provider |
| `auth.openai.com` and `api.openai.com` with ChatGPT tokens | ChatGPT sign-in, token refresh, model catalog and requests |
| A custom endpoint base URL (often localhost; ends in `/v1`) | A session, model list or connection test uses it; LM Studio discovery reads `<origin>/api/v1/models` |
| The HTTPS routes in the [curated provider registry](../05_Software/src/libraries/shared/src/provider-presets.ts) | The selected preset's catalog, connection test or inference uses its saved binding |
| Update feed (HTTPS, compiled in from `VERA_UPDATE_URL`; none when unset) | After the window opens and every 6 h while updates are not Off, and on "Check now"; downloads per the update mode ([Delivery.md](Delivery.md)) |
| Plugin catalog (`index.json` and plugin zips) | At start and every 24 h (index only) while updates are not Off and a catalog is set; browsing and installs on a user action |
| PyPI or the configured package index; uv's CPython host; URLs in a plugin's `download` entries (SHA-256 verified) | The user installs or provisions a plugin |
| Exa MCP (`mcp.exa.ai`, default, anonymous), Tavily (`api.tavily.com`), Brave Search (`api.search.brave.com`) | Web access is on (default on, Exa), the tool is not disabled in the workbench, and `web_search` or `web_read` runs, or the user tests the provider; only the selected provider |
| Any public http or https URL given to `web_download`, up to 5 redirects | Web access and the tool are on and the user approves (automatic only in `bypass`); public-address DNS check, at most 100 MiB; HTTPS through an anonymous in-memory Chromium session pinned to the checked address |
| Chrome for Testing (`storage.googleapis.com`) | The user installs the pinned Desktop browser runtime in Settings > Web access |
| Public HTTP(S) origins granted to a Desktop browser session | Both browser opt-ins and the exact-origin grant are active; the owned proxy validates DNS and redirects |
| Hugging Face (`huggingface.co`, `us.aws.cdn.hf.co`, `cas-bridge.xethub.hf.co`) | The user downloads pinned Whisper artifacts in Settings > Dictation |
| Parts suppliers: Mouser, DigiKey, TME, Farnell (`api.element14.com`), Rutronik | The `parts-search` plugin is installed and enabled, web access is on, and the supplier is enabled with the user's own key |
| Any http or https link | The user clicks it and confirms; it opens in the system browser |
| Whatever a plugin program or command contacts | That program runs; outside VERA's control |

Offline: the app starts, opens workbenches, indexes and searches documents with the bundled models,
and runs sessions against a local endpoint. Remote providers, web tools, parts search, update and
catalog checks fail with an error and do not block the rest.

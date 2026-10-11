# VERA software

The npm workspaces of VERA — `packages/shared`, `packages/core`, `apps/desktop`, `apps/cli` — with
end-to-end tests and development scripts. Layout and module boundaries:
[01-system.md §4–§5](../00_Planning/architecture/01-system.md). The desktop shell provides Welcome and App Settings, responsive panels and persisted appearance/language through the validated typed IPC bridge.

The catalog checker also accepts `npm run check:i18n -- --fixture fixtures/i18n/missing-key.json`
for its negative CLI regression; this fixture deliberately exits1.

## Set-up and commands

From the repository root, once: `python 02_Tools/setup.py` (Ubuntu: `python3`). It installs the pinned
Node.js into `02_Tools/runtime/` and runs `npm ci` here. Then, from this folder:

| Command | Does |
|---|---|
| `npm run verify` | lint, typecheck, catalog audit and tests |
| `npm run lint` / `npm run format` | Biome: check / apply formatting and safe fixes |
| `npm run check:i18n` | English usage plus en/ro/de completeness; rejects missing, unused and translation-only keys |
| `npm run typecheck` | `tsc -b` |
| `npm test` | Vitest |
| `npm run dev` | Electron main, sandboxed preload and React renderer with loopback Vite/HMR |
| `VITE_API=mock npm run dev:renderer` | Full foundation UI using in-memory settings, metadata and app events |
| `npm run build` | Build main ESM, preload CommonJS and bundled renderer into `apps/desktop/out/` |
| `npm run prepare:model` | Fetch and verify immutable, SHA256-pinned embedding assets; `-- --offline` verifies cached files only |
| `npm run package` / `npm run package:test` | Build native x64 zip/AppImage with release / compiled test identity, verified model assets and size/hash report |
| `npm run test:e2e` | Build, then Playwright Electron and Chromium mock acceptance; uses `xvfb-run -a` on Linux |
| `npm run build:cli` | Bundle the headless `vera` bin and isolated grep worker |
| `npm run vera -- run …` | Build the headless CLI and execute one durable session turn |

Without Node on the PATH, prefix any command with `python ../02_Tools/npmw.py`, for example
`python ../02_Tools/npmw.py npm run verify`. Full command list: [08-quality.md §1](../00_Planning/architecture/08-quality.md).

| File | Purpose |
|---|---|
| `package.json`, `package-lock.json`, `.npmrc` | workspaces, scripts, exact pins |
| `biome.json` | lint and format rules; the import boundaries of 01 §4 |
| `tsconfig.base.json`, `tsconfig.json`, `tsconfig.tools.json` | compiler options, `tsc -b` solution, tooling project |
| `vitest.config.ts` | test projects |
| `tests/tooling/` | tests of the repository's own checks |

The four workspaces are `@vera/shared`, `@vera/core`, `@vera/desktop` and `@vera/cli`. Each extends
the shared TypeScript base and participates in `tsc -b`. The desktop project separates Node, preload,
DOM renderer and build configuration type environments. Shared publishes typed zod IPC contracts;
core publishes host ports and versioned settings; CLI composes the durable session service with Node ports. Desktop Vite main
resolves core/shared from source; sandbox preload/renderer resolve shared from source,
so build and development work before compiled library output exists.

The desktop shell displays name, version, platform, architecture, portable marker and OS locale from `app.info`, and saves normal window bounds in `<userData>/window-state.json`.
Welcome and Settings use memory navigation; Ctrl+, opens Settings without changing the authorized URL.
Appearance selects Light/Dark/System and five text scales from a 14px base; controls and code use rem.
Main follows the saved preference with nativeTheme.themeSource. Panels resize by pointer or arrow/Home/End keys and collapse; right-panel content overlays below1280px.
Renderer geometry lives in the separately versioned localStorage key vera.ui.layout; future versions and read-only settings preserve stored bytes.
The strict application settings schema stays authoritative. Providers edits credentials and custom endpoints. Updates, Data & privacy and About are placeholder sections (About also shows metadata).

Production loads bundled assets through the confined `vera://app` protocol, with the same restrictive
CSP in both the HTML meta and response headers. Development uses `http://127.0.0.1:5173` and permits
the hashed React refresh preamble, injected development CSS and the exact HMR websocket. Production
compiles out the development URL branch. The preload is bundled as `.cjs` because Electron's sandbox
does not support ESM preload imports; TypeScript sources and the main process use ESM.

Set `VERA_TEST=1` while building to compile the test-build constant to true (PowerShell:
`$env:VERA_TEST="1"`; then run the build; remove it afterward with `Remove-Item Env:VERA_TEST`).
Instrumented packages accept `--packaging-probe=<absolute JSON path>` for temporary SQLite and worker embedding measurements; release application code excludes this hook and its fixtures. The ordinary build ignores runtime `VERA_TEST` and renderer
URL overrides. Automated tests use temporary user data, enforce Chromium sandboxing, and reject
non-loopback connections in Chromium and Node. Screenshots are captured for human inspection.

`npm ci` runs `install-electron` to install the pinned Electron binary; npm's allowScripts entries
permit the pinned esbuild install scripts. Ubuntu requires the libraries and Xvfb listed by
`python3 ../02_Tools/setup.py --check`; keep Linux and Windows `node_modules` separate.
Native dependencies use their pinned N-API prebuilds. Their install scripts are explicitly denied,
including ONNX optional CUDA downloads; packaging retains host x64 runtime files, filters Linux
CUDA/TensorRT binaries and uses the CPU execution provider. Windows keeps upstream ORT companion DLLs.

Packaging uses electron-builder 26.17.0, better-sqlite3 13.0.3, transformers 4.3.1 and
onnxruntime-node 1.30.0. `resources/model-manifest.json` pins all seven q8
bge-small-en-v1.5 assets to an immutable upstream revision, with bytes and SHA256.
Downloaded assets under `resources/models/` are ignored and reverified before packaging.
The runtime uses local files with remote models disabled. This model is the WP-05 feasibility
fixture; WP-24 owns the final model and recall evaluation.

Generated artifacts and `package-report.json` reside in `release/{test,release}/`.
The report includes artifact SHA256/bytes, unpacked bytes, ONNX/model contributions and largest files.
Windows zip builds fail above 250,000,000 bytes. Native libraries, including sharp's shared
libraries, are unpacked; models are real `extraResources` files.
[WP-05 measurements and execution procedures](../06_SoftwareDocu/wp05-packaging-measurements.md)
records current connected Windows ZIP and offline Linux acceptance. Full distribution targets,
clean/offline Windows and VC++ runtime independence proof, and release smoke remain WP-30/WP-33
before final release.

The renderer uses one `api/` interface: `ipcApi` wraps `window.vera`; `mockApi` supplies the same
app.info, app.settings.get/update and app subscriptions in memory. The OpenAI browser fixture catalog contains mock-openai and is available offline before auth; mock Test honors explicit model overrides and separate authentication. The API exposes
getSettings/updateSettings returning {settings,readOnly}. TanStack Query owns metadata and settings snapshots; mutations apply confirmed preferences and settings.changed invalidates the cache.
i18next catalogs in `src/renderer/locales/{en,ro,de}.json` cover labels, accessible names and structured error keys/params. System language resolves the OS locale, with English fallback. App subscriptions are invalidation signals; later event domains
add their own schemas and services. `portable` reports a `vera.portable` marker beside the executable;
the regular marker selects adjacent data before readiness. Installed mode uses Electron userData,
with --user-data-dir available for isolated tests. Selected portable/override directories are created
before Electron setPath and readiness; existing contents persist and creation errors propagate.
Settings live in settings.json, schema version 4; defaultModel is a nullable validated provider/model reference.
Versions0/1/2/3 migrate after an exclusive original-byte bak-n; future schemas expose read-only defaults.
Accepted partial updates serialize and emit settings.changed after successful atomic saves.
Host logs retain seven UTC daily JSON-line files under userData/logs and redact registered secrets.
[Application data](../.agentic/knowledge/app-data.md) routes schemas, migrations and host adapters.

Before browser acceptance, run `python ../02_Tools/npmw.py npx playwright install chromium` once
(Ubuntu: python3). In PowerShell, browser mock development uses `$env:VITE_API="mock"`, then
`python ../02_Tools/npmw.py npm run dev:renderer`; remove the variable with `Remove-Item Env:VITE_API`
when returning to Electron development. The mock fixture version is taken from the desktop manifest.

## Headless CLI

Run from this folder on a copy of the demo workbench:

```text
python ../02_Tools/npmw.py npm run vera -- run --workbench <copied-demo-dir> --prompt "Read the board" --provider replay --script fixtures/llm-scripts/read-then-answer.jsonl
```

`--provider openai --model <id>` uses `OPENAI_API_KEY`; `--provider custom --base-url <http(s)://host/v1> --model <id>` uses the ordinary custom gateway. A plain UTF-8 `--key-file <file>` overrides the environment key. Credentials remain in memory and all event/log/usage output passes through the shared scrubber. Provider defaults to OpenAI, which requires `--model`; replay explicitly selects only the supplied script.

`--format jsonl` (default) emits `{sessionId,seq?,event}` records; live events omit `seq`. `--format pretty` emits one escaped line per event. `--session <id>` resumes the workbench's persisted session transcript and prints new events using the invocation's selected provider/model. `--data <dir>` preserves settings in that directory; the default data directory is temporary and removed after the run. Sessions remain in `<workbench>/.vera/vera.db`. SIGINT/SIGTERM abort the active turn and drain sessions/workers before releasing the workbench lock. Exit codes are0 for `end`/help,1 for operational errors, `error`, `aborted` or `limit`, and2 with usage text for invalid arguments. Context budgets and the10000ms grep worker deadline use the same core policy as desktop; irreducible input prints structured `CONTEXT_LIMIT` before gateway dispatch.

`npm run build:cli` writes `apps/cli/dist/index.js`; the workspace `vera` bin points there. Headless replay is part of the CLI interface. Desktop replay retains its compiled instrumented-build boundary.

## Workbenches

Welcome creates a workbench in an existing chosen folder without workbench.yaml, preserves existing user content and opens existing folders. Recent entries persist in schema4 settings; versions0/1/2/3 migrate with byte-identical backups. Missing folders display a disabled Open action and can be removed from the list. Active workbenches expose explicit Close and the WORKBENCH.md editor; context above16KB warns and saves full content.

Workbench format1 retains unknown keys and warns. A live process lock opens read-only; a dead process lock is taken over. Ambiguous lock coordination opens read-only with a warning. Network shares warn as unsupported; use local disk folders. File completion exposes up to50 relative paths under common ignore rules. Runtime content stays in .vera with its own ignore file. See [workbench architecture](../00_Planning/architecture/02-workbench.md).

For native folder-dialog acceptance, compile instrumented code by setting VERA_TEST=1 before npm run test:e2e. VERA_TEST_DIALOG_PATH chooses the temporary folder only in emitted instrumented builds; release emission omits this environment hook. Test fixtures are copied from fixtures/workbenches/demo-board; runtime never modifies the source fixture. Mock API exposes empty, missing, read-only and warnings scenarios through createMockApi for browser/component tests.

Settings → Providers configures OpenAI API keys/models and multiple OpenAI-compatible `/v1` endpoints. Keys are masked and cleared after saving; only bounded hints return from main. Custom defaults are32768 context tokens and4096 output tokens, with a positive input budget after the architectural safety margin. Credential JSON uses safeStorage encryption; unavailable or Linux basic_text storage asks each time whether to keep the key only for this run or persist without secure encryption. Future settings/credential formats preserve bytes. See [.agentic/knowledge/providers.md](../.agentic/knowledge/providers.md) for the API and recovery contract.


## Model gateway and provider tests

Settings → Providers → Test reports reachability, authentication, tools and streaming separately in en/ro/de. Unsupported `/models` listing is skipped; authentication, echo-tool completion and multiple streamed text chunks are measured. A tested custom provider records `supportsTools` only if its configuration is still current and writable. Public catalogs/results contain no credential values.

Core pins `@earendil-works/pi-ai`1.1.0. Model references use `providerId/modelId` and preserve slashes in model IDs. Selection is session, workbench, then app default. Fresh capabilities expose context/output limits, safety margin and input budget before dispatch. OpenAI uses its pinned static catalog; custom endpoints discover `/models` and attach configured limits to IDs. API authentication uses the main credential store; subscription collection remains empty. Malformed discovered IDs fail at the core boundary. Errors distinguish offline, authentication, rate limit and context failure. Streams scrub retained credentials across text/tool chunk boundaries and recursively scrub assistant metadata/signatures, preserve numeric usage and use the host Clock for terminal timestamps.

Automated model tests use deterministic replay or loopback scripted servers. Unit tests and native/browser acceptance reject non-loopback requests. A build made with `VERA_TEST=1` can select a JSONL fixture directory through `VERA_REPLAY_DIR`; release emits neither replay implementation nor registration. Scripts use one object per line with `text`, `toolCalls:[{name,args}]` and optional first-line `match`; `replay/<filename>` selects explicitly and `replay/auto` matches the latest user text. The step is the assistant count since that user; successful tool-result JSON string fields and `{name,ref}` artifact bindings replace `{{field}}` and `{{artifact:name}}`. Core's explicit `@vera/core/replay` subpath is for tests.

Run real-provider smoke manually from this folder after configuring a real OpenAI API key/model or a local OpenAI-compatible model such as Ollama in VERA:

```text
python ../02_Tools/npmw.py npm run smoke:live -- --provider custom:ollama --data <absolute VERA userData>
```

Use `--provider openai` for the stored OpenAI configuration; omit `--data` to use the installed app store. The command builds release, launches the ordinary main host, prints scrubbed per-step JSON and exits0 only when mandatory steps pass (unsupported listing may be skipped). Linux requires a desktop display or `xvfb-run -a`. Manual smoke may consume API quota; it is separate from automated checks and must be observed before declaring WP09 complete.

The session workspace supports keyboard session CRUD, Enter/Shift+Enter composer, @ path completion, model catalogs, Stop, Markdown/code, tool disclosures, citation chips and usage/context limits. Browser `?mock=chat` adds empty, streaming, tool/citation, invalid citation, provider error and context-limit sessions. Chat component tests live in `apps/desktop/src/renderer/components/session/workspace.test.ts`; native Stop/restart/reload/grep acceptance in `e2e/chat-ui.spec.ts`.

The repository npm configuration keeps CLI stdout as event-only JSONL by suppressing run-script banners. Replay records decode JSON escapes and scrub registered credentials before temporary staging and durable messages.

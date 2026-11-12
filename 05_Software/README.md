# VERA software

For already-built release acceptance, use `npm run smoke:package -- --artifact <path>`;
see [release smoke](../06_SoftwareDocu/release-package-smoke.md) for external egress,
separate test-renderer calibration, original updater-probe (`--upgrade-proof`) report bindings and pending manual Windows capture.

The npm workspaces of VERA — `src/libraries/shared`, `src/libraries/core`, `src/apps/desktop`, `src/apps/cli` — with
end-to-end tests and development scripts. Layout and module boundaries:
[01-system.md §4–§5](../00_Planning/architecture/01-system.md). The desktop shell provides Welcome and App Settings, responsive panels and persisted appearance/language through the validated typed IPC bridge.

The catalog checker also accepts `npm run check:i18n -- --fixture tests/fixtures/i18n/missing-key.json`
for its negative CLI regression; this fixture deliberately exits1.

## Directory layout

```text
src/
  apps/desktop/       Electron application and React interface
  apps/cli/           Command-line application
  libraries/core/     Shared product logic
  libraries/shared/   Validated contracts and data types
  models/             BGE manifest and local model assets
  windows_runtime/    Microsoft runtime manifest and local DLLs
tests/
  e2e/                Playwright Electron and browser acceptance
  tooling/            Build, configuration and verification infrastructure tests
  integration/        CLI, documents, workers and retrieval tests
  packaging/          Distribution, package smoke, update probe and update tests
  fixtures/           Test-only documents, replay scripts and scenarios
  support/            Test runners, reporters, network guard and fixture generators
evaluators/           Measurement and scoring harnesses, one folder per evaluator family
evaluation-outputs/   Generated evaluator runs, ignored by Git
release_tmp/          Ignored packaging workspace
node_modules/         Ignored installed dependencies
```

Unit and component tests remain beside the implementation in `src/`. Environment, build and
release tooling lives in [02_Tools](../02_Tools/README.md); it resolves packages from this
folder's `node_modules/`, so there is a single dependency tree.

The bundled official `analysis-skills` plugin supplies captured `firmware-comparator` and sourced
manual `test-planner` procedures with on-demand templates. Install from its folder or local catalog,
then enable it per workbench. Test plans include readiness, one to five cases and future results to
collect; they execute no programs or hardware operations. See [plugin instructions](plugins/analysis-skills/README.md)
and the separate real-model verification beside each skill.

The desktop uses one compact title/menu row with native window controls. The sidebar
toggle switches between full project/session navigation and a compact icon rail; Home,
project navigation and Settings remain reachable. Collapse and panel sizes persist.
Settings opens its sidebar automatically and displays one selected category at a time;
Up/Down and Home/End select categories. Providers, Appearance, Language, Updates and About
contain current controls; Notifications, Keyboard shortcuts, Storage, Configuration and
Data & privacy show a placeholder until implemented.
Appearance offers the same six named sizes for interface, conversation and code/output:
Extra small, Small, Normal, Large, Extra large and Largest. Sizes remain independent,
with immediate previews; numeric dimensions are internal. Normal is the default.
Changes save automatically; Restore default text sizes resets only these three controls.
Providers separates Subscriptions from API / local connections. Saved connections have
Edit/Test/Remove actions; Add connection opens an OpenAI API, LM Studio, Ollama or other
compatible-provider editor. Local presets prefill editable addresses without model names;
keys are optional for local/custom connections. Multiple connections coexist with ChatGPT.
ChatGPT shows only Sign in or Sign out as appropriate; callback ports stay out of the summary.
LM Studio setup accepts a server origin (or its `/v1` URL), then an optional key.
Test connection reads the current `/api/v1/models` catalog before any configuration is
saved. Only conversation models appear. Each model keeps its configured context/output
limits and optional reasoning/temperature; loaded context is distinguished from maximum
supported context. The conversation model selector uses these per-model limits. Unset
parameters are omitted from inference requests; reasoning Off uses `reasoning_effort: none`
on the compatible route, while On uses the reported effort default or Medium.
Draft keys stay outside query caches and saved keys cannot be sent to a changed origin.
Preset addresses follow [LM Studio](https://lmstudio.ai/docs/developer/openai-compat/tools)
and [Ollama](https://github.com/ollama/ollama/blob/main/docs/api/introduction.mdx).
Development (`npm run dev`) watches main/preload modules as well as the renderer,
so shared IPC/settings contract changes rebuild the native layers automatically.
F10 focuses the menu bar; arrow keys move between menus. Application information lives
in Settings → About, while Home contains workbench creation/opening and recents.

The fictional corpus in `tests/fixtures/workbenches/demo-board/` is copied only into isolated verification workbenches. The application opens user-selected projects and packages real model/runtime resources.
Configuration and npm workspace manifests remain at the software root.

Model/DLL binaries in `src/models/` and `src/windows_runtime/` are ignored by Git;
their manifests remain versioned beside them. Packaging maps these source locations
to the installed application resource layout (`models/` and app-local native DLLs).

The [tooling catalog](../02_Tools/README.md) describes the environment, build and release
commands. [Tests](tests/README.md) and [evaluators](evaluators/README.md) describe their runners
and harnesses, with separate guides for [retrieval](evaluators/retrieval-support/README.md) and
[Windows Sandbox](../02_Tools/release/sandbox/README.md).

## Set-up and commands

From the repository root, once: `python 02_Tools/environment/setup.py` (Ubuntu: `python3`). It installs the pinned
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
| `npm run build` | Build main ESM, preload CommonJS and bundled renderer into `src/apps/desktop/out/` |
| `npm run prepare:model` | Fetch and verify immutable, SHA256-pinned embedding assets; `-- --offline` verifies cached files only |
| `npm run prepare:uv` | Fetch and verify the pinned uv for this platform into `src/uv/<platform>/` (archive and binary SHA-256 from `src/uv/uv-manifest.json`); `-- --offline` uses the cached archive only. Plugin programs (pip, script) install with it |
| `npm run package` / `npm run package:test` | Build native x64 NSIS + portable ZIP (Windows) or AppImage + deb (Linux), release / labelled test identity, pinned assets and SHA256/size report |
| `npm run test:e2e` | Build, then Playwright Electron and Chromium mock acceptance; uses `xvfb-run -a` on Linux |
| `npm run build:cli` | Bundle the headless `vera` bin and isolated grep worker |
| `npm run vera -- run …` | Build the headless CLI and execute one durable session turn |

E2E results are printed in the terminal. Screenshots, videos and traces are disabled;
Playwright uses an isolated system temporary directory and removes it after each normal run,
including failed tests. No `test-results/` directory is retained in the repository.

Without Node on the PATH, prefix any command with `python ../02_Tools/environment/npmw.py`, for example
`python ../02_Tools/environment/npmw.py npm run verify`. Full command list: [08-quality.md §1](../00_Planning/architecture/08-quality.md).

| File | Purpose |
|---|---|
| `package.json`, `package-lock.json`, `.npmrc` | workspaces, scripts, exact pins |
| `biome.json` | lint and format rules; the import boundaries of 01 §4 |
| `tsconfig.base.json`, `tsconfig.json`, `tsconfig.tools.json` | compiler options, `tsc -b` solution, tooling project |
| `vitest.config.ts` | test projects |
| `tests/tooling/` | tests of configuration, build and verification infrastructure |
| `tests/integration/` | cross-component CLI, document, worker and retrieval tests |
| `tests/packaging/` | distribution, smoke tooling and update tests |

The [test inventory](tests/README.md) describes the categories and commands for
running one Vitest project or a selected file.

The four workspaces are `@vera/shared`, `@vera/core`, `@vera/desktop` and `@vera/cli`. Each extends
the shared TypeScript base and participates in `tsc -b`. The desktop project separates Node, preload,
DOM renderer and build configuration type environments. Shared publishes typed zod IPC contracts;
core publishes host ports and versioned settings; CLI composes the durable session service with Node ports. Desktop Vite main
resolves core/shared from source; sandbox preload/renderer resolve shared from source,
so build and development work before compiled library output exists.

The desktop shell displays name, version, platform, architecture, portable marker and OS locale from `app.info`, and saves normal window bounds in `<userData>/window-state.json` (version 1). An invalid, other-version or off-screen file uses centred defaults and is overwritten on close.
Welcome and Settings use memory navigation; Ctrl+, opens Settings without changing the authorized URL.
Appearance selects Light/Dark/System and five text scales from a 14px base; controls and code use rem.
Main follows the saved preference with nativeTheme.themeSource. Panels resize by pointer or arrow/Home/End keys and collapse; right-panel content overlays below1280px.
Renderer geometry lives in the separate localStorage key vera.ui.layout at version 1, with a required source width; invalid or other-version data uses the defaults.
The strict application settings schema stays authoritative. Providers edits credentials and custom endpoints. Updates, Data & privacy and About are placeholder sections (About also shows metadata).

Skills settings opens from Edit workbench → Tools/skills or session Context. Skills live at
`<workbench>/.vera/skills/<name>/SKILL.md` or `<userData>/skills/<name>/SKILL.md`; workbench
folders take precedence. Create supplies an editable template; invalid skills show
diagnostics, and disabled/invalid skills stay outside the next-turn prompt index.
The agent loads enabled instructions and confined extra files with `load_skill`.

Production loads bundled assets through the confined `vera://app` protocol, with the same restrictive
CSP in both the HTML meta and response headers. Development uses `http://127.0.0.1:5173` and permits
the hashed React refresh preamble, injected development CSS and the exact HMR websocket. Production
compiles out the development URL branch. The preload is bundled as `.cjs` because Electron's sandbox
does not support ESM preload imports; TypeScript sources and the main process use ESM.

Set `VERA_TEST=1` while building to compile the test-build constant to true (PowerShell:
`$env:VERA_TEST="1"`; then run the build; remove it afterward with `Remove-Item Env:VERA_TEST`).
Instrumented packages accept `--packaging-probe=<absolute JSON path>` for temporary SQLite and worker embedding measurements; release application code excludes this hook and its fixtures. The ordinary build ignores runtime `VERA_TEST` and renderer
URL overrides. Automated tests use temporary user data, enforce Chromium sandboxing, and reject
non-loopback connections in Chromium and Node. Automated E2E runs retain no screenshots or traces.

`npm ci` runs `install-electron` to install the pinned Electron binary; npm's allowScripts entries
permit the pinned esbuild install scripts. Ubuntu requires the libraries and Xvfb listed by
`python3 ../02_Tools/environment/setup.py --check`; keep Linux and Windows `node_modules` separate.
Native dependencies use their pinned N-API prebuilds. Their install scripts are explicitly denied,
including ONNX optional CUDA downloads; packaging retains host x64 runtime files, filters Linux
CUDA/TensorRT binaries and uses the CPU execution provider. Windows keeps upstream ORT companion DLLs.

Packaging uses electron-builder 26.17.0, better-sqlite3 13.0.3, transformers 4.3.1 and
onnxruntime-node 1.30.0. `src/models/model-manifest.json` pins all seven q8
bge-small-en-v1.5 assets to an immutable upstream revision, with bytes and SHA256.
Downloaded assets under `src/models/` are ignored and reverified before packaging.
The runtime uses local files with remote models disabled. ADR0015 selects this BGE model after
the retrieval evaluation; packaging preserves its descriptor and fingerprints.

Generated artifacts and `package-report.json` reside in `release_tmp/{test,release}/`.
`release_tmp/` is an ignored, rebuildable packaging workspace, including staging directories;
selected validated deliverables belong in `../07_Delivery/`.
The schema2 report includes each artifact's SHA256/bytes, source/config hashes, per-target ASAR and
executable hashes, prepack outcomes, unpacked/native/model contributions and largest files.
Installer and ZIP sizes are measured and reported; there is no size budget (ADR-0017). ZIP alone ships `vera.portable`. Native libraries are unpacked; models are real
`extraResources` files. Local pdfjs CMaps/standard fonts/WASM ship with the renderer.

Windows also ships five app-local Microsoft VC++14.44.35211.0 DLLs pinned by
`src/windows_runtime/windows-runtime-manifest.json`. `npm run prepare:windows-runtime` verifies the cache or
materializes the exact bytes from Microsoft-signed source files. `VERA_VC_REDIST_DIR` selects an
approved redistributable folder; the default is System32. Different bytes fail rather than updating
pins. Preparation is build-time only. Generated DLL caches are ignored by Git.

`CSC_LINK`/`WIN_CSC_LINK` and corresponding passwords enable required Authenticode signing;
certificate-store selectors `VERA_CERTIFICATE_SHA1` or `VERA_CERTIFICATE_SUBJECT` are also supported.
Requested signing must verify successfully. Without credentials, unsigned builds are permitted; the
signing state is computed in `app.info` but About does not display it. Instrumented distributions use VERA Test, a separate
appId/executable/package name and labelled filenames; release excludes all test hooks.
[Native packaging](../.agentic/knowledge/native-packaging.md) documents the build pipeline. Actual
clean/offline Windows and VC++ self-containment on that environment remain pending before final
release; static import closure or current-host loaded modules supplement this requirement.
Full scripted session, update and external egress acceptance belongs to WP31–33.

The renderer uses one `api/` interface: `ipcApi` wraps `window.vera`; `mockApi` supplies the same
app.info, app.settings.get/update and app subscriptions in memory. The OpenAI browser fixture catalog contains mock-openai and is available offline before auth; mock Test honors explicit model overrides and separate authentication. The API exposes
getSettings/updateSettings returning {settings}. TanStack Query owns metadata and settings snapshots; mutations apply confirmed preferences and settings.changed invalidates the cache.
i18next catalogs in `src/renderer/locales/{en,ro,de}.json` cover labels, accessible names and structured error keys/params. System language resolves the OS locale, with English fallback. App subscriptions are invalidation signals; later event domains
add their own schemas and services. `portable` reports a `vera.portable` marker beside the executable;
the regular marker selects adjacent data before readiness. Installed mode uses Electron userData,
with --user-data-dir available for isolated tests. Selected portable/override directories are created
before Electron setPath and readiness; existing contents persist and creation errors propagate.
Settings live in settings.json, schemaVersion 1; defaultModel is a nullable validated provider/model reference.
The schema is strict: unknown keys are invalid and webAccess is required. Settings are never read-only.
An unreadable or invalid file, including any other schemaVersion, gives INVALID, stays untouched and stops
startup (app.startup.failed); the CLI fails the same way. There are no migrations or backups.
Accepted partial updates serialize and emit settings.changed after successful atomic saves.
Host logs retain seven UTC daily JSON-line files under userData/logs and redact registered secrets.
[Application data](../.agentic/knowledge/app-data.md) routes schemas, validation and host adapters.

Before browser acceptance, run `python ../02_Tools/environment/npmw.py npx playwright install chromium` once
(Ubuntu: python3). In PowerShell, browser mock development uses `$env:VITE_API="mock"`, then
`python ../02_Tools/environment/npmw.py npm run dev:renderer`; remove the variable with `Remove-Item Env:VITE_API`
when returning to Electron development. The mock fixture version is taken from the desktop manifest.

Packaging checks every offline PDF CMap/font/WASM resource against the pinned pdfjs-dist source bytes in staging and final ASAR. When both Windows certificate SHA1 and subject selectors are supplied, both constrain certificate selection.

## Headless CLI

Index and search local workbench documents with `npm run vera -- index --workbench <dir>`
and `npm run vera -- search --workbench <dir> --query "I2C1_CR1"`. Search defaults to
hybrid/k8; use `--mode keyword|semantic|hybrid`, `--k 1..20` and `--path-glob` to narrow
results. Index uses the bundled local CPU model and reports per-document statuses;
a protected read-only workbench permits search and rejects index. Agent `search_docs`
returns precise references/snippets; `read_doc` returns complete extracted pages,
heading sections or lines with an exact reference and a12000-character limit.
`npm run eval:retrieval` checks the frozen demo hybrid recall floors and reports
keyword/semantic separately. Optional `-- --scratch <dir> --output <new.json>` retains
the report; each run cleans its own temporary worker bundle.

Run from this folder on a copy of the demo workbench:

```text
python ../02_Tools/environment/npmw.py npm run vera -- run --workbench <copied-demo-dir> --prompt "Read the board" --provider replay --script tests/fixtures/llm-scripts/read-then-answer.jsonl
```

`--provider openai --model <id>` uses `OPENAI_API_KEY`; `--provider custom --base-url <http(s)://host/v1> --model <id>` uses the ordinary custom gateway. A plain UTF-8 `--key-file <file>` overrides the environment key. Credentials remain in memory and all event/log/usage output passes through the shared scrubber. Provider defaults to OpenAI, which requires `--model`; replay explicitly selects only the supplied script.

`--format jsonl` (default) emits `{sessionId,seq?,event}` records; live events omit `seq`. `--format pretty` emits one escaped line per event. `--session <id>` resumes the workbench's persisted session transcript and prints new events using the invocation's selected provider/model. `--data <dir>` preserves settings in that directory; the default data directory is temporary and removed after the run. Sessions remain in `<workbench>/.vera/vera.db`. SIGINT/SIGTERM abort the active turn and drain sessions/workers before releasing the workbench lock. Exit codes are0 for `end`/help,1 for operational errors, `error`, `aborted` or `limit`, and2 with usage text for invalid arguments. Context budgets and the10000ms grep worker deadline use the same core policy as desktop; irreducible input prints structured `CONTEXT_LIMIT` before gateway dispatch.

`--approve all` approves pending ask/protected changes; `--approve none` denies them. With no flag, an interactive stdin+stderr terminal shows the exact patch and accepts A/D on stderr; noninteractive invocation safely denies. A denied tool can still conclude with exit0. `read-only` always rejects writes, and ordinary `auto-edit` requests are decided by mode.

`npm run build:cli` writes `src/apps/cli/dist/index.js`; the workspace `vera` bin points there. Headless replay is part of the CLI interface. Desktop replay retains its compiled instrumented-build boundary.

## Workbenches

The sidebar exposes New Workbench, Open Workbench and Plugins. Registered
workbenches remain until explicitly removed and can be pinned, expanded to show
sessions, edited, or opened in Explorer. Pinning is an application preference.
Selecting a workbench opens its overview with folder, configuration and dated session count/list; selecting a session opens its conversation. The overview provides a single Edit action for project settings. Tools/skills management and WORKBENCH.md editing are accessed inside that editor; Close is in the workbench sidebar menu. Settings replaces primary New/Open/Plugins actions with its categories and a Back to workbenches action. The sidebar shows workbench/session groups without search inputs. With no selected workbench, the main canvas shows VERA branding; New/Open are explicit actions.
The project editor saves name, description, document include/exclude patterns,
agent model/permissions, disabled tools/skills, instructions and embedding chunk settings.
Plugins installs packages from folders, zips or the catalog through a review screen. Management and catalog settings stay above the Available/Installed tabs. Search all words and combine ecosystem, activity, provenance and state filters; sort by publication dates or name and page through 6/12/24 entries. Publication dates may be unavailable. Dependency checks are explicit; browsing never runs probes, installs programs or enables a package.
A workbench can carry portable packages in `.vera/plugins/<id>/` (commit these folders to Git).
These start untrusted at each new workbench location and on each machine. On the Plugins page, choose
**Review workbench plugin**, inspect the source, programs, risks and SHA-256, then **Trust this package**.
Trust is separate from workbench selection and **Install programs**. Refresh plugins after a pull;
any changed helper, skill or other package file needs a new review before use, including in Bypass.
The verified copy and trust record live only under application userData, never in `.vera` or exports.
An id colliding with a globally installed plugin blocks both in that workbench; rename/remove one
package or uninstall the global plugin. Program-name collisions retain the ambiguous-program refusal.
`requires` is descriptive: install, review and enable dependencies separately; no automatic installs.
The agent drafts plugins outside `.vera/plugins`; only the user manages portable installed packages.

To choose plugins for a project, open **Edit workbench → Plugins**, select or deselect installed packages, then **Save**. The same section is available in New Workbench; every new workbench starts with no plugins selected. Cancel leaves existing choices unchanged, and choices apply only to that workbench. Installation and program setup remain on the global Plugins page.

CLI users inspect and trust the same packages with a persistent application data directory:

```sh
npm run vera -- plugin list --workbench /path/to/bench --data /path/to/data
npm run vera -- plugin review --id bench-tools --workbench /path/to/bench --data /path/to/data
npm run vera -- plugin trust --id bench-tools --sha256 <reviewed-hash> --workbench /path/to/bench --data /path/to/data
npm run vera -- plugin provision --id bench-tools --workbench /path/to/bench --data /path/to/data
```

Review prints the exact hash and manifest; trust refuses stale hashes and never enables or provisions.
`vera run --data` uses reviewed, enabled packages. list/review/trust print JSON and exit 0 on success;
operational errors exit 1, usage errors 2. provision exits 0 only when every program is ready.

Each workbench uses one root with user-owned subfolders. The `embeddings` block in
`.vera/workbench.yaml` selects the installed `Xenova/bge-small-en-v1.5` model and
sets `chunkSize` (200–1400 characters, default 1400) and `overlap` (0–600 characters,
smaller than chunkSize, default 200). Token limits can shorten chunks; effective
overlap is capped at half the actual fragment to preserve bounded progress.
Overlap stays within each PDF page or Markdown/HTML section and runs across text
log lines. Changing these settings rebuilds document-derived rows in the background,
reusing extraction caches. Embeddings and conversation models are separate settings.


Project metadata lives in `<project>/.vera/`: `workbench.yaml` (configuration),
`WORKBENCH.md` (pinned engineering context), optional `.veraignore` (project-relative
ignore patterns), and `skills/<name>/SKILL.md` (project skills). SQLite, locks,
downloads and session artifacts use the same `.vera` folder. User documents and
sources remain relative to the selected project root. Ordinary file tools and
document indexing exclude `.vera`; skills use the dedicated bounded loader.
The current layout is authoritative: opening requires `.vera/workbench.yaml`.
Root-level files are ordinary project content and are never detected or migrated.
Global application settings, credentials and user skills remain in userData.
New databases are created directly with the complete current schema, meta schema_version "1".
Existing databases are validated and opened without migrations or automatic database backups;
their data and metadata are preserved. Any other schema_version or an incomplete schema gives
INVALID without repair, and the file stays untouched.
Workbench creation and opening manage only `.vera/`; they do not create or impose
a `docs/` directory. Document folders belong to the user. The default `docs/**`
indexing pattern is configurable through `docs.include` and `docs.exclude` in
`.vera/workbench.yaml` and does not create folders. Existing document folders are
left in place.

Welcome creates a workbench in an existing chosen folder without .vera/workbench.yaml, preserves existing user content and opens existing folders. Recent entries persist in settings. Missing folders display a disabled Open action and can be removed from the list. Active workbenches expose explicit Close and the .vera/WORKBENCH.md editor; context above16KB warns and saves full content.

Workbench format1 retains unknown keys and warns; any other format gives CONFIG_INVALID at path format. A live process lock opens read-only; a dead process lock is taken over. Ambiguous lock coordination opens read-only with a warning. Network shares warn as unsupported; use local disk folders. File completion exposes up to50 relative paths under common ignore rules. Runtime content stays in .vera with its own ignore file. See [workbench architecture](../00_Planning/architecture/02-workbench.md).

For native folder-dialog acceptance, compile instrumented code by setting VERA_TEST=1 before npm run test:e2e. VERA_TEST_DIALOG_PATH chooses the temporary folder only in emitted instrumented builds; release emission omits this environment hook. Test fixtures are copied from tests/fixtures/workbenches/demo-board; runtime never modifies the source fixture. Mock API exposes empty, missing, read-only and warnings scenarios through createMockApi for browser/component tests.

Settings → Providers configures OpenAI API keys/models and multiple OpenAI-compatible `/v1` endpoints. Keys are masked and cleared after saving; only bounded hints return from main. Custom defaults are32768 context tokens and4096 output tokens, with a positive input budget after the architectural safety margin. Credential JSON uses safeStorage encryption; unavailable or Linux basic_text storage asks each time whether to keep the key only for this run or persist without secure encryption. Future settings/credential formats preserve bytes. See [.agentic/knowledge/providers.md](../.agentic/knowledge/providers.md) for the API and recovery contract.


## Model gateway and provider tests

Settings → Providers → Test reports reachability, authentication, tools and streaming separately in en/ro/de. Unsupported `/models` listing is skipped; authentication, echo-tool completion and multiple streamed text chunks are measured. A tested custom provider records `supportsTools` only if its configuration is still current and writable. Public catalogs/results contain no credential values.

Core pins `@earendil-works/pi-ai`1.1.0. Model references use `providerId/modelId` and preserve slashes in model IDs. Selection is session, workbench, then app default. Fresh capabilities expose context/output limits, safety margin and input budget before dispatch. OpenAI uses its pinned static catalog; custom endpoints discover `/models` and attach configured limits to IDs. API authentication uses the main credential store; subscription collection remains empty. Malformed discovered IDs fail at the core boundary. Errors distinguish offline, authentication, rate limit and context failure. Streams scrub retained credentials across text/tool chunk boundaries and recursively scrub assistant metadata/signatures, preserve numeric usage and use the host Clock for terminal timestamps.

Automated model tests use deterministic replay or loopback scripted servers. Unit tests and native/browser acceptance reject non-loopback requests. A build made with `VERA_TEST=1` can select a JSONL fixture directory through `VERA_REPLAY_DIR`; release emits neither replay implementation nor registration. Scripts use one object per line with `text`, `toolCalls:[{name,args}]` and optional first-line `match`; `replay/<filename>` selects explicitly and `replay/auto` matches the latest user text. The step is the assistant count since that user; successful tool-result JSON string fields and `{name,ref}` artifact bindings replace `{{field}}` and `{{artifact:name}}`. Core's explicit `@vera/core/replay` subpath is for tests.

Run real-provider smoke manually from this folder after configuring a real OpenAI API key/model or a local OpenAI-compatible model such as Ollama in VERA:

```text
python ../02_Tools/environment/npmw.py npm run smoke:live -- --provider custom:ollama --data <absolute VERA userData>
```

Use `--provider openai` for the stored OpenAI configuration; omit `--data` to use the installed app store. The command builds release, launches the ordinary main host, prints scrubbed per-step JSON and exits0 only when mandatory steps pass (unsupported listing may be skipped). Linux requires a desktop display or `xvfb-run -a`. Manual smoke may consume API quota; it is separate from automated checks and must be observed before declaring WP09 complete.

The session workspace supports keyboard session CRUD, Enter/Shift+Enter composer, @ path completion, model catalogs, Stop, Markdown/code, tool disclosures, citation chips and usage/context limits. Browser `?mock=chat` adds empty, streaming, tool/citation, invalid citation, provider error and context-limit sessions. Chat component tests live in `src/apps/desktop/src/renderer/components/session/workspace.test.ts`; native Stop/restart/reload/grep acceptance in `tests/e2e/chat-ui.spec.ts`.

The composer permission picker sets the current session to read-only, ask, auto-edit or bypass (full file access with automatic approvals, after a warning) and stays available during an active turn. Ask and protected auto-edit changes show inline cards with the prepared patch, byte count, Approve/Deny and Approve-and-switch actions. Focus the card for A/D. Stop or selecting read-only aborts waiting changes; mismatched/stale decisions conflict. New sessions inherit the workbench mode. Known credential-bearing patches are refused before approval persistence and require a human edit. Approval cards persist across reload/restart with their final decision; the sidebar marks waiting sessions. Focused approval tests: core sessions/approvals.test.ts, workspace.test.ts, CLI prompt/process tests and tests/e2e/approvals.spec.ts.

The repository npm configuration keeps CLI stdout as event-only JSONL by suppressing run-script banners. Replay records decode JSON escapes and scrub registered credentials before temporary staging and durable messages.


## Session artifacts

The agent saves UTF8 outputs with `artifact_save` (session class, sequential, no approval), up to5MiB under `.vera/artifacts/<session-id>/<name>`. Use portable ASCII names of at most100 characters and `overwrite:true` to replace an existing artifact. Metadata and `artifact.saved` persist with the session; successful `artifact:<name>` refs validate against that session’s current verified file. Read-only workbenches preserve their files.

The Artifacts tab lists names, bytes and times, opens Markdown/plain text, and offers native Reveal and Export. Export uses a save dialog; cancelling writes nothing. Deleting a session removes its artifact folder. See [artifact contracts](../.agentic/knowledge/artifacts.md) for confinement, crash-mismatch handling and tests. `tests/fixtures/llm-scripts/save-artifact.jsonl` runs in desktop test replay or the ordinary headless replay CLI.

### Session Plan

The `todo` session tool replaces the entire ordered Plan list using `{items:[{id?,text,status}]}` with at most50items, at most200UTF16code units per text and pending/in_progress/done statuses. An empty list clears it. The current SQLite row and `todo.updated` event commit together; Plan consumes session snapshots/live events and restores the final list after restart. Session modes allow the tool; workbench read-only denies mutation. The Plan tab presents localized status icons and labels. `tests/fixtures/llm-scripts/plan-updates.jsonl` drives deterministic acceptance; the browser mock accepts “Update the plan”.

## ChatGPT subscription

In Settings → Providers, choose Sign in with ChatGPT. VERA opens the system browser and uses only the temporary loopback callback on127.0.0.1:1455. If the callback does not complete, paste the full final redirect URL into the manual input. Cancel frees the callback; sign-in times out after ten minutes. A busy1455 error names unfinished Codex CLI sign-in. If secure storage is unavailable, choose memory for this process or explicit unprotected storage. The subscription becomes the app default only when no model is selected. Connected subscription models appear as chatgpt/<model> in the composer; Sign out removes credentials and a subscription app default.

Real acceptance: sign in with your own subscription, run a short session, close and restart VERA with the same user data, run again, then sign out. Fake OAuth tests do not replace this observation.

## Demo document fixtures

Run `python ../02_Tools/environment/npmw.py npm run make:demo-pdfs` from05_Software to
regenerate the three fictional VERA-DEMO-01 PDFs from
`tests/fixtures/workbenches/demo-board/sources/`. Background desktop/CLI ingest extracts
PDF pages in a dedicated worker, caches extraction by SHA256 and persists
page/heading/line chunks. Scanned PDFs report `needs_ocr`.

## Embedding comparison

A historical experiment behind ADR-0015, not a gate. From 05_Software, run the pinned local CPU
comparison:

```powershell
python ../02_Tools/environment/npmw.py node evaluators/eval-embedding-comparison-harness/compare-embeddings.mjs --prepare --scratch node_modules/.cache/evaluators/embedding-comparison/windows --models node_modules/.cache/evaluators/embedding-comparison/models --output evaluation-outputs/embedding-comparison/<run>.json
```

Omit --prepare for verified-cache-only execution; inference always disables remote
model loading. On Ubuntu use python3 and a `linux` scratch child. The report
retains exact corpus/fixture/manifest hashes, timings and keyword/semantic/hybrid
recall by EN/RO. See [retrieval evaluation](../.agentic/knowledge/retrieval-evaluation.md)
and [ADR0015](../00_Planning/decisions/ADR-0015-embedding-model-selection.md).
# Updates

Set VERA_UPDATE_URL to the fixed generic HTTPS feed when building the app/packages.
An unconfigured build reports that state without network requests. Latest is stable;
beta receives newer beta and stable releases. Off, Notify (default), and Download
automatically are persisted in Updates. Check now works in Off. Downloaded updates
install on restart/next quit after active turns and approvals finish.
Portable announces notes and offers a confirmed browser link; deb uses its package manager.

The local acceptance command is `node tests/packaging/probe-upgrade.mjs <absolute-owned-scratch>`.
It builds distinct instrumented0.31.0/0.31.1 artifacts with a compile-time loopback feed
and records managed (deb) metadata-only checks, required SHA512 with refusal of a corrupt hash,
installation deferred until a pending approval finishes followed by a real install, and a
portable release link. It does not check that settings, history or recovery survive an update;
upgrade data safety is deferred until the first public release. Its NSIS/AppImage launch fixtures retain an
explicit isolated userData directory across restart. These are test artifacts and
connected-host evidence; release smoke, clean/offline Windows/CRT and separate Linux
kernel acceptance remain required under the release policy. The command publishes nothing.

Settings → Keyboard shortcuts supports command/key search, editable/removable
aliases, adding combinations and restoring defaults. Ctrl+/ opens that page;
Ctrl+, opens Settings; Ctrl+N or Ctrl+Shift+O starts a session; Ctrl+O opens a
workbench; Ctrl+B or Ctrl+Shift+S toggles the sidebar; Ctrl+Shift+B toggles the
right panel; Ctrl+F searches the current conversation; Ctrl+Shift+M focuses its
model selector. New Workbench and Focus message input are unassigned initially.
Changes persist in application settings; bindings run only while VERA is focused.
Conflicts and reserved native keys are rejected. Dialogs/IME/recording retain
input ownership. Enter/Shift+Enter/Escape remain contextual controls.

### Session reasoning

The conversation offers a reasoning selector beside Model when that model declares supported
levels. Default leaves the provider or saved connection profile in control. The choice is
stored per session under `.vera` and applies to subsequent model requests; a request already
in flight keeps its value. Switching to an incompatible model clears the override.
ChatGPT model IDs and reasoning levels are read from its authenticated model catalog, with
an account-scoped short memory cache. VERA keeps no static model/effort table. LM Studio uses
the model capabilities discovered for the connection. Endpoints without declared capabilities
offer no reasoning override. Codex Ultra is a client orchestration mode and is not sent as
a native Responses reasoning effort. Catalog discovery and inference retain separate routes.

### Chat detail per workbench

Open **Edit workbench → Chat → Detail level** (also available in New Workbench).
**Normal** is the default: routine operations appear in expandable groups.
**Verbose** shows each operation separately, with expandable arguments/results.
**Minimal** hides routine technical activity and shows when VERA is working.
Approvals, errors, stopped-turn notices and useful download actions remain visible.
Full details are always available through **Activity**. Save applies the preference
across the workbench's sessions; Cancel discards the draft. The setting controls display,
without changing model answer length, tool permissions or stored history.

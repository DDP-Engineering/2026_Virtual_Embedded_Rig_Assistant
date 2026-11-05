# Environment guide

Captured firmware comparison uses tests/integration/analysis-skills.test.ts, the installed catalog zip
in prepare-plugins.test.ts and the actual SessionService/npm CLI replay in cli.test.ts. The opt-in
scripts/firmware-comparator-rubric.mjs prepares seven fictional cases before any real model access;
it uses existing VERA credentials through normal safeStorage and an explicit isolated model override,
retains original prompts/events/artifacts/model and skill hashes, and never writes user settings.
Public OAuth scopes stay out of secret-word registration; live Responses tools explicitly use
strict:false to preserve optional arguments. Credentials/subscription/gateway regressions cover both.
UbuntuWSL2 proof is distinct from native Ubuntu. CAP04 implementation chat owns the aggregate
Analysis capabilities gate; coordinator reuses its original proof without routine repetition.
Manual test planning extends analysis-skills.test.ts, prepare-plugins.test.ts and cli.test.ts;
scripts/test-planner-rubric.mjs prepares seven fictional real-model cases, uses the same authorized
normal credential host and isolated model override, and retains original sources/prompts/events/
artifacts/hashes plus settings integrity. The repeated-name fixture seeds real artifacts at the save
boundary to exercise three actual storage collisions and the complete chat fallback.

Per-prompt activity verification: shared/core prompt-usage tests and renderer activity-usage.test.ts; tests/e2e/prompt-usage.spec.ts uses isolated native replay counts, real file tools and restart with no external provider calls.

## Toolchain

eFuse acceptance: tests/integration/esp32-efuse.test.ts checks the official package/risk/skill
offline. Explicit VERA_EFUSE_UV uses pinned uv and real managed esptool v5 through the provisioner,
runner and replay SessionService/ApprovalGate. All burns carry --chip esp32 --virt and explicit
--do-not-confirm; --path-efuse-file persists a task-owned virtual state file. Require tool success,
process exitCode 0, changed virtual bytes and read-back False/0b0 to True/0b1. VERA_TEST_EVIDENCE_DIR
retains argv/output/process exits, events and durable approvals; VERA_EFUSE_SCRATCH selects owned
scratch. No physical burn is permitted. Identify Ubuntu WSL2 separately from native Ubuntu/ARM64.

The repository toolchain is defined by [02_Tools/toolchain.json](../../02_Tools/toolchain.json). [02_Tools/README.md](../../02_Tools/README.md) documents Python, Git and the local Node runtime.

## Setup

Use the repository setup script from the repository root; it downloads the verified pinned Node distribution, installs npm packages and checks Ubuntu libraries.

## Configuration and services

The software root holds npm workspaces, Biome, TypeScript and Vitest configuration. [aegis.toml](../aegis.toml) supplies workflow commands and paths.

## Readiness checks

Run the documented setup --check before verification on a new machine. Ubuntu system packages require separate host installation; the setup checker prints missing packages.

Project verification uses the authoritative .vera metadata layout for configuration,
pinned context, project ignore policy and skills. Test workbenches are created or
copied in current form; root-level predecessors are not migrated or detected.

## Build and run

Run commands from 05_Software using the repository-local npmw.py wrapper when Node is absent from PATH.

`npm run dev` uses loopback Vite on 127.0.0.1:5173. `VITE_API=mock npm run dev:renderer` serves the browser renderer through the same Vite configuration. `npm run build` emits main ESM, sandboxed preload CommonJS and renderer assets; production uses the confined vera://app origin. npm ci installs the pinned Electron binary through install-electron and permits the pinned esbuild install scripts.

## Verification

Workbench plugin draft selection: renderer workbench-plugins.test.ts and plugins.test.ts plus the native workbench draft case in tests/e2e/plugins-ui.spec.ts cover empty defaults, Save/Cancel, readonly/trust, failed-save retry, two-workbench isolation and reopening. Existing plugin-builder and browser plugin flows select packages through Edit workbench → Plugins.

Scoped plugin acceptance uses core/plugins/scoped-store.test.ts and program-tools.test.ts plus the scoped
case in tests/integration/cli.test.ts (compiled CLI, local Git clone/pull, real program exits/output,
actual loopback system prompts, no external provider). tests/integration/scoped-programs.test.ts executes an actual approval while a deterministic post-verification barrier trusts a new helper hash; the old process must print only old-hash code. Native plugins-ui.spec.ts covers real probe shutdown cancellation, user review/trust,
stale hash refusal, refresh and reopen. Windows covers junctions/case aliases; identify Ubuntu WSL2
separately. VERA_CLI_EVIDENCE_DIR retains original CLI process receipts and outputs.

Web search: core/web/exa.test.ts exercises the real SDK over scripted fetch; native web-search.spec.ts routes only fixed Exa requests to an owned loopback MCP fixture and checks activity/source links/en-ro-de/disabled-tool persistence. Separate manual live ExaWebProvider smoke uses public query/URL without LLM spend. Automated tests retain network guards.

Sidebar navigation proof uses workspace.test.ts, focused service creation cases and native navigation-actions.spec.ts (owned two-workbench replay profile, keyboard/mouse menus, concurrent reuse and restart). Stop live development before rebuilding shared desktop/out and restart normal development after native verification. A pre-existing service compaction/restart limit assertion is separately reproduced with the baseline service; it does not validate this navigation feature.

Session reasoning acceptance uses tests/e2e/session-reasoning.spec.ts: isolated native profile, loopback model transport, restart/isolation/default/reset and responsive layout. Gateway fixtures inject authenticated catalog responses and block external egress; no real model spend is required.

Workbench entry acceptance uses shared/workbench-entry.test.ts, renderer workspace/mock scenarios and native workbench create/open/restart tests. Fictional corpus and inventory live under tests/fixtures/workbenches and are consumed by PDF, retrieval, CLI and smoke verification.

Release acceptance uses `smoke:package -- --artifact <already-built native release>`;
see [release smoke](../knowledge/release-smoke.md) for native strace calibration,
normal custom-provider approval/restart and pending manual Windows capture.
Release and instrumented calibration builds are separate; M4 gate is coordinator-owned.

There is no upgrade-safety suite: every stored format is version 1 during development and any other
version is invalid data (root AGENTS.md). Current-format fixtures live in tests/fixtures/app-data/:
credentials.json, workbench.yaml and the crash-recovery interrupted-sessions.json.

Update ticket acceptance uses shared/main/backend/core-approval/UI tests and immediate transports,
tests/e2e/updates.spec.ts browser geometry/languages, and scripts/probe-upgrade.mjs with explicit owned scratch.
The latter builds separately identified local instrumented artifacts and records real installed
vN->vN+1, SHA-512 refusal of a corrupt hash, turn/approval deferral and deb/portable metadata-only
results; it publishes nothing. It does not check that settings, history or recovery survive an update.
VERA_UPDATE_URL is a fixed build setting. Full M4 gate follows the verification policy owner.

Skills acceptance uses catalog/schema/workbench/registry/session replay and immediate
host/IPC/mock/boundary consumers. tests/e2e/skills.spec.ts observes a UI-created skill in the
next turn's actual loopback provider system request, then disabled/edited metadata;
the browser checks en/ro/de, both themes, five text scales and modal keyboard focus.

Citation acceptance uses shared refs.test.ts, core agent/citations.test.ts and
knowledge/search.test.ts, renderer session/markdown.test.ts and immediate
session/artifact/registry/state/workspace/import-boundary consumers. Focused native
tests/e2e/citations.spec.ts exercises real PDF/Markdown/HTML/text/artifact tool refs,
verified/warning chip presentation and restart persistence on Windows/Ubuntu.

Local document retrieval uses embedding/search/schema/lifecycle units plus
compiled document-hosts/document-cli, issued PDF session replay and native ingest
E2E. eval:retrieval executes the frozen corpus with real local CPU product worker,
persisted search and ADR0015 floors; see [document search](../knowledge/document-search.md).

Keyword proof uses core knowledge/keyword.test.ts, storage/keyword-schema.test.ts
and real processor/watcher/SQLite ingest.test.ts; immediate database/repository,
workbench and import-boundary checks cover schema and lifecycle consumers.
The configured strict run retains static checks under the verification policy.

Retrieval comparison uses pinned Node scripts/compare-embeddings.mjs with owned scratch, local models and output paths. Explicit --prepare downloads verified assets; default inference is local/offline. Focused retrieval/packaging/extraction/boundary tests and native Windows/Ubuntu measurements accompany ADR0015; see [retrieval evaluation](../knowledge/retrieval-evaluation.md).

Extraction acceptance uses core knowledge/{extraction,processor}.test.ts, compiled
CLI/desktop document-hosts.test.ts, deterministic demo-documents.test.ts and
focused native tests/e2e/ingest.spec.ts for worker/chunks/cache/OCR.
`npm run make:demo-pdfs` regenerates the fictional board PDFs from demo Markdown.

Ingest acceptance uses real watcher/SQLite core knowledge/ingest.test.ts, shared
documents-ipc.test.ts and immediate workbench/transport/mock/boundary checks.
Targeted native tests/e2e/ingest.spec.ts exercises workbench/reindex IPC and index events
through actual sandboxed Electron, including close/reopen reconciliation. Linux
uses a short TMPDIR for Electron singleton sockets and an owned electron package.

Subscription ticket proof uses main chatgpt-auth/open-external tests, core llm/subscription and gateway tests, strict shared chatgpt IPC, renderer chatgpt controls and tests/e2e/chatgpt.spec.ts. Scripted OAuth and actual loopback callback cancellation require no model/network; instrumented VERA_TEST_CHATGPT composition is omitted from release. Real subscription sign-in/session/restart/session/signout remains a separate human acceptance flow.

[Verification policy](../../02_Tools/verification-policy.md) defines targeted per-ticket tests and full milestone gates. Static strict checks remain separate from test results. Changes acceptance uses core sessions/changes.test.ts, shared changes-ipc.test.ts, main reveal-path.test.ts, renderer changes-tab.test.ts and tests/e2e/changes.spec.ts on Windows/native Ubuntu; the native test uses the real ask gate and proves counts/diff after restart.

`npm run package` / `package:test` build host x64 release/instrumented NSIS + portable ZIP or AppImage + deb with
electron-builder 26.17.0. `prepare:model` materializes the manifest-pinned model; `-- --offline`
verifies cached assets. Runtime assets never require a model download. Native N-API install scripts
are explicitly denied in allowScripts; use platform-specific installed prebuilds and keep CPU
libraries unpacked. See [native packaging](../knowledge/native-packaging.md) for package reports
and external host harnesses. WP-05 accepts artifact-bound execution on the current connected
Windows host under explicit human authorization, with clean/offline Windows and real VC++ self-containment
required before final release. App-local Microsoft runtime bytes/signatures are pinned; actual loaded
module paths supplement the clean/offline criterion. `prepare:windows-runtime` uses the verified
cache or exact Microsoft-signed source DLLs from VERA_VC_REDIST_DIR/System32. The offline Windows helper requires
isolation and a machine permitting unsigned executables; a Smart App Control refusal is a failed
environment probe. Linux feasibility uses actual isolated-VM execution.

[05_Software/README.md](../../05_Software/README.md) and [08-quality](../../00_Planning/architecture/08-quality.md) define verification routes.

Artifact acceptance uses core sessions/artifacts.test.ts, shared artifacts-ipc.test.ts, main artifacts.test.ts, renderer artifacts-tab.test.ts and tests/e2e/artifacts.spec.ts plus the headless CLI process case. Native acceptance proves save/view/export/restart/delete; browser covers en/ro/de, both themes and all text scales at1024×640. Windows proves junction/hardlink boundaries; POSIX file symlinks run on native Ubuntu because this Windows host requires unavailable symlink privilege.

`npm run verify` runs Biome, tsc -b, the English-source en/ro/de catalog audit and Vitest. `npm run test:e2e` builds then runs Playwright Electron and a standalone Chromium mock browser; Linux uses xvfb-run -a. Install the pinned Playwright Chromium runtime with `npx playwright install chromium` from 05_Software before browser acceptance. Acceptance retains sandboxing, uses temporary userData and blocks non-loopback traffic. Build-mode tests execute emitted code for both compile-time values, including instrumented
VERA_TEST_DIALOG_PATH/VERA_REPLAY_DIR presence and release absence, including replay registration code. Workbench acceptance creates spaced/Unicode
folders through the native picker seam, edits full pinned text, reopens recents after restart, removes
missing recents and preserves live foreign locks in read-only mode. The browser mock seeds
empty/missing/read-only/warning states. Windows and Ubuntu E2E run serially because Vite owns5173.

Steering regression routes are agent/steering.test.ts, sessions/service.test.ts, shared/session-state.test.ts, renderer session/workspace.test.ts and native tests/e2e/chat-ui.spec.ts; they inspect ordered tool-boundary delivery, summary-time admission, budgets, pending/recovery and running/approval composer behavior.

Compaction regression routes are agent/compaction.test.ts, sessions/service.test.ts, shared/session-state.test.ts and renderer session/usage-meter.test.ts; they inspect bounded summary/normal requests and complete transcript/restart.

Agent runtime tests use the common replay matrix and deterministic injected counters; pi-agent-core is measured through a stream-function adapter with the same context policy. No live model is needed for runtime acceptance. Session acceptance uses read-then-answer JSONL, real temporary SQLite and a new core instance plus native Electron restart; focused routes are documented in [sessions](../knowledge/sessions.md).

Node Vitest projects install the non-loopback fetch/socket guard before application modules. The integration test
tests/integration/serial-monitor.test.ts runs the serial-monitor script under the toolchain's Python 3.11+ (`python` on
Windows, `python3` elsewhere, or `VERA_TEST_PYTHON`) with the fake pyserial in tests/fixtures/serial-monitor; it needs
no serial port, uv or network. tests/integration/esp32-esptool.test.ts uses the same Python; its fake uv installs a
stub esptool as the pip entry point (on Windows an .exe launcher made with pip's vendored distlib, so that Python needs
pip) and needs no board, uv or network. `tests/integration/esp32-idf.test.ts` uses the same Python and distlib on
Windows for deterministic vendor entry points, the platform string parser, provisioner, runner, session
and serial-monitor/fake pyserial. Set VERA_TEST_EVIDENCE_DIR to retain replay run logs and tool results.
These tests do not establish actual ESP-IDF compilation or real-board acceptance. Binutils acceptance is `tests/integration/binutils.test.ts`: ordinary tests inspect the real ELF corpus and fake-root discovery without network; setting VERA_BINUTILS_ARCHIVES to locally prepared official archives enables real x64 extraction/probes and downloaded/PATH-found replay on each native host. VERA_TEST_EVIDENCE_DIR retains original run logs/events. This does not establish linux-arm64 execution. EIM 0.20.1 transport
was separately executed with isolated activation on both hosts; see the plugin README.
`npm run smoke:live -- --provider <openai|custom:slug> [--data <userData>]` builds release and runs a manual real-provider test through the ordinary main credential host. It prints scrubbed four-step results and exits nonzero for incomplete required steps. See [LLM gateway](../knowledge/llm-gateway.md) for configuration and replay fixtures.

Plan acceptance uses shared todos.test.ts, core sessions/todos.test.ts, registry.test.ts and renderer plan-tab.test.ts; tests/e2e/plan.spec.ts observes every replacement live plus final list after native restart and localized browser status/geometry. CLI process proof covers the same fixture. Final selections include affected session/runtime/storage/IPC/panel/tooling consumers under the verification policy.

Compact chrome acceptance uses main/window-chrome.test.ts, shared/window-ipc.test.ts, renderer components/shell.test.ts and tests/e2e/compact-shell.spec.ts with immediate shell/mock consumers. Native Linux maximize/restore and persisted-position checks require a real window manager alongside Xvfb; WSLg alone does not provide those semantics. Set VERA_E2E_SESSION_WRAPPER to an executable that starts the manager, executes its supplied argv on the inherited display and cleans up when that command exits. test:e2e invokes this wrapper inside xvfb-run.

## Platform details

Windows and Ubuntu use separate platform Node distributions and npm native dependencies. Share sources and lockfile, use separate node_modules for platform validation.
Core storage tests execute the pinned real better-sqlite3 addon against temporary databases, including
WAL data, current-schema validation and repository rows. Use the focused db/repositories
and workbench service tests for changes, then the configured strict proof and serial native E2E.

Executable-adjacent vera.portable selects adjacent data before readiness. Installed launches accept
--user-data-dir for isolation; selected directories are created before Electron setPath. Portable
regressions use faithful hosts enforcing directory existence, with temporary markers/executables.
Credential/provider tests use injected deterministic crypto and temporary atomic files/logs; native Providers acceptance observes all IPC responses and cleared password drafts through reload/restart and explicit weak-storage choices. Settings/log tests use injected ports and temporary directories;
native acceptance checks all UI theme/scale preferences and panel geometry across restarts, external event refresh and persistence through shutdown. Browser acceptance checks the three-language minimum-size matrix, keyboard focus, AA contrast, overlay, storage protection and localized save errors.

## Authoritative references

- [Tools](../../02_Tools/README.md)
- [Toolchain](../../02_Tools/toolchain.json)
- [AEGIS commands/layout](../aegis.toml)

Prepared-write focused proof uses tools/write-edit.test.ts, sessions/write-edit.test.ts, workbench/service.test.ts and desktop main/sessions.test.ts with real temporary FS/SQLite. tests/e2e/write-edit.spec.ts uses instrumented replay plus a compiled test-only permission injection; release build regression confirms VERA_TEST_ALLOW_WRITES is omitted.

File-tool proof uses real worker-thread bundles and injected shorter deadlines for catastrophic regex/abort/replacement; native Electron file-tools acceptance invokes sandboxed app.info while matching stalls. Dedicated grep-worker entries ship in desktop and CLI; instrumented file-tool probe is compiled out of release.

Permission approval focused proof uses core sessions/approvals.test.ts, shared/approval-ipc.test.ts, workspace.test.ts and CLI prompt/process tests. tests/e2e/approvals.spec.ts exercises the production gate in compiled native Electron, without permission injection, and minimum-size browser keyboard decisions. Linux CLI process tests use the real script PTY for A/D and Ctrl+C; those Linux-only cases skip on Windows.

Chat UI acceptance uses `tests/e2e/chat-ui.spec.ts` with real native replay and worker calls; `?mock=chat` seeds six selectable session states in browser mock mode. Component tests use jsdom, React act and user-event. Instrumented VERA_REPLAY_DELAY_MS slows replay streams; release builds omit this seam.

Headless `npm run vera -- run …` builds the CLI and dedicated grep worker with pinned esbuild; `build:cli` prepares the workspace vera bin. CLI process acceptance is tests/integration/cli.test.ts; Node port checks are src/apps/cli/src/host-ports.test.ts. Explicit replay is a headless interface; desktop keeps its compiled instrumented boundary. See [headless CLI](../knowledge/headless-cli.md) and the software README for provider/data/output/resume behavior.

Desktop main registers the exact-pinned pi-ai public standalone OAuth entrypoint before composing authentication and gateway services, so login, refresh and token conversion are available in compiled Electron bundles. Core remains platform-independent. Focused native acceptance starts the actual bundled OAuth callback/prompt and cancels without opening a browser or exchanging tokens; scripted persistence and real personal acceptance remain separate.

Document viewer acceptance uses shared documents-ipc, core knowledge/viewer and search provenance, workbench/service, main document-viewer scrubbing, renderer documents/markdown and immediate IPC/preload/mock/session/artifact/import consumers. Office extraction uses core knowledge/office.test.ts over the committed fixtures in tests/fixtures/documents/office (regenerate with `node scripts/make-office-fixtures.mjs`), and native tests/e2e/office-documents.spec.ts proves worker extraction plus cited slide, heading and untitled leading-section (`#h=`) opening. Native tests/e2e/citations.spec.ts proves offline PDF page/snippet/search/zoom, repeated heading and line60–62 anchors, artifacts, Docs and restart; tests/e2e/documents.spec.ts checks en/ro/de light/dark/all-scale1024x640.

Session export/search verification routes are core sessions/export.test.ts and service.test.ts, shared/session-export.test.ts, main/session-export.test.ts and native tests/e2e/session-search.spec.ts; exact execution policy is owned by the current task and user.

## Workbench navigation verification

Bypass acceptance uses sessions/bypass.test.ts, approvals/path/registry/write/worker regressions and renderer permission-picker.test.ts. Instrumented tests/e2e/bypass.spec.ts uses owned sibling temporary folders and replay to exercise actual full-scope read/list/glob/grep/edit/write, automatic grants and mode/suppression restart, plus multilingual minimum-window warning controls. Existing approval browser acceptance uses an ephemeral Vite port so the development app can remain open; native approval assertions wait for the terminal turn.

Workbench tool selection is verified by renderer workbench-tools.test.ts (draft/read-only), core registry/service tests (canonical catalog and warnings), existing browser workbench-navigation.spec.ts and native workbench-tools.spec.ts (save/cancel/YAML/restart and en/ro/de descriptions). The native folder picker fixture requires VERA_TEST=1 during build and an isolated profile.

`tests/e2e/session-scroll.spec.ts` covers fixed viewport geometry, enlarged composer/text, long Settings and update banner, plus the independent left conversation rail with pointer, keyboard, wheel, touch and reading/follow checks. Native replay tests require an instrumented build (`VERA_TEST=1 npm run test:e2e -- ...`) and isolated profiles; the normal development application uses its existing user profile.

`tests/e2e/workbench-navigation.spec.ts` exercises mock sidebar/editor and two-workbench
session switching. `tests/e2e/workbench.spec.ts` owns native create/open/restart.
Core workbench/ingest/chunk-settings tests cover persistent pins, retained registry,
scoped saves and per-workbench document chunk rebuilding.

Keyboard shortcuts verification uses shared keyboard-shortcuts.test.ts, core
settings/service.test.ts, renderer lib/shortcuts.test.ts and immediate
workspace/shell consumers. tests/e2e/keyboard-shortcuts.spec.ts covers browser
editing/capture/conflicts/readonly plus compiled native persistence across restart.

Web access verification: targeted shared/core/main/renderer tests and tests/e2e/web-access.spec.ts. Native acceptance uses isolated profile/loopback MCP, verifies optional key headers, persistence, cancellation/global denial and en/ro/de modal geometry without paid API calls. Live anonymous connectivity is a separate external-service check; user-key account success requires a user-supplied key.

Web access supports Exa/Tavily/Brave with isolated credentials and CLI EXA_API_KEY/TAVILY_API_KEY/BRAVE_SEARCH_API_KEY. Tavily supports anonymous search/read; Brave requires a key and is search-only. Focused adapter/gate/main/UI/shared and native provider-isolation tests verify routing; live anonymous Tavily search/extraction is separate from scripted private-key acceptance.

PDF downloads verification: focused core web/pdf-transfer.test.ts, web/pdf-downloads.test.ts (real PDF parser), sessions/downloads.test.ts, shared/downloads.test.ts, existing registry/approval/disclosure/IPC checks and native tests/e2e/pdf-download.spec.ts. The native fixture pins a public DNS answer then redirects only its known document host to an owned loopback HTTP server, with all other egress blocked. Optional VERA_PDF_SCREENSHOT writes owned Temp visual proof. A manual W3C dummy.pdf request verifies the default public HTTPS connector without LLM spend or repository output.

Plugin-builder acceptance uses core authoring/gate/write/skill units, real-process/SQLite replay tests/integration/plugin-builder.test.ts, renderer promotion/export tests and tests/e2e/plugin-builder.spec.ts in sandboxed Electron. The help-only documentation fixture is tests/fixtures/plugin-builder/cli.mjs; all commands use virtual hardware.

Probe-rs acceptance: tests/integration/probe-rs.test.ts uses an installed official package, isolated find/version probes, real NodeProcessHost fixture replay and optional verified local official archives via VERA_PROBE_RS_ARCHIVES (no test network). VERA_TEST_EVIDENCE_DIR retains original CLI/replay output; use a task-owned TMP/TEMP directory on Windows, and allow taskkill to terminate the owned background process tree. Native Ubuntu uses the pinned Linux Node runtime and its own dependencies. Replay does not validate real probes; three-board and closed-stdin down-channel RTT bench acceptance is pending (TASK-bc643d04).

Sigrok acceptance: tests/integration/sigrok.test.ts covers the installed package and
typed Ask with a simulated process. VERA_SIGROK_ARCHIVES enables real x64
provisioning through local transport, demo acquisition and offline UART/I2C
decoding of a generated srzip trace. VERA_TEST_EVIDENCE_DIR retains output.
ARM64 inspection, hosted downloads and physical bench verification are separate.

Git acceptance: tests/integration/git.test.ts installs the official catalog zip, resolves user Git >=2.40 and exercises native marker helpers, bounded replay history/tag comparison without approval and a commit waiting in Ask. Fabricated signed commit/tag objects prove native signature helper invocation for pretty modifiers, ref sorting/peeling and shortlog format groups, then their refusal through Bypass. Controlled loopback HTTP 401 fetch proves prompt suppression within a 10s fixture timeout. VERA_TEST_EVIDENCE_DIR retains actual argv/env/results per platform. Windows Git and Ubuntu WSL2 Linux are identified separately; this does not establish bare-metal Ubuntu or ARM64 execution. Unknown options on known commands require approval and executable aliases/helpers are blocked.

Git diff acceptance requires process exitCode 0 plus actual staged/worktree/tag/log/show/stash/reflog patch text before commit approval. The fixed empty diff.external alone is not usable; Git execution adds no-ext-diff at actual command boundaries, while raw approvals/run-record labels remain unchanged. Tests also prove stash -- list is a write path, named external-driver suppression and explicit stat/patch output. Original concealed exit-128 receipts are retained under pre-diff-fix as superseded evidence.

Chat detail verification: shared workbench config, core workbench reopen, main event sanitization and renderer workbench-chat/transcript-detail tests. Native tests/e2e/chat-detail.spec.ts covers normal/verbose/minimal rendering, Save/Cancel, separate workbench defaults, restart, complete Activity, exact Ask approval and Stop.

Captured log acceptance uses core tools/parse-log.test.ts, registry/grep/worker regressions, shared refs, tool-editor/fixture/boundary checks, agent-versus-vera-run replay, eval:retrieval and native file-tools.spec.ts. Native acceptance exercises the production10s catastrophic-regex deadline, responsive app.info, Stop and replacement. Windows short1s worker-host tests also fail on the immutable pre-CAP-01 base on this host; preserve base/candidate proof separately. Ubuntu WSL2 is Linux execution, not native Ubuntu platform acceptance.

Captured register acceptance uses tools/decode-register.test.ts, agent/citations.test.ts, registry/grep/parse-log/shared-ref regressions, localized WorkbenchTools, fixture inventory and import boundaries. Real SessionService versus npm-built vera run replay verifies identical complete results and definition/manual citations with open/restart. Native workbench-tools.spec.ts checks decode_register save/cancel/restart and en/ro/de descriptions. Exact1MiB/cardinality boundaries and deterministic during-read replacement are covered. Linux Ubuntu WSL2 is identified separately from native Ubuntu acceptance; full Analysis capabilities gate remains withCAP04/coordinator.

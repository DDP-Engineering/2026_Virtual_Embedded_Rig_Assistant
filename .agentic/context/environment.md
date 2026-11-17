# Environment guide

Analysis skills: tests/plugins/analysis-skills.test.ts (folder install, skill bodies and templates)
and the installed catalog zip in prepare-plugins.test.ts. Model semantics are not tested automatically.
Public OAuth scopes stay out of secret-word registration; live Responses tools explicitly use
strict:false to preserve optional arguments. Credentials/subscription/gateway regressions cover both.
UbuntuWSL2 proof is distinct from native Ubuntu.

Per-prompt activity verification: shared/core prompt-usage tests and renderer activity-usage.test.ts; tests/e2e/prompt-usage.spec.ts uses isolated native replay counts, real file tools and restart with no external provider calls.

User-message navigator verification: renderer transcript-navigation.test.ts and transcript-navigator.test.ts (jsdom, stubbed layout) plus browser-only tests/e2e/session-navigation.spec.ts against `?mock=chat` (mock triggers `seed N messages` and `stream slowly…`); set VERA_NAV_SCREENSHOT=<path prefix> for sparse, dense, group, keyboard and narrow screenshots. Run it with `npx playwright test` from 05_Software (no Electron build needed). The native Ubuntu run is recorded separately.

Bookmark persistence acceptance: shared session-state.test.ts, core sessions/bookmarks.test.ts and desktop main/session-bookmarks.test.ts plus renderer mocks/sessions.test.ts cover unique set/clear/ignore, validated IPC role/session/read-only/archive refusals, publication after durable commit, failed-insert rollback, actual database reopen, JSON/Markdown export and agent request isolation. Pinned Windows and Ubuntu WSL2 runs pass; WSL2 is distinct from native Ubuntu acceptance. BKM-02 controls use transcript-navigator.test.ts for optimistic agreement, failure rollback, delayed events, stale-session isolation, queued/delivered reply ownership and all four localized names; shared/session-state.test.ts covers immutable request ownership across live/durable replay and admitted batches; bookmarks.spec.ts covers Chromium hover/focus/card and native Electron restart/archive guards. Windows Chromium/Electron acceptance passes; native Ubuntu is unverified in this Windows session, and Ubuntu WSL2 availability is not native Ubuntu evidence. BKM-03 transcript-navigator.test.ts covers any-member markers, exact grouped navigation, boundaries, no-overflow focus, configurable keys, modal/input guards and deferred older-row mounting. bookmark-navigation.spec.ts passes Windows Chromium renderer restart with a retained mock backend and sandboxed native Electron process restart, three marks in long sessions, sparse/grouped geometry and localized Settings/navigation in en/ro/de/fr. No full suite or native Ubuntu result is claimed.

## Toolchain

eFuse acceptance: tests/plugins/esp32-efuse.test.ts checks the official package/risk/skill
offline. Explicit VERA_EFUSE_UV uses pinned uv and real managed esptool v5 through the provisioner,
runner and replay SessionService/ApprovalGate. All burns carry --chip esp32 --virt and explicit
--do-not-confirm; --path-efuse-file persists a task-owned virtual state file. Require tool success,
process exitCode 0, changed virtual bytes and read-back False/0b0 to True/0b1. VERA_TEST_EVIDENCE_DIR
retains argv/output/process exits, events and durable approvals; VERA_EFUSE_SCRATCH selects owned
scratch. No physical burn is permitted. Identify Ubuntu WSL2 separately from native Ubuntu/ARM64.

The repository toolchain is defined by [02_Tools/environment/toolchain.json](../../02_Tools/environment/toolchain.json). [02_Tools/README.md](../../02_Tools/README.md) documents Python, Git and the local Node runtime.

Session performance: `perf:sessions` uses the pinned Node/Electron/Playwright toolchain and existing
local models, an owned isolated build/profile/workbench and serial quick5/full30 samples per case.
Stop normal VERA and other builds/suites during measurements. Headless Linux runs through xvfb-run;
native Ubuntu/WSL evidence remains distinct. Explicit calibration needs two complete compatible
full runs of the same candidate and supplied budgets; preserve JSON/Markdown reports outside E2E cleanup.
Focused harness regressions are in tests/tooling/session-performance.test.ts. Probes require both
VERA_TEST=1 and VERA_SESSION_PERF=1 at build time and are omitted from ordinary/release output.

## Setup

Use the repository setup script from the repository root; it downloads the verified pinned Node distribution, installs npm packages and checks Ubuntu libraries.

## Configuration and services

The software root holds npm workspaces, Biome, TypeScript and Vitest configuration. [aegis.toml](../aegis.toml) supplies workflow commands and paths.

Plugin catalog build inputs: `VERA_PLUGIN_CATALOG_URL`, the default remote catalog folder, is empty. `VERA_PLUGIN_CATALOG_KEY` is a PEM path that replaces the pinned public key `02_Tools/release/catalog-signing-key.pub.pem`. Test builds also read the env `VERA_TEST_CATALOG_KEY` (PEM text) at run time, so e2e can sign a loopback catalog with a throwaway key. The catalog signing private key lives outside the repository (`02_Tools/release/catalog-release.md`); tests never use it.
Offline dependency kits: `npm run vera -- catalog kit --source plugins --platform <windows-x64|linux-x64> --out ../07_Delivery/kit-<platform>` needs network and the pinned uv (`npm run prepare:uv`). Build each kit on its own platform: a source-only package with compiled code (today `uptime`, can-python) is built during the kit build. `07_Delivery/kit-*` is git-ignored. On a bench, settings `plugins.kit` points provisioning at a kit (`02_Tools/release/catalog-release.md`).

## Readiness checks

Run the documented setup --check before verification on a new machine. Ubuntu system packages require separate host installation; the setup checker prints missing packages.

Project verification uses the authoritative .vera metadata layout for configuration,
pinned context, project ignore policy and skills. Test workbenches are created or
copied in current form; root-level predecessors are not migrated or detected.

Managed plugin Python pins verified uv0.13.7. Windows program environments include PATHEXT without inheriting unrelated host secrets. Normal-app dependency acceptance is recorded separately from isolated fresh-runtime proof; WSL2 evidence is not native Ubuntu evidence.

## Build and run

Run commands from 05_Software using the repository-local npmw.py wrapper when Node is absent from PATH.

`npm run dev` uses loopback Vite on 127.0.0.1:5173. `VITE_API=mock npm run dev:renderer` serves the browser renderer through the same Vite configuration. `npm run build` emits main ESM, sandboxed preload CommonJS and renderer assets; production uses the confined vera://app origin. npm ci installs the pinned Electron binary through install-electron and permits the pinned esbuild install scripts.

## Verification

Privacy settings proof uses renderer privacy-settings/workbench-privacy and use-preferences tests for localized drafts, effective agent-off confirmation, readonly/failure recovery and stale-read rejection. Focused native tests/e2e/privacy-settings.spec.ts saves actual app/config files, creates and isolates two workbenches, follows live app defaults and restarts Electron in en/ro/de/fr. Original evidence is evaluation-outputs/mask05. Existing consumer/native package proof is reused; full app/plugin/E2E, native Ubuntu/clean-install and exact-source delivery gates remain user-deferred.

Masking consumer proof uses sessions/masking.test.ts, llm gateway/stream-scrub, desktop exports/events/terminals and selected CLI process cases. Native agent-masking.spec.ts uses a real stored MQTT fixture credential and local replay to verify independent session and artifact exports, snapshots/search/detail and irreversible saved redaction. Original logs/receipt use evaluation-outputs/mask04. Unchanged TERM PTY/native packaging evidence is reused; WSL2 is distinct from unavailable native Ubuntu, and full suites/deliveries remain deferred.

User-terminal verification uses main/terminals.test.ts, core/tools/terminal-read.test.ts, strict
shared terminal IPC, renderer terminal-tab/terminal-document tests and tests/e2e/terminal.spec.ts.
VERA_TERM05_APP selects an extracted packaged binary; VERA_TERM05_EVIDENCE_DIR retains original
runtime/native paths, interactive input, resize/reflow, real stored-credential masking and consent
receipts. Packaging tests inspect actual PE/ELF x64 headers and the relative JS/worker closure.
Windows NSIS extraction uses the embedded app payload without installation. Linux deb extraction
runs under WSL2 with pinned /home/dpasare/vera-cap-01/node-v24.21.0-linux-x64/bin/node; WSL2 is
distinct from native Ubuntu. Clean-install/native Ubuntu and full epic gates require separate proof.

Workbench plugin draft selection: renderer workbench-plugins.test.ts and plugins.test.ts plus the native workbench draft case in tests/e2e/plugins-ui.spec.ts cover empty defaults, Save/Cancel, readonly/trust, failed-save retry, two-workbench isolation and reopening. Existing plugin-builder and browser plugin flows select packages through Edit workbench → Plugins.

Scoped plugin acceptance uses core/plugins/scoped-store.test.ts and program-tools.test.ts plus the scoped
case in tests/integration/cli.test.ts (compiled CLI, local Git clone/pull, real program exits/output,
actual loopback system prompts, no external provider). tests/integration/scoped-programs.test.ts executes an actual approval while a deterministic post-verification barrier trusts a new helper hash; the old process must print only old-hash code. Native plugins-ui.spec.ts covers real probe shutdown cancellation, user review/trust,
stale hash refusal, refresh and reopen. Windows covers junctions/case aliases; identify Ubuntu WSL2
separately. VERA_CLI_EVIDENCE_DIR retains original CLI process receipts and outputs.

Web search: core/web/exa.test.ts exercises the real SDK over scripted fetch; native web-search.spec.ts routes only fixed Exa requests to an owned loopback MCP fixture and checks activity/source links/en-ro-de/disabled-tool persistence. Separate manual live ExaWebProvider smoke uses public query/URL without LLM spend. Automated tests retain network guards.

Sidebar navigation proof uses workspace.test.ts, focused service creation cases and native navigation-actions.spec.ts (owned two-workbench replay profile, keyboard/mouse menus, concurrent reuse and restart). Stop live development before rebuilding shared desktop/out and restart normal development after native verification. A pre-existing service compaction/restart limit assertion is separately reproduced with the baseline service; it does not validate this navigation feature.

Session reasoning acceptance uses tests/e2e/session-reasoning.spec.ts: isolated native profile, loopback model transport, restart/isolation/default/reset and responsive layout. Gateway fixtures inject authenticated catalog responses and block external egress; no real model spend is required.

Workbench entry acceptance uses renderer workspace/mock scenarios and native workbench create/open/restart tests. Fictional corpus and inventory live under tests/fixtures/workbenches and are consumed by PDF, retrieval, CLI and smoke verification.

Release acceptance uses `smoke:package -- --artifact <already-built native release>`;
see [release smoke](../knowledge/release-smoke.md) for native strace calibration,
normal custom-provider approval/restart and pending manual Windows capture.
Release and instrumented calibration builds are separate; M4 gate is coordinator-owned.

There is no upgrade-safety suite: every stored format is version 1 during development and any other
version is invalid data (root AGENTS.md). Current-format fixtures live in tests/fixtures/app-data/:
credentials.json, workbench.yaml and the crash-recovery interrupted-sessions.json.

Update ticket acceptance uses shared/main/backend/core-approval/UI tests and immediate transports,
tests/e2e/updates.spec.ts browser geometry/languages, and tests/packaging/probe-upgrade.mjs with explicit owned scratch.
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

Agent runtime tests use the common replay matrix and deterministic injected counters. No live model is needed for runtime acceptance. Session acceptance uses read-then-answer JSONL, real temporary SQLite and a new core instance plus native Electron restart; focused routes are documented in [sessions](../knowledge/sessions.md).

Node Vitest projects install the non-loopback fetch/socket guard before application modules. tests/plugins/bus-tools.test.ts
runs bus-tool under the same Python, which must have flatbuffers 25.12.19 installed (its fake pyserial parses BPIO2 with it). tests/plugins/mqtt-tools.test.ts runs mqtt-tool, the stdlib test broker tests/support/mqtt-test-broker.py (127.0.0.1 only) and the paho fixture device under the same Python, which must have paho-mqtt 2.1.0 (installed on this host with `pip install --user paho-mqtt==2.1.0` from PyPI on 2026-11-14) and cryptography (TLS fixture CA in the test's temp folder); about 50 s on Windows, and its graceful-Stop branch (SIGTERM) runs only on Linux. The integration test
tests/plugins/ble-tools.test.ts runs ble-tool under the same Python with the fake Bleak in tests/fixtures/ble-tools/fake-bleak
(no Bluetooth package, adapter or network needed). Opt-in VERA_TEST_BLE_PYTHON names a Python with bleak 3.1.0 and its pinned
WinRT (or dbus-fast) packages for one real scan on this computer's adapter, never a connection; it passed on Windows 11 on
2026-11-14 with a scratch venv (`pip install bleak==3.1.0` plus the pins of scripts/ble_tool.py from PyPI).
tests/plugins/wokwi.test.ts runs wokwi-tool under the same Python, which must have PyYAML 6.0.3 (present in this
host's toolchain Python 3.12), with the scripted fake tests/support/fake-wokwi-cli.py; no network, Wokwi account or token
is used, and its SIGTERM case runs only on Linux. Opt-in VERA_TEST_WOKWI_CLI names the real wokwi-cli 0.29.1 for offline
version, `lint --offline` and argument checks; it passed on Windows 11 on 2026-11-14 with wokwi-cli-win-x64.exe from the
v0.29.1 GitHub release (sha256 45292e3c...83b2) in a scratch folder.
tests/plugins/raspberry-pi-linux.test.ts runs pi-tool, tests/support/pi-test-sshd.py and pi-test-agent.py under the
same Python, which must have asyncssh 2.24.1 (installed on this host with `pip install --user asyncssh==2.24.1` from PyPI on
2026-11-14; cryptography 49.0.0 was present). Its SSH block needs a Linux shell with /usr/bin/python3: this host on Linux,
the default WSL distribution on Windows (Ubuntu 24.04 here, x86_64, systemd user manager running); it creates a
/tmp/vera-pi-test-* home there and a runtime user unit in $XDG_RUNTIME_DIR/systemd/user, both removed afterwards, and
connects only to 127.0.0.1. VERA_TEST_PI_REMOTE=none skips it. About 90 s on Windows with WSL. WSL is Linux evidence,
not a Raspberry Pi and not native Ubuntu.
tests/plugins/serial-monitor.test.ts runs the serial-monitor script under the toolchain's Python 3.11+ (`python` on
Windows, `python3` elsewhere, or `VERA_TEST_PYTHON`) with the fake pyserial in tests/fixtures/serial-monitor; it needs
no serial port, uv or network. tests/plugins/esp32-esptool.test.ts uses the same Python; its fake uv installs a
stub esptool as the pip entry point (on Windows an .exe launcher made with pip's vendored distlib, so that Python needs
pip) and needs no board, uv or network. `tests/plugins/esp32-idf.test.ts` uses the same Python and distlib on
Windows for deterministic vendor entry points, the platform string parser, provisioner, runner, session
and serial-monitor/fake pyserial. Set VERA_TEST_EVIDENCE_DIR to retain replay run logs and tool results.
These tests do not establish actual ESP-IDF compilation or real-board acceptance. Binutils acceptance is `tests/plugins/binutils.test.ts`: ordinary tests inspect the real ELF corpus and fake-root discovery without network; setting VERA_BINUTILS_ARCHIVES to locally prepared official archives enables real x64 extraction/probes and downloaded/PATH-found replay on each native host. VERA_TEST_EVIDENCE_DIR retains original run logs/events. This does not establish linux-arm64 execution. EIM 0.20.1 transport
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
- [Toolchain](../../02_Tools/environment/toolchain.json)
- [AEGIS commands/layout](../aegis.toml)

Prepared-write focused proof uses tools/write-edit.test.ts, sessions/write-edit.test.ts, workbench/service.test.ts and desktop main/sessions.test.ts with real temporary FS/SQLite. tests/e2e/write-edit.spec.ts uses instrumented replay plus a compiled test-only permission injection; release build regression confirms VERA_TEST_ALLOW_WRITES is omitted.

File-tool proof uses real worker-thread bundles and injected shorter deadlines for catastrophic regex/abort/replacement; native Electron file-tools acceptance invokes sandboxed app.info while matching stalls. Dedicated grep-worker entries ship in desktop and CLI; instrumented file-tool probe is compiled out of release.

Permission approval focused proof uses core sessions/approvals.test.ts, shared/approval-ipc.test.ts, workspace.test.ts and CLI prompt/process tests. tests/e2e/approvals.spec.ts exercises the production gate in compiled native Electron, without permission injection, and minimum-size browser keyboard decisions. Linux CLI process tests use the real script PTY for A/D and Ctrl+C; those Linux-only cases skip on Windows.

Chat UI acceptance uses `tests/e2e/chat-ui.spec.ts` with real native replay and worker calls; `?mock=chat` seeds six selectable session states in browser mock mode. Component tests use jsdom, React act and user-event. Instrumented VERA_REPLAY_DELAY_MS slows replay streams; release builds omit this seam.

Headless `npm run vera -- run …` builds the CLI and dedicated grep worker with pinned esbuild; `build:cli` prepares the workspace vera bin. CLI process acceptance is tests/integration/cli.test.ts; Node port checks are src/apps/cli/src/host-ports.test.ts. Explicit replay is a headless interface; desktop keeps its compiled instrumented boundary. See [headless CLI](../knowledge/headless-cli.md) and the software README for provider/data/output/resume behavior.

Desktop main registers the exact-pinned pi-ai public standalone OAuth entrypoint before composing authentication and gateway services, so login, refresh and token conversion are available in compiled Electron bundles. Core remains platform-independent. Focused native acceptance starts the actual bundled OAuth callback/prompt and cancels without opening a browser or exchanging tokens; scripted persistence and real personal acceptance remain separate.

Display masking acceptance uses main/display-documents and display-identities tests, renderer Docs/tree/tab
consumers and native e2e/display-masking.spec.ts with stored MQTT credentials and validated settings/
workbench IPC. It checks colliding names, original target navigation, live choices, workbench isolation
and persisted opaque tabs across restart. Original Windows proof is in evaluation-outputs/mask02;
WSL2 is distinct from native Ubuntu.

Document viewer acceptance uses shared documents-ipc, core knowledge/viewer and search provenance, workbench/service, main document-viewer scrubbing, renderer documents/markdown and immediate IPC/preload/mock/session/artifact/import consumers. Office extraction uses core knowledge/office.test.ts over the committed fixtures in tests/fixtures/documents/office (regenerate with `node tests/support/make-office-fixtures.mjs`), and native tests/e2e/office-documents.spec.ts proves worker extraction plus cited slide, heading and untitled leading-section (`#h=`) opening. Native tests/e2e/citations.spec.ts proves offline PDF page/snippet/search/zoom, repeated heading and line60–62 anchors, artifacts, Docs and restart; tests/e2e/documents.spec.ts checks en/ro/de light/dark/all-scale1024x640.

Session export/search verification routes are core sessions/export.test.ts and service.test.ts, shared/session-export.test.ts, main/session-export.test.ts and native tests/e2e/session-search.spec.ts; exact execution policy is owned by the current task and user.

## Workbench navigation verification

Bypass acceptance uses sessions/bypass.test.ts, approvals/path/registry/write/worker regressions and renderer permission-picker.test.ts. Instrumented tests/e2e/bypass.spec.ts uses owned sibling temporary folders and replay to exercise actual full-scope read/list/glob/grep/edit/write, automatic grants and mode restart and per-change confirmation/cancellation, plus multilingual minimum-window dialog controls. Existing approval browser acceptance uses an ephemeral Vite port so the development app can remain open; native approval assertions wait for the terminal turn.

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

Probe-rs acceptance: tests/plugins/probe-rs.test.ts uses an installed official package, isolated find/version probes, real NodeProcessHost fixture replay and optional verified local official archives via VERA_PROBE_RS_ARCHIVES (no test network). VERA_TEST_EVIDENCE_DIR retains original CLI/replay output; use a task-owned TMP/TEMP directory on Windows, and allow taskkill to terminate the owned background process tree. Native Ubuntu uses the pinned Linux Node runtime and its own dependencies. Replay does not validate real probes; three-board and closed-stdin down-channel RTT bench acceptance is pending (TASK-bc643d04).

Sigrok acceptance: tests/plugins/sigrok.test.ts covers the installed package and
typed Ask with a simulated process. VERA_SIGROK_ARCHIVES enables real x64
provisioning through local transport, demo acquisition and offline UART/I2C
decoding of a generated srzip trace. VERA_TEST_EVIDENCE_DIR retains output.
ARM64 inspection, hosted downloads and physical bench verification are separate.

Git acceptance: tests/plugins/git.test.ts installs the official catalog zip, resolves user Git >=2.40 and exercises native marker helpers, bounded replay history/tag comparison without approval and a commit waiting in Ask. Fabricated signed commit/tag objects prove native signature helper invocation for pretty modifiers, ref sorting/peeling and shortlog format groups, then their refusal through Bypass. Controlled loopback HTTP 401 fetch proves prompt suppression within a 10s fixture timeout. VERA_TEST_EVIDENCE_DIR retains actual argv/env/results per platform. Windows Git and Ubuntu WSL2 Linux are identified separately; this does not establish bare-metal Ubuntu or ARM64 execution. Unknown options on known commands require approval and executable aliases/helpers are blocked.

Wireshark acceptance: tests/plugins/wireshark-tshark.test.ts checks the package, the tshark role matrix and find/hint with a fake host on any OS, then installs the catalog zip and runs a replay session against the host's real TShark (found through PATH or %ProgramFiles%) on tests/fixtures/wireshark-tshark/sample.pcapng; it skips with a message where tshark is missing; the installed skills are checked before that skip. The default live-capture step is denied, so no default test captures. Opt-in VERA_TSHARK_LIVE_INTERFACE (\Device\NPF_Loopback with Npcap, lo on Linux with dumpcap permissions) approves a bounded capture of self-sent UDP datagrams on 127.0.0.1:59999; VERA_TEST_EVIDENCE_DIR keeps the approval and outputs. The replay host isolates HOME/USERPROFILE/APPDATA from the personal Wireshark profile. Ubuntu WSL2 here has no tshark or Node, so Linux acceptance is pending.

CAN acceptance: tests/plugins/can.test.ts checks both packages, the installed skills, the rules, the scripts against tests/fixtures/can/fake-python-can on the toolchain Python, and the typed transmit gate with the real Provisioner and a fake uv (no python-can needed: the scripts import it lazily). Opt-in VERA_CAN_UV (any uv) provisions python-can 4.6.1 and cantools 45.1.2 from PyPI and, on a udp_multicast bus (a random per-run 239.74.x.y group), runs two background captures (.asc, .blf), send/replay after typed words, can-decode with tests/fixtures/can/board.dbc and the refusal/open-failure exits; VERA_TEST_EVIDENCE_DIR keeps the receipts. Real adapters and Linux vcan0 need hardware or a Linux host.

SCPI acceptance: tests/plugins/scpi-instruments.test.ts runs the scpi helper on the toolchain Python against tests/fixtures/scpi-instruments/fake-pyvisa (a fake PyVISA, pyserial and pyusb simulating a DP832, DS1104Z and 34461A; state in FAKE_VISA_STATE, command transcript in FAKE_VISA_LOG), drives real helper processes through VERA's ProgramRunner with a temporary lease folder (stop request, kill after grace, cleanup run, unknown state) and holds a lease from a second Node process (hold-lease.mjs imports core's built dist, so run `npm run typecheck` after changing core). It proves no instrument. Opt-in VERA_SCPI_UV (a real uv) provisions PyVISA 1.16.2 and pyvisa-py 0.8.1 from PyPI and powers a simulated output, identify, read and capture over real TCPIP SOCKETs to local SCPI servers (passed 2026-11-13); VERA_SCPI_PYTHON_SEED may name a uv python folder whose CPython 3.13 is copied in so only PyPI is reached. No test sends anything to a real instrument; the development machine has none.

Lab-validation acceptance: tests/plugins/lab-validation.test.ts checks the package, catalog, pack, skills and safe rules and runs scripts/lab_validate.py on the toolchain Python (3.11 or newer) against synthetic signals generated in the test from the closed forms in tests/fixtures/lab-validation/README.md, ngspice-tool/ltspice-tool run folders written by the test to their contract, and real scpi-instruments capture folders produced by the scpi helper on tests/fixtures/scpi-instruments/fake-pyvisa (offline; no instrument). A sitecustomize guard on PYTHONPATH (tests/fixtures/lab-validation/guard) makes sockets and processes fail during the no-network test. An ask-mode replay session runs it through VERA's runner with a uv stand-in. Opt-in VERA_LABVAL_UV (a uv whose managed CPython is installed; no package download) provisions the script through a real uv and runs compare offline; passed on Windows 11 with uv 0.11.25 on 2026-11-13. VERA_TEST_PYTHON selects the interpreter (3.11.9 also passed). Native Ubuntu remains unverified.

HIL acceptance: core/src/plugins/hil/hil.test.ts drives plans through run_program on a scripted fake process host with the shipped manifests. tests/plugins/hil-testing.test.ts runs plans through VERA's real ProgramRunner and NodeProcessHost with the real serial-monitor helper (tests/fixtures/serial-monitor/fake-pyserial, chunks in serial.json), the scpi helper (tests/fixtures/scpi-instruments/fake-pyvisa), lab-validate and the hil report helper on the toolchain Python, and tests/fixtures/probe-rs/replay.mjs as probe-rs (run by Node). It imports core's built dist (run `npm run typecheck` after changing core). It proves no board, probe or instrument; the development machine has none attached (read-only Get-PnpDevice, 2026-11-14).

GDB-debug acceptance: tests/plugins/gdb-debug.test.ts runs gdb-elf and gdb-debug on the toolchain Python against the committed fixture ELFs (tests/fixtures/gdb-debug/firmware, built once by build.py with zig cc from the pinned PyPI ziglang 0.13.0) and against executable stand-ins for GDB and OpenOCD (fake_gdb.py, fake_openocd.py; make_tools.py wraps them in pip's distlib launcher on Windows, so it needs pip in that Python), plus internals.py unit checks and one run under VERA's real ProgramRunner with Stop; it imports core's built dist (run `npm run typecheck` after changing shared or core). Opt-in VERA_GDB_ORACLE_PYTHON names a Python with pyelftools 0.32 and compares gdb-elf's facts with it (passed 2026-11-14). Opt-in VERA_GDB_REAL_GDB names a real arm-none-eabi-gdb (12+): gdb-debug runs with it against fake_openocd.py's GDB remote-protocol target (scenario `target`: fixture flash, SCB, RAM, registers; refuses and logs every write packet). Opt-in VERA_GDB_REAL_OPENOCD names a real OpenOCD (0.12+), started with a serial no probe has, so it parses every -c command and stops at the missing adapter. Both passed 2026-11-14 with xPack arm-none-eabi-gcc 15.2.1-1.1 (GDB 16.3.90) and xPack OpenOCD 0.12.0-7, downloaded with approval into a session scratch folder (not installed; nothing on PATH). No probe or board is attached (Get-PnpDevice, 2026-11-14), so no test reaches a real target.

Power-profiler acceptance: tests/plugins/power-profiler.test.ts runs power-profile and power-analyze on the toolchain Python; the live helper imports the pyjoulescope_driver stand-in in tests/fixtures/power-profiler/fake-driver (PYTHONPATH; settings persist in a state file, every call logged), the numeric fixtures are closed-form CSV files from make_fixtures.py (README.md), one run goes through VERA's real ProgramRunner with Stop and BUSY, and lab-validate judges the written A/B requests; it imports core's built dist (run `npm run typecheck` after changing shared or core). Opt-in VERA_POWER_REAL_PYTHON names a Python with pyjoulescope_driver 2.5.5 from PyPI (passed 2026-11-14 with a scratch uv venv, CPython 3.12: tools --list version 2.5.5, no device, WinUSB present; identify/capture blocked device-missing). No Joulescope is attached to this machine, so no test reaches a real meter.
Renode acceptance: tests/plugins/renode.test.ts runs renode-sim on the toolchain Python against committed fixture ELFs (tests/fixtures/renode/firmware, built once by build.py with zig cc from the pinned PyPI ziglang 0.13.0; variants.json maps each build's SHA-256 to its behaviour) and against an executable engine stand-in (fake_renode.py; make_engine.py wraps it in pip's distlib launcher on Windows and copies Renode's two STM32F4 platform descriptions beside it; the stand-in reads its settings from fake.json there because renode-sim passes the engine only system variables), plus one run under VERA's real ProgramRunner with Stop; it imports core's built dist. Opt-in VERA_RENODE_REAL names a real Renode 1.17.0 executable: passed 2026-11-14 on Windows with renode-1.17.0.windows-portable.zip (106735414 bytes, SHA-256 18bcf145...b9db), downloaded with approval into a session scratch folder and extracted there (not installed; nothing on PATH). A real board-basics run takes about 11 s of wall-clock time for 1.2 s of virtual time. Native Ubuntu is not available here.

Zephyr acceptance: tests/plugins/zephyr.test.ts needs VERA_ZEPHYR_PYTHON, a Python 3.12 with the zephyr helper's pinned PyPI dependencies (the PEP 723 list of plugins/zephyr/scripts/zephyr_tool.py; here a uv venv D:/Temp/vera-zephyr/venv); without it only the package and rule tests run. The default tests run the real helpers against tests/fixtures/zephyr/stand-ins (a fake Zephyr tree whose Twister stand-in and west `flash` extension the real west loads, fake_cmake.py via VERA_ZEPHYR_TEST=1 and VERA_ZEPHYR_TEST_CMAKE, fake_cli.py), real west and git for prepare-workspace against local file:// repositories, and VERA's real ProgramRunner for Stop and the probe lease; git must be on PATH. Opt-in VERA_ZEPHYR_REAL names a folder with ws/ (west workspace: Zephyr v4.4.2 dccb0959 + CMSIS_6 30a859f4 + hal_stm32 fc11896d, shallow) and sdk/zephyr-sdk-1.0.1 (minimal bundle sha256 17a557e7...ea4b plus the arm toolchain sha256 d08df2e8...8aa8d extracted into gnu/, setup.cmd not run); with VERA_RENODE_REAL also the real Renode and with VERA_ZEPHYR_REAL_CLI the real STM32_Programmer_CLI (no board). Passed 2026-11-14 on Windows with the approved downloads in D:/Temp/vera-zephyr and TEMP=D:/Temp/vzt (short paths: Zephyr/Twister builds exceed MAX_PATH under the long default temp folder). A fixture build takes about 30 s, the three-scenario Twister build about 100 s.

PlatformIO acceptance: tests/plugins/platformio.test.ts needs VERA_PIO_PYTHON, a Python 3.12 with the platformio helper's pinned PyPI dependencies (PlatformIO Core 6.2.0 and its closure, the PEP 723 list of plugins/platformio/scripts/pio_tool.py; here a uv venv D:/Temp/vera-pio/venv); without it only the package and rule tests run. The default tests read platformio.ini with that real PlatformIO parser and replace PlatformIO's commands with tests/fixtures/platformio/stand-ins/fake_pio.py (VERA_PIO_TEST=1 and VERA_PIO_TEST_PIO; settings in <core>/fake.json, calls in <core>/calls.jsonl, because the helper scrubs the environment) on a fake core folder (stand-ins/core); the project is copied to a folder named with a space and a non-ASCII letter; one run goes through VERA's real ProgramRunner with Stop and one with the probe lease; it imports core's built dist. Opt-in VERA_PIO_REAL names a folder with core/ (filled once by `platformio prepare-packages` with network access) and libdeps/<env>/ (the libraries it installed); VERA_PIO_REAL_GCC names a folder with a host gcc for the native tests, VERA_RENODE_REAL the real Renode. Each real test runs the real prepare-packages first (served from the core's PlatformIO caches) and approves Unity's build script by hash. Passed 2026-11-14 on Windows (22 tests, about 165 s) with the approved, SHA-256-verified downloads in D:/Temp/vera-pio: core/ (ststm32 20.0.0, toolchain 1.70201.0, CMSIS, tool-scons, tool-openocd, native 1.2.1), libdeps/, gcc/mingw64 (WinLibs 16.2.0 r2) and the LAB-06 Renode 1.17.0.

Microchip acceptance: tests/plugins/microchip-pymcuprog.test.ts checks the package, installed skills, the pymcuprog role matrix and a fuse write waiting for the typed word in an auto-edit replay session through a stub resolver whose fake pymcuprog records argv. Opt-in VERA_MCU_UV provisions pymcuprog 3.19 from PyPI, runs --version and makeuf2 on tests/fixtures/microchip/app.hex without approval and a ping on a missing SerialUPDI port after approval; no step touches hardware.

STM32 acceptance: tests/plugins/stm32-cubeprog.test.ts checks the package, installed skills, the command matrix and that every command of tests/fixtures/stm32/STM32_Programmer_CLI-2.23.0-help.txt is classified, find/hint with a fake host and the typed '-ob' word through a stub resolver. Where STM32CubeProgrammer is installed (here 2.23.0 under %ProgramFiles%), an ask replay session runs --version, -l st-link-only and -fchecksum on tests/fixtures/stm32/blink.hex without approval and -c port=SWD sn=VERA0000000000000000000 after approval, a probe serial number that does not exist, so an attached board is never touched; output texts are asserted only on 2.23.0; it skips where the CLI is missing. No test changes option bytes.

Electronics-calc acceptance: tests/plugins/electronics-calc.test.ts checks the package, catalog registration, installed skills and safe rules, runs scripts/elec_calc.py on the toolchain Python 3.11+ against the hand-derived tests/fixtures/electronics-calc/cases.json (derivations in its README), compares Monte Carlo statistics with the independent montecarlo_reference.py, checks the 11 000-unit (UTF-16) output bound on every elec-calc document it receives, report files, path guards (junctions on Windows, directory symlinks elsewhere), the exit-3 cleanup, the unchanged installed copy and an ask-mode replay session through a uv stand-in; it needs no network, uv or hardware and takes about a minute. Opt-in VERA_ELEC_UV provisions the script through a real uv, which downloads uv's managed CPython 3.13 into the test's temporary runtime folder; it passed on Windows 11 with uv 0.11.25 on 2026-11-12 (about 8 s). Native Ubuntu remains unverified.

KiCad acceptance: tests/plugins/kicad.test.ts checks the package, catalog registration, installed skills, the rules (kicad-tool safe, kicad-cli blocked except version/help), the byte-identical shared workspace.py and the refusals and in-process seams of tests/fixtures/kicad/internals.py on the toolchain Python without KiCad. Where the helper finds KiCad 10 (here 10.0.8 under %ProgramFiles%/KiCad/10.0, installed by the user; the provisioner finds it too) it runs every operation against the fictional projects of tests/fixtures/kicad (expected values in its README, written by make_fixtures.py), the stop, changed-source and non-ASCII-path cases and recorded kicad-cli calls; about a minute; otherwise those cases are skipped with a console note. Opt-in VERA_KICAD_UV provisions the plugin through a real uv (downloading uv's managed CPython into a temporary runtime folder) and runs four operations through the ProgramRunner; it passed on Windows 11 with uv 0.11.25 on 2026-11-12. Native Ubuntu remains unverified.

ngspice acceptance: tests/plugins/ngspice.test.ts checks the package, rules, skill, catalog, the four byte-identical workspace.py copies and every refusal before the engine (hostile netlists, missing models, pin counts, deep or outside includes, profile limits) without an engine; where VERA_TEST_NGSPICE names an engine (here the pinned ngspice-47 extracted to D:/Temp/ngspice-dl) it runs the fixtures of tests/fixtures/ngspice against the README's analytic references, the failure, sweep, compare, measure, report, timeout, Stop and input-change cases (about 15 s). Opt-in VERA_NGSPICE_UV=uv with VERA_NGSPICE_ARCHIVE naming the downloaded official ngspice-47_64.7z installs the plugin through the provisioner (7z through System32 bsdtar, uses) and runs ngspice-tool on uv's managed CPython; the suite's network guard refuses outbound connections, so the archive is served from that file. Passed on Windows 11 on 2026-11-13. Native Ubuntu remains unverified.

ltspice acceptance: tests/plugins/ltspice.test.ts checks the package, rules, skill, catalog and pack, the
byte-identical workspace.py/measure.py/sweep.py copies, the raw-file parser on files LTspice 26.1.1 wrote
(tests/fixtures/ltspice/raw) and every refusal before LTspice runs, without LTspice (9 tests). VERA_TEST_LTSPICE
names the user's LTspice.exe (here `C:/Program Files/ADI/LTspice/LTspice.exe`, 26.1.1, installed for all users on
2026-11-13 because per-user msiexec installs fail on this managed machine with Windows Installer 2503/2502): then the
real-engine tests run the fixtures against the README's references, failures, limits, Stop through taskkill /T,
schematics, sweeps, compare/measure/report and a folder with spaces and non-ASCII characters (about 60 s); with
VERA_TEST_NGSPICE also the same requests through ngspice-tool. LTspice never runs from the test without -b and never
with a fresh -ini file (it then waits on a prompt). Passed on Windows 11 on 2026-11-13.

kicad-layout acceptance: tests/plugins/kicad-layout.test.ts checks the package, rules, skill, catalog and pack,
the byte-identical workspace.py, the installed kicad-cli's version (when present) and every refusal that needs no
board on the toolchain Python; with uv on PATH (or VERA_TEST_UV) the stub-editor and no-KiCad connection failures
run on the helper's pinned kicad-python 0.8.0 through `uv run --script` (uv fetches the pinned packages from PyPI
into its cache once). VERA_TEST_KICAD_GUI runs the PCB editor tests: they open real KiCad 10 windows on copies of
tests/fixtures/kicad-layout/board (no clicks), run the helper as VERA's runner does (`uv run --offline`, core's
programEnvironment allowlist plus UV_CACHE_DIR, so pcbnew starts without APPDATA/LOCALAPPDATA) and need KiCad's API
enabled (`api.enable_server` in %APPDATA%/kicad/10.0/kicad_common.json, set on this
machine on 2026-11-13 at the user's choice) and no other KiCad window open, else they are skipped with the reason.
VERA_TEST_KICAD_CLI overrides the kicad-cli path (default `C:/Program Files/KiCad/10.0/bin/kicad-cli.exe`). About
3 minutes; passed with KiCad 10.0.8 on Windows 11 on 2026-11-13. Native Ubuntu remains unverified.

Parts-search acceptance: tests/plugins/parts-search.test.ts checks the package, catalog and pack registration, both installed skills, the rules, the three byte-identical workspace.py copies, that parts_support imports no network module, and runs scripts/parts_compare.py on the toolchain Python against tests/fixtures/parts-search/mosfet-24v.json (expected values derived in its README; `{{-1h}}`/`{{-25h}}` capture times are filled in by the test), refusals, the exit-3 input-change case (change_input.py) and the 11 000-unit output bound; a few seconds, no network. Opt-in VERA_PARTS_UV=uv provisions it through a real uv on its managed CPython 3.13; passed on Windows 11 on 2026-11-13. The host side is covered by core/src/parts/parts.test.ts (fake supplier network: fixtures per supplier, 401/403/429, stall, cancel, tokens, revocation, redaction), desktop parts-access tests (real CredentialFile and SettingsService) and cli/src/parts-env.test.ts. Live supplier probes (E03-F) need the user's own keys in Settings > Parts search and stay unverified until then. Native Ubuntu remains unverified.

Git diff acceptance requires process exitCode 0 plus actual staged/worktree/tag/log/show/stash/reflog patch text before commit approval. The fixed empty diff.external alone is not usable; Git execution adds no-ext-diff at actual command boundaries, while raw approvals/run-record labels remain unchanged. Tests also prove stash -- list is a write path, named external-driver suppression and explicit stat/patch output. Original concealed exit-128 receipts are retained under pre-diff-fix as superseded evidence.

Chat detail verification: shared workbench config, core workbench reopen, main event sanitization and renderer workbench-chat/transcript-detail tests. Native tests/e2e/chat-detail.spec.ts covers normal/verbose/minimal rendering, Save/Cancel, separate workbench defaults, restart, complete Activity, exact Ask approval and Stop.

Captured log acceptance uses core tools/parse-log.test.ts, registry/grep/worker regressions, shared refs, tool-editor/fixture/boundary checks, agent-versus-vera-run replay, eval:retrieval and native file-tools.spec.ts. Native acceptance exercises the production10s catastrophic-regex deadline, responsive app.info, Stop and replacement. Windows short1s worker-host tests also fail on the immutable pre-CAP-01 base on this host; preserve base/candidate proof separately. Ubuntu WSL2 is Linux execution, not native Ubuntu platform acceptance.

Captured register acceptance uses tools/decode-register.test.ts, agent/citations.test.ts, registry/grep/parse-log/shared-ref regressions, localized WorkbenchTools, fixture inventory and import boundaries. Real SessionService versus npm-built vera run replay verifies identical complete results and definition/manual citations with open/restart. Native workbench-tools.spec.ts checks decode_register save/cancel/restart and en/ro/de descriptions. Exact1MiB/cardinality boundaries and deterministic during-read replacement are covered. Linux Ubuntu WSL2 is identified separately from native Ubuntu acceptance; full Analysis capabilities gate remains withCAP04/coordinator.

Catalog discovery proof: shared plugin-catalog.test.ts, core catalog-source.test.ts/catalog.test.ts,
focused CLI catalog check/build case and packaging prepare-plugins.test.ts cover strict activity/
keyword/date metadata, dangling references, deterministic release bytes and remote/bundled/CLI
preservation. Date-less real entries remain date-less; no real network catalog release is needed.

Global plugin-library acceptance: plugin-library.test.ts uses 32 deterministic catalog fixtures for
combined filters/counts, known/unknown/future dates and UTC day boundaries, source identity,
pagination/mutation clamping and QueryClient state retention. plugins.test.ts and plugin-catalog.test.ts
retain review, dependency/setup and explicit-check error assertions; no browsing probes are allowed.
Focused Windows Electron plugins-catalog/plugins-ui/plugin-builder and Chromium plugins-mock cover
native imports/review/update/trust/promotion plus en/ro/de, themes and text-size overflow. These use
isolated profiles, virtual commands and loopback transports; no real hardware or model spend.

PLG-25 workbench plugin UI acceptance uses workbench-plugins.test.ts (32 deterministic packages, hidden draft selection, readonly paging, semantic dirty restoration, private per-workbench view state, pending metadata reload and failed explicit checks) plus immediate editor/global library consumers. Windows instrumented Electron plugins-ui.spec.ts proves imports/review and explicit setup separately from Save/Cancel, dirty navigation, actual global folder-install detour retaining hidden selections/name/instructions/section without writes, two-workbench isolation and restart. Chromium plugins-mock.spec.ts checks workbench Plugins in en/ro/de, both themes and all six interface scales at1024×640; chat-detail immediate consumers remain covered. Unchanged PLG-23/24 proof is reused, with no additional full-suite gate. Native Ubuntu was unavailable in this Windows session; no physical hardware, external network or model calls are required.

Electrical model acceptance uses core electrical/{model,results,tools}.test.ts, sessions/electrical-model.test.ts, tools/registry.test.ts, tools/write-edit.test.ts and desktop main/sessions.test.ts with the fixture tests/fixtures/electrical-model/two-pump-panel.json; no external application is involved. Linux runs in a WSL2 clone of the branch (Ubuntu-24.04, setup.py pinned Node), which is Linux execution, not native Ubuntu evidence.

BYP-03 focused acceptance uses core PathGuard/tool/worker/session and prompt tests, confined analysis/draft exclusions, settings and shared picker component tests. Windows Chromium bypass.spec.ts checks en/ro/de/fr per-change confirmation, Cancel/Escape and marked confirmed mode; native Electron checks both selectors, real application-data read/write refusal without settings mutation, ordinary external edits, restart and repeated consent. program-approvals.spec.ts preserves irreversible plugin rule presentation and policy. CLI integration replays with --data and a Bypass workbench default, asserting refused tool.done rows and unchanged/missing protected files. The user defers complete app and official-plugin suites. A bundled-current-source standalone assertion harness passed on pinned Node24.21.0 under Ubuntu WSL2 for four modes, symlink/lexical/missing aliases and actual read/write refusal with ordinary access; native Ubuntu remains unverified.

BYP-03 nested-root review regressions also cover confined program cwd/file arguments and runner pre-spawn alias replacement, candidate preparation/current-policy apply checks, HIL plan/firmware and resource registry exclusions, all electrical input helper families and a valid protected cable-table tool invocation. These additions keep the existing workbench scope; they do not implement BYP-01/02 widening.

BYP-03 document-agent proof in knowledge/search.test.ts keeps indexed application-data extraction/snippets out of read_doc/search_docs in all four modes and all ranking modes, including an indexed path replaced by a directory alias. Program tools also refuse existing external application-data absolute arguments and their canonical aliases before ordinary outside-argument fallback.

BYP-01 focused proof uses `plugins/program-bypass.test.ts`, immediate request/runner/approval consumers and `sessions/programs.test.ts` for current-mode and post-turn background revocation. Native `tests/e2e/program-bypass.spec.ts` creates two sibling Git repositories, edits and runs locally without external accounts/hardware, exports JSON/Markdown and retains original logs via VERA_BYP01_EVIDENCE_DIR. Windows sandboxed Electron passes. Pinned Linux Node24.21.0 bundled current-source request/tool/runner assertions pass on Ubuntu WSL2 with real child processes; this does not establish native Ubuntu coverage. Full app and official-plugin suites remain explicitly user-deferred.

BYP-02 focused acceptance uses tools/input-bypass.test.ts for real isolated sibling log/definition reads, canonical null-ref provenance, Ask refusal, protected aliases, worker cancellation and all electrical input helper families; authoring.test.ts installs an outside reviewed trial draft; hil/hil.test.ts uses fake instruments for outside plan/firmware/registry paths, changed-byte refusal, fixed outputs and retained background revocation. Candidate/import regressions preserve fixed workbench storage. Targeted Windows CLI replay verifies built worker and durable sibling tool results without external accounts or hardware. Complete app/official-plugin suites are explicitly user-deferred; native Ubuntu is unavailable, and WSL2 Linux proof is labelled separately.

BYP-02 review corrections add real Python HIL/lab-validation acceptance in tests/integration/hil-bypass.test.ts: sibling cwd/plan/firmware/CSV, canonical source consumption after raw alias retargeting at spawn, standalone confinement and host application-data exclusions. Core HIL fake-resource acceptance checks outside cwd resource lookup, canonical helper registry environment, retained epoch and workbench child/output ownership.

TERM-01 focused platform acceptance is tests/integration/commands.test.ts, using the reusable
support/command-platform-probe.ts (bundle with pinned esbuild for Linux standalone execution).
Original logs and receipts live in ignored 05_Software/evaluation-outputs/term01/platform.
Windows pinned Node 24.21.0 proves PowerShell 7, Windows PowerShell fallback, .cmd, UTF-8 quoting,
stdin EOF, clean environment, background readiness/tree stop and session/app cleanup. WSL2 Ubuntu
uses /home/dpasare/vera-cap-01/node-v24.21.0-linux-x64/bin/node for the same acceptance with bash.
WSL2 proof is distinct from native Ubuntu acceptance, which is unavailable on this host. Runs acceptance uses focused command/runner/shared/component/viewer tests, native replay `tests/e2e/command-runs.spec.ts` (real sibling parent/child HTTP servers, UI Stop, next stopped agent output, masked metadata/full viewer, exit code/duration and session filters), and source-bundled `tests/support/command-runs-platform-probe.ts` for Linux short-read/full-log behavior. Original TERM04 logs/receipts/screenshots live under ignored evaluation-outputs/term04.

Additional-folder acceptance uses core tools/additional-folders.test.ts, workbench/path-guard.test.ts
and service.test.ts, plus native/browser tests/e2e/additional-folders.spec.ts. Native receipts and
original logs use evaluation-outputs/term03; VERA_TERM03_EVIDENCE_DIR retains the desktop receipt.
The standalone tests/support/additional-folder-platform-probe.ts proves real file/command cwd,
protected aliases, workbench logs and pending revocation under pinned Windows/WSL2 Node24.21.0;
its optional independently bundled worker also proves canonical-root retarget refusal on Linux.
WSL2 is separate from unavailable native Ubuntu acceptance; unchanged shell/prefix proof is reused.

TERM command-prefix acceptance uses the focused tests/e2e/command-prefixes.spec.ts with VERA_TEST=1 instrumented build. VERA_TERM02_EVIDENCE_DIR retains native receipt/screenshot; original focused/static logs live under evaluation-outputs/term02. TERM01 process/shell proofs are reused for unchanged runner behavior. Native Ubuntu is unavailable on this host.

MASK-03 proof uses focused host/IPC/Runs/terminal/viewer tests and native run-masking.spec.ts:
stored MQTT secret printed by a real process, run args/canonical cwd/status/tail/full logs, running
dialog and finished viewer live changes, interactive terminal snapshots and two-workbench isolation.
Original logs/receipt and bundled-source WSL2 probe are under evaluation-outputs/mask03. WSL2 uses
pinned Linux Node24.21.0; it is distinct from unavailable native Ubuntu. Unchanged TERM PTY/native
packaging proof is reused; selected delivery artifacts and final exact-source gate remain deferred.

MASK-01 infrastructure proof uses shared privacy/workbench/IPC contracts, core settings/masking and
settings/workbench persistence cases. No native shell/PTY behavior changes: reuse TERM proof.
Original focused/static logs use evaluation-outputs/mask01. Full suites/deliveries remain deferred;
native Ubuntu is unavailable on this Windows host.

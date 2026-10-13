# Environment guide

## Toolchain

The repository toolchain is defined by [02_Tools/toolchain.json](../../02_Tools/toolchain.json). [02_Tools/README.md](../../02_Tools/README.md) documents Python, Git and the local Node runtime.

## Setup

Use the repository setup script from the repository root; it downloads the verified pinned Node distribution, installs npm packages and checks Ubuntu libraries.

## Configuration and services

The software root holds npm workspaces, Biome, TypeScript and Vitest configuration. [aegis.toml](../aegis.toml) supplies workflow commands and paths.

## Readiness checks

Run the documented setup --check before verification on a new machine. Ubuntu system packages require separate host installation; the setup checker prints missing packages.

## Build and run

Run commands from 05_Software using the repository-local npmw.py wrapper when Node is absent from PATH.

`npm run dev` uses loopback Vite on 127.0.0.1:5173. `VITE_API=mock npm run dev:renderer` serves the browser renderer through the same Vite configuration. `npm run build` emits main ESM, sandboxed preload CommonJS and renderer assets; production uses the confined vera://app origin. npm ci installs the pinned Electron binary through install-electron and permits the pinned esbuild install scripts.

## Verification

Demo acceptance uses future main/demo-workbench.test.ts, shared/demo.test.ts and renderer workspace/mock scenarios, plus fresh isolated userData and all three suggested prompts with a real model by hand. The bundled inventory lives in shared/src/demo.json; generated PDFs are reused from the demo fixture, and package staging delivers the same allowlisted corpus.

Release acceptance uses `smoke:package -- --artifact <already-built native release>`;
see [release smoke](../knowledge/release-smoke.md) for native strace calibration,
normal custom-provider approval/restart and pending manual Windows capture.
Release and instrumented calibration builds are separate; M4 gate is coordinator-owned.

Upgrade safety acceptance uses frozen settings0/1/2/3, credentials schema1 and
workbench format1, plus previous SQLite0/1/2 fixtures in storage/upgrade-safety.test.ts.
`scripts/probe-upgrade.mjs <owned-scratch> --migration-safety` observes actual NSIS/AppImage
upgrade, prior settings/history and interrupted recovery before the next turn.
e2e/upgrade-safety.spec.ts checks native newer-data refusal/read-only UI and original
file hashes/metadata including WAL/SHM/locks/backups. See [Upgrade safety](../knowledge/upgrade-safety.md).

Update ticket acceptance uses shared/main/backend/core-approval/UI tests and immediate transports,
e2e/updates.spec.ts browser geometry/languages, and scripts/probe-upgrade.mjs with explicit owned scratch.
The latter builds separately identified local instrumented artifacts and records real installed
vN->vN+1, turn/approval deferral and packaged portable metadata-only results; it publishes nothing.
VERA_UPDATE_URL is a fixed build setting. Full M4 gate follows the verification policy owner.

Skills acceptance uses catalog/schema/workbench/registry/session replay and immediate
host/IPC/mock/boundary consumers. e2e/skills.spec.ts observes a UI-created skill in the
next turn's actual loopback provider system request, then disabled/edited metadata;
the browser checks en/ro/de, both themes, five text scales and modal keyboard focus.

Citation acceptance uses shared refs.test.ts, core agent/citations.test.ts and
knowledge/search.test.ts, renderer session/markdown.test.ts and immediate
session/artifact/registry/state/workspace/import-boundary consumers. Focused native
e2e/citations.spec.ts exercises real PDF/Markdown/HTML/text/artifact tool refs,
verified/warning chip presentation and restart persistence on Windows/Ubuntu.

Local document retrieval uses embedding/search/migration/lifecycle units plus
compiled document-hosts/document-cli, issued PDF session replay and native ingest
E2E. eval:retrieval executes the frozen corpus with real local CPU product worker,
persisted search and ADR0015 floors; see [document search](../knowledge/document-search.md).

Keyword proof uses core knowledge/keyword.test.ts, storage/keyword-migration.test.ts
and real processor/watcher/SQLite ingest.test.ts; immediate database/repository,
workbench and import-boundary checks cover migration and lifecycle consumers.
The configured strict run retains static checks under the verification policy.

Retrieval comparison uses pinned Node scripts/compare-embeddings.mjs with owned scratch, local models and output paths. Explicit --prepare downloads verified assets; default inference is local/offline. Focused retrieval/packaging/extraction/boundary tests and native Windows/Ubuntu measurements accompany ADR0015; see [retrieval evaluation](../knowledge/retrieval-evaluation.md).

Extraction acceptance uses core knowledge/{extraction,processor}.test.ts, compiled
CLI/desktop document-hosts.test.ts, deterministic demo-documents.test.ts and
focused native e2e/ingest.spec.ts for worker/chunks/cache/OCR.
`npm run make:demo-pdfs` regenerates the fictional board PDFs from demo Markdown.

Ingest acceptance uses real watcher/SQLite core knowledge/ingest.test.ts, shared
documents-ipc.test.ts and immediate workbench/transport/mock/boundary checks.
Targeted native e2e/ingest.spec.ts exercises workbench/reindex IPC and index events
through actual sandboxed Electron, including close/reopen reconciliation. Linux
uses a short TMPDIR for Electron singleton sockets and an owned electron package.

Subscription ticket proof uses main chatgpt-auth/open-external tests, core llm/subscription and gateway tests, strict shared chatgpt IPC, renderer chatgpt controls and e2e/chatgpt.spec.ts. Scripted OAuth and actual loopback callback cancellation require no model/network; instrumented VERA_TEST_CHATGPT composition is omitted from release. Real subscription sign-in/session/restart/session/signout remains a separate human acceptance flow.

[Verification policy](../../02_Tools/verification-policy.md) defines targeted per-ticket tests and full milestone gates. Static strict checks remain separate from test results. Changes acceptance uses core sessions/changes.test.ts, shared changes-ipc.test.ts, main reveal-path.test.ts, renderer changes-tab.test.ts and e2e/changes.spec.ts on Windows/native Ubuntu; the native test uses the real ask gate and proves counts/diff after restart.

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

Artifact acceptance uses core sessions/artifacts.test.ts, shared artifacts-ipc.test.ts, main artifacts.test.ts, renderer artifacts-tab.test.ts and e2e/artifacts.spec.ts plus the headless CLI process case. Native acceptance proves save/view/export/restart/delete; browser covers en/ro/de, both themes and all text scales at1024×640. Windows proves junction/hardlink boundaries; POSIX file symlinks run on native Ubuntu because this Windows host requires unavailable symlink privilege.

`npm run verify` runs Biome, tsc -b, the English-source en/ro/de catalog audit and Vitest. `npm run test:e2e` builds then runs Playwright Electron and a standalone Chromium mock browser; Linux uses xvfb-run -a. Install the pinned Playwright Chromium runtime with `npx playwright install chromium` from 05_Software before browser acceptance. Acceptance retains sandboxing, uses temporary userData and blocks non-loopback traffic. Build-mode tests execute emitted code for both compile-time values, including instrumented
VERA_TEST_DIALOG_PATH/VERA_REPLAY_DIR presence and release absence, including replay registration code. Workbench acceptance creates spaced/Unicode
folders through the native picker seam, edits full pinned text, reopens recents after restart, removes
missing recents and preserves live foreign locks in read-only mode. The browser mock seeds
empty/missing/read-only/warning states. Windows and Ubuntu E2E run serially because Vite owns5173.

Steering regression routes are agent/steering.test.ts, sessions/service.test.ts, shared/session-state.test.ts, renderer session/workspace.test.ts and native e2e/chat-ui.spec.ts; they inspect ordered tool-boundary delivery, summary-time admission, budgets, pending/recovery and running/approval composer behavior.

Compaction regression routes are agent/compaction.test.ts, sessions/service.test.ts, shared/session-state.test.ts and renderer session/usage-meter.test.ts; they inspect bounded summary/normal requests and complete transcript/restart.

Agent runtime tests use the common replay matrix and deterministic injected counters; pi-agent-core is measured through a stream-function adapter with the same context policy. No live model is needed for runtime acceptance. Session acceptance uses read-then-answer JSONL, real temporary SQLite and a new core instance plus native Electron restart; focused routes are documented in [sessions](../knowledge/sessions.md).

Node Vitest projects install the non-loopback fetch/socket guard before application modules. `npm run smoke:live -- --provider <openai|custom:slug> [--data <userData>]` builds release and runs a manual real-provider test through the ordinary main credential host. It prints scrubbed four-step results and exits nonzero for incomplete required steps. See [LLM gateway](../knowledge/llm-gateway.md) for configuration and replay fixtures.

Plan acceptance uses shared todos.test.ts, core sessions/todos.test.ts, registry.test.ts and renderer plan-tab.test.ts; e2e/plan.spec.ts observes every replacement live plus final list after native restart and localized browser status/geometry. CLI process proof covers the same fixture. Final selections include affected session/runtime/storage/IPC/panel/tooling consumers under the verification policy.

## Platform details

Windows and Ubuntu use separate platform Node distributions and npm native dependencies. Share sources and lockfile, use separate node_modules for platform validation.
Core storage tests execute the pinned real better-sqlite3 addon against temporary databases, including
WAL data, pre-step backups, compatibility refusal and repository rows. Use the focused db/repositories
and workbench service tests for changes, then the configured strict proof and serial native E2E.

Executable-adjacent vera.portable selects adjacent data before readiness. Installed launches accept
--user-data-dir for isolation; selected directories are created before Electron setPath. Portable
regressions use faithful hosts enforcing directory existence, with temporary markers/executables.
Credential/provider tests use injected deterministic crypto and temporary atomic files/logs; native Providers acceptance observes all IPC responses and cleared password drafts through reload/restart and explicit weak-storage choices. Settings/log tests use injected ports and temporary directories;
native acceptance checks all UI theme/scale preferences and panel geometry across restarts, external event refresh and newer-schema protection through shutdown. Browser acceptance checks the three-language minimum-size matrix, keyboard focus, AA contrast, overlay, storage protection and localized save errors.

## Authoritative references

- [Tools](../../02_Tools/README.md)
- [Toolchain](../../02_Tools/toolchain.json)
- [AEGIS commands/layout](../aegis.toml)

Prepared-write focused proof uses tools/write-edit.test.ts, sessions/write-edit.test.ts, workbench/service.test.ts and desktop main/sessions.test.ts with real temporary FS/SQLite. e2e/write-edit.spec.ts uses instrumented replay plus a compiled test-only permission injection; release build regression confirms VERA_TEST_ALLOW_WRITES is omitted.

File-tool proof uses real worker-thread bundles and injected shorter deadlines for catastrophic regex/abort/replacement; native Electron file-tools acceptance invokes sandboxed app.info while matching stalls. Dedicated grep-worker entries ship in desktop and CLI; instrumented file-tool probe is compiled out of release.

Permission approval focused proof uses core sessions/approvals.test.ts, shared/approval-ipc.test.ts, workspace.test.ts and CLI prompt/process tests. e2e/approvals.spec.ts exercises the production gate in compiled native Electron, without permission injection, and minimum-size browser keyboard decisions. Linux CLI process tests use the real script PTY for A/D and Ctrl+C; those Linux-only cases skip on Windows.

Chat UI acceptance uses `e2e/chat-ui.spec.ts` with real native replay and worker calls; `?mock=chat` seeds six selectable session states in browser mock mode. Component tests use jsdom, React act and user-event. Instrumented VERA_REPLAY_DELAY_MS slows replay streams; release builds omit this seam.

Headless `npm run vera -- run …` builds the CLI and dedicated grep worker with pinned esbuild; `build:cli` prepares the workspace vera bin. CLI process acceptance is tests/tooling/cli.test.ts; Node port checks are apps/cli/src/host-ports.test.ts. Explicit replay is a headless interface; desktop keeps its compiled instrumented boundary. See [headless CLI](../knowledge/headless-cli.md) and the software README for provider/data/output/resume behavior.

Desktop main registers the exact-pinned pi-ai public standalone OAuth entrypoint before composing authentication and gateway services, so login, refresh and token conversion are available in compiled Electron bundles. Core remains platform-independent. Focused native acceptance starts the actual bundled OAuth callback/prompt and cancels without opening a browser or exchanging tokens; scripted persistence and real personal acceptance remain separate.

Document viewer acceptance uses shared documents-ipc, core knowledge/viewer and search provenance, workbench/service, main document-viewer scrubbing, renderer documents/markdown and immediate IPC/preload/mock/session/artifact/import consumers. Native e2e/citations.spec.ts proves offline PDF page/snippet/search/zoom, repeated heading and line60–62 anchors, artifacts, Docs and restart; e2e/documents.spec.ts checks en/ro/de light/dark/all-scale1024x640.

Session export/search verification routes are core sessions/export.test.ts and service.test.ts, shared/session-export.test.ts, main/session-export.test.ts and native e2e/session-search.spec.ts; exact execution policy is owned by the current task and user.

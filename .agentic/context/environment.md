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

`npm run package` / `package:test` build host x64 release/instrumented ZIP or AppImage with
electron-builder 26.17.0. `prepare:model` materializes the manifest-pinned model; `-- --offline`
verifies cached assets. Runtime assets never require a model download. Native N-API install scripts
are explicitly denied in allowScripts; use platform-specific installed prebuilds and keep CPU
libraries unpacked. See [native packaging](../knowledge/native-packaging.md) for package reports
and external host harnesses. WP-05 accepts artifact-bound execution on the current connected
Windows host under explicit human authorization, with clean/offline Windows and VC++ runtime
independence required before final release WP-30/WP-33. The offline Windows helper requires
isolation and a machine permitting unsigned executables; a Smart App Control refusal is a failed
environment probe. Linux feasibility uses actual isolated-VM execution.

[05_Software/README.md](../../05_Software/README.md) and [08-quality](../../00_Planning/architecture/08-quality.md) define verification routes.

`npm run verify` runs Biome, tsc -b, the English-source en/ro/de catalog audit and Vitest. `npm run test:e2e` builds then runs Playwright Electron and a standalone Chromium mock browser; Linux uses xvfb-run -a. Install the pinned Playwright Chromium runtime with `npx playwright install chromium` from 05_Software before browser acceptance. Acceptance retains sandboxing, uses temporary userData and blocks non-loopback traffic. Build-mode tests execute emitted code for both compile-time values, including instrumented
VERA_TEST_DIALOG_PATH/VERA_REPLAY_DIR presence and release absence, including replay registration code. Workbench acceptance creates spaced/Unicode
folders through the native picker seam, edits full pinned text, reopens recents after restart, removes
missing recents and preserves live foreign locks in read-only mode. The browser mock seeds
empty/missing/read-only/warning states. Windows and Ubuntu E2E run serially because Vite owns5173.

Node Vitest projects install the non-loopback fetch/socket guard before application modules. `npm run smoke:live -- --provider <openai|custom:slug> [--data <userData>]` builds release and runs a manual real-provider test through the ordinary main credential host. It prints scrubbed four-step results and exits nonzero for incomplete required steps. See [LLM gateway](../knowledge/llm-gateway.md) for configuration and replay fixtures.

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

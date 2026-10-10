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

[05_Software/README.md](../../05_Software/README.md) and [08-quality](../../00_Planning/architecture/08-quality.md) define verification routes.

`npm run verify` runs Biome, tsc -b, the English-source en/ro/de catalog audit and Vitest. `npm run test:e2e` builds then runs Playwright Electron and a standalone Chromium mock browser; Linux uses xvfb-run -a. Install the pinned Playwright Chromium runtime with `npx playwright install chromium` from 05_Software before browser acceptance. Acceptance retains sandboxing, uses temporary userData and blocks non-loopback traffic. Build-mode tests execute emitted code for both compile-time values.

## Platform details

Windows and Ubuntu use separate platform Node distributions and npm native dependencies. Share sources and lockfile, use separate node_modules for platform validation.

Executable-adjacent vera.portable selects adjacent data before readiness. Installed launches accept
--user-data-dir for isolation; selected directories are created before Electron setPath. Portable
regressions use faithful hosts enforcing directory existence, with temporary markers/executables.
Settings/log tests use injected ports and temporary directories;
native acceptance checks all UI theme/scale preferences and panel geometry across restarts, external event refresh and newer-schema protection through shutdown. Browser acceptance checks the three-language minimum-size matrix, keyboard focus, AA contrast, overlay, storage protection and localized save errors.

## Authoritative references

- [Tools](../../02_Tools/README.md)
- [Toolchain](../../02_Tools/toolchain.json)
- [AEGIS commands/layout](../aegis.toml)

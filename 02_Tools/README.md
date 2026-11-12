# Repository tools and environment

Environment, build and release tooling, kept beside the project and outside product source.
Functional tests live in [05_Software/tests](../05_Software/tests/README.md) and measurement
harnesses in [05_Software/evaluators](../05_Software/evaluators/README.md).

```
02_Tools/
  environment/            setup, pinned toolchain, resource preparation, development launchers
  build/                  compilation and static checks
  release/                packaging, update-feed tooling, release environment launchers
  runtime/                ignored, the locally installed Node.js
  cache/                  ignored, npm/Electron download caches and historical caches
  verification-policy.md  repository verification and handover policy
```

## Setup

Requirements on the machine: Python 3.11+ and Git. Everything else is installed inside this folder.

| | Windows | Ubuntu |
|---|---|---|
| Install or repair | `python 02_Tools/environment/setup.py` | `python3 02_Tools/environment/setup.py` |
| Check only | `python 02_Tools/environment/setup.py --check` | `python3 02_Tools/environment/setup.py --check` |

The setup script:
- downloads Node.js (version and SHA-256 pinned in [toolchain.json](environment/toolchain.json))
  into `runtime/`;
- runs `npm ci` in `05_Software` once it has a `package-lock.json`, with the npm and Electron
  download caches in `cache/`;
- on Ubuntu, checks the system libraries Electron and headless end-to-end tests need, and prints the
  `sudo apt install …` line for any that are missing. It never installs system packages itself.

`runtime/` and `cache/` are not in Git; running the setup again recreates them.

## Running npm with the local Node.js

From `05_Software`, select the changed test files:

```
python ../02_Tools/environment/npmw.py npx vitest run <test-files>
python ../02_Tools/environment/npmw.py node --version
```

Full `npm run verify` belongs to a milestone gate, owned once by the last ticket
or coordinator. See [verification and handover policy](verification-policy.md).

The AEGIS commands in `.agentic/aegis.toml` use the same wrapper, so they do not depend on the
Node.js installed on the system, if any.

## Packages for tools outside 05_Software

Node finds packages by walking up from the importing file, so it never reaches
`05_Software/node_modules/` from here. Every JavaScript tool in this folder imports its packages through
[environment/software.mjs](environment/software.mjs), which resolves them as `05_Software/package.json`
would: one pinned dependency tree, no second install and no global tools. The same module exports the
absolute `05_Software` path that tools use for their inputs and outputs. The development launcher
`dev-renderer.mjs`, like its npm script, runs from `05_Software`.

`npm run lint` and `npm run format` check these folders in a second Biome pass with the
`05_Software` configuration, so `environment/`, `build/` and `release/` follow the same rules as the
software. `runtime/` and `cache/` are never linted.

## Environment

| File | Purpose | Invocation and result |
|---|---|---|
| `toolchain.json` | Pinned Node.js version, archive hashes, Linux system libraries | Read by `toolchain.py`. |
| `toolchain.py` | Shared paths and environment for the Python tools | Imported by `setup.py` and `npmw.py`. |
| `setup.py` | Checks and installs the toolchain and npm packages | See [Setup](#setup). |
| `npmw.py` | Runs npm, npx or node from the local toolchain in the current folder | `python ../02_Tools/environment/npmw.py npm run <script>` from `05_Software`. |
| `software.mjs` | `05_Software` path and its pinned packages for the JavaScript tools here | Imported; no command of its own. |
| `prepare-model.mjs` | Verifies the model files against the pinned manifest and downloads missing ones when allowed | `npm run prepare:model`; writes `05_Software/src/models/`. `-- --offline` only verifies the existing cache. |
| `prepare-uv.mjs` | Verifies or downloads the pinned uv binary for this platform | `npm run prepare:uv`; writes `05_Software/src/uv/`. `--offline` refuses a missing archive. |
| `prepare-plugins.mjs` | Builds the official plugins into the bundled catalog release with a private CLI build | `npm run prepare:plugins`; replaces `05_Software/src/bundled-plugins/`. |
| `prepare-windows-runtime.mjs` | Copies the Microsoft VC++ DLLs the manifest names, checking hashes and the Microsoft signature | `npm run prepare:windows-runtime` on Windows; writes `05_Software/src/windows_runtime/`. Default source is System32; `VERA_VC_REDIST_DIR` can point to a redistributable folder. |
| `dev-renderer.mjs` | Starts only the renderer's Vite server from the desktop configuration, without Electron | `npm run dev:renderer`; set `VITE_API=mock` for simulated data. Prints the URL and `VERA_RENDERER_READY`. E2E browser specs start it too. |

`npm run dev` and `npm run build` call `electron-vite` directly and need no tool of their own.

## Build

| File | Purpose | Invocation and result |
|---|---|---|
| `build-cli.mjs` | Bundles the CLI entry and its grep, PDF and embedding workers with esbuild | `npm run build:cli`; writes `05_Software/src/apps/cli/dist/`. `npm run vera -- …` runs it first. |
| `check-i18n.mjs` | Compares the EN/RO/DE catalogs with the translation keys the renderer uses: missing, unused and translation-only keys | `npm run check:i18n`; non-zero exit on errors. `--fixture <json>` checks a negative scenario; its tests are in `05_Software/tests/tooling/i18n.test.ts`. |

## Release

| File | Purpose | Invocation and result |
|---|---|---|
| `package.mjs` | Prepares resources, builds the desktop, assembles native dependencies and produces the platform installers; checks payload and build separation and reports sizes without a limit (ADR-0017) | `npm run package` for release, `npm run package:test` for the instrumented build. Staging in `05_Software/release_tmp/`, artifacts and `package-report.json` in `release_tmp/{release,test}/`. Publishes nothing. |
| `package-checks.mjs` | Reusable checks for PDF.js resources, native files, test hooks and payload content | Imported by packaging, the update probe and packaging tests. |
| `update-config.mjs` | Validates the update-feed URL and builds the electron-builder publish configuration | Imported by the desktop Vite configuration and `package.mjs`. Release requires HTTPS; the instrumented build also allows loopback HTTP. |
| `update-feed.mjs` | Serves a local update feed and records its requests | `startUpdateFeed(directory, port)`, loopback only; used by the update probe and its tests. |
| `smoke-live.mjs` | Builds a release build and launches the app's real-provider check | `npm run smoke:live -- --provider openai` or `--provider custom:slug`, optional `--data <userData>`. Uses the app's configuration and credentials and may send real requests to the provider. |
| `probe-windows-offline.ps1` | Verifies the hash of an instrumented Windows ZIP, confirms existing network isolation, extracts it and launches the packaging probe | `-Artifact <zip> -ExpectedSha256 <sha256> -EvidenceDirectory <directory>`. Refuses active non-loopback adapters, interfaces or routes; never disconnects the host itself. Writes metadata, logs, `probe.json` and `completion.json`. |
| `probe-windows-sandbox.ps1` | Prepares the `.wsb` configuration, the guest start script and hashes for the offline Windows probe | `-Artifact <instrumented-zip> -EvidenceDirectory <directory>`, optional `-Launch` to open Windows Sandbox and start the probe in the guest. |
| `probe-linux-offline.sh` | Runs an instrumented AppImage in an offline Linux VM and collects the probe results | `bash 02_Tools/release/probe-linux-offline.sh <AppImage> <existing-evidence-directory> <test-user>`. Needs root, Python 3 and Xvfb; takes active adapters down and restores them. For the test VM, not the development host. |
| [sandbox/](release/sandbox/README.md) | Manual Windows Sandbox template | See its README. |

Packaging needs a native Windows or Linux x64 host. It rebuilds the staging and output folders of the
chosen mode; they are not an archive for deliveries. Model preparation can need the network. Selected,
validated deliveries belong to `07_Delivery`, as the [software README](../05_Software/README.md)
describes. The package smoke and update probe that check built artifacts are tests, in
[05_Software/tests/packaging](../05_Software/tests/README.md#packaging).

## Where generated files go

- Desktop build: `05_Software/src/apps/desktop/out/`; CLI build: `05_Software/src/apps/cli/dist/`.
- Prepared models, uv and DLLs: `05_Software/src/models/`, `src/uv/` and `src/windows_runtime/`.
- Packaging: `05_Software/release_tmp/`, staging and output separated by mode.
- Environment, build and release caches: `02_Tools/cache/`. Evaluator scratch never goes here; see
  [evaluators](../05_Software/evaluators/README.md#scratch-și-outputs).

This README describes the existing commands; a tool being present does not mean its probe was run or
that a release was validated.

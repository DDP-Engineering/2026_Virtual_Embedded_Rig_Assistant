# Environment guide

## Toolchain

[02_Tools/environment/toolchain.json](../../02_Tools/environment/toolchain.json) defines the repository toolchain. [02_Tools/README.md](../../02_Tools/README.md) documents every tool script.

- The machine supplies Python 3.11.4 or newer and Git. Everything else installs inside the repository.
- Node.js 24.21.0 is pinned by version and SHA-256 and lives in `02_Tools/runtime/` (git-ignored). `05_Software/package.json` requires Node `>=24 <25`.
- npm dependencies are pinned exactly in `05_Software/package.json` and its lockfile. Among them: Electron 44.11.4, electron-builder 26.17.0, electron-vite 5.0.0, TypeScript 6.0.3, Vitest 5.0.3, Playwright 1.64.0, Biome 2.5.15, esbuild 0.25.12, better-sqlite3 13.0.3 and node-pty 1.1.0. Chat image preparation uses sharp 0.35.5 with the host-native image libraries already staged for the desktop.
- Managed plugin Python uses the pinned uv 0.13.7 (`05_Software/src/uv/uv-manifest.json`). `npm run prepare:uv` fetches and verifies it.
- Local embedding assets are pinned in `src/models/<model-id>/model-manifest.json`. `npm run prepare:model` verifies BGE and E5 and fetches missing assets. `-- --offline` verifies the cache without downloading. Both models and their MIT notices ship in every Windows/Linux package. Installed model inference reads each manifest and its assets from the same directory under `resources/models/`. Delivery verification reads archive members with full 7-Zip.

## Setup

Run the setup script from the repository root: `python 02_Tools/environment/setup.py` (Ubuntu: `python3`). It downloads the verified pinned Node.js, runs `npm ci` in `05_Software` and checks the Ubuntu system libraries. It never installs system packages; it prints the `sudo apt install` line for missing ones. Linux source setup also needs `build-essential`, because npm compiles the pinned node-pty module there.

`npm ci` installs the pinned Electron binary through `install-electron`. `allowScripts` in `05_Software/package.json` permits the install scripts of the pinned esbuild and node-pty and denies those of better-sqlite3, onnxruntime-node, protobufjs and electron-winstaller, which use their platform prebuilds.

Install the pinned Playwright Chromium once with `npx playwright install chromium` from `05_Software` before browser acceptance.

## Configuration and services

`05_Software` holds the npm workspaces and the Biome, TypeScript, Vitest and Playwright configuration. [aegis.toml](../aegis.toml) supplies the workflow commands (`test`, `test_impacted`, `lint`, `typecheck`, `i18n`, `help`) with `workdir = "05_Software"`. `check --run` runs lint, typecheck, i18n and help.

Build-time settings, read by the desktop Vite configuration:

| Variable | Effect |
|---|---|
| `VERA_TEST=1` | Instrumented build. It compiles in the test seams: `VERA_TEST_DIALOG_PATH` (folder picker), `VERA_REPLAY_DIR` and `VERA_REPLAY_DELAY_MS` (deterministic replay), `VERA_TEST_ALLOW_WRITES`, `VERA_TEST_CHATGPT` and `VERA_TEST_CATALOG_KEY` (PEM text read at run time, so e2e signs a loopback catalog with a throwaway key). Release builds omit every seam. |
| `VERA_SESSION_PERF=1` | With `VERA_TEST=1`, compiles in the session performance probes. |
| `VERA_BUILD_ROOT` | Optional absolute output folder; the default is `src/apps/desktop/out`. |
| `VERA_UPDATE_URL` | Fixed update feed of the build. Release requires HTTPS. |
| `VERA_PLUGIN_CATALOG_URL` | Default remote plugin catalog folder; empty by default. |
| `VERA_PLUGIN_CATALOG_KEY` | PEM path that replaces the pinned public key `02_Tools/release/catalog-signing-key.pub.pem`. |
| `VERA_VC_REDIST_DIR` | Source folder of the Microsoft runtime DLLs for `prepare:windows-runtime`; the default is System32. |

The catalog signing private key lives outside the repository ([catalog release](../../02_Tools/release/catalog-release.md)); tests never use it.

Offline dependency kits: `npm run vera -- catalog kit --source plugins --platform <windows-x64|linux-x64> --out ../07_Delivery/kit-<platform>` needs the network and the pinned uv. Build each kit on its own platform, because source-only packages with compiled code are built during the kit build. `07_Delivery/kit-*` is git-ignored. The setting `plugins.kit` points provisioning at a kit.

Stored formats: every format is version 1 during development and any other version is invalid data (root AGENTS.md). Current-format fixtures live in `05_Software/tests/fixtures/app-data/`. Project metadata lives under `<workbench>/.vera`; test workbenches are created in the current form.

No external service is required. Tests use loopback fixtures and replay; live providers are reached only by the manual commands marked below.

## Readiness checks

- New machine or new clone: `python 02_Tools/environment/setup.py --check` (Ubuntu: `python3`). It prints missing Ubuntu packages.
- A fresh clone has no built `dist`, no pinned uv and no model assets (all git-ignored). Run `npm run typecheck`, `npm run prepare:uv` and `npm run prepare:model` as the suites you run need them.
- Several suites in `tests/integration` and `tests/plugins` import `@vera/core` and `@vera/shared` through their built `dist`. Run `npm run typecheck` (`tsc -b`) after changing shared or core and before those suites.
- Plugin suites run helper scripts on Python 3.11 or newer: `VERA_TEST_PYTHON` when set, else `python` on Windows and `python3` elsewhere. See Verification for its packages.
- Before browser acceptance, the Playwright Chromium runtime must be installed (Setup).

## Build and run

Run every command from `05_Software`. When Node is not on PATH, prefix it with the wrapper: `python ../02_Tools/environment/npmw.py npm run <script>` (also `npx` and `node`).

| Command | Use |
|---|---|
| `npm run dev` | Electron main, sandboxed preload and React renderer with loopback Vite on 127.0.0.1:5173 (strict port). |
| `VITE_API=mock npm run dev:renderer` | Browser renderer only, with simulated data, through the same Vite configuration. |
| `npm run build` | Emits main ESM, sandboxed preload CommonJS and renderer assets into `src/apps/desktop/out`. Production uses the confined `vera://app` origin. |
| `npm run build:cli` | Bundles the headless `vera` bin and its workers with the pinned esbuild. |
| `npm run vera -- <args>` | Builds the CLI, then runs it, for example `vera run`, `vera catalog check`, `vera catalog build`, `vera plugin install`. See [headless CLI](../knowledge/headless-cli.md). |
| `npm run format` | Biome formatting and safe fixes, for `05_Software` and the `02_Tools` script folders. |
| `npm run help:shortcuts` | Regenerates `help/<lang>/shortcuts.md` from the shortcut registry. |
| `npm run prepare:plugins` | Builds the official plugins into the bundled catalog release in `07_Delivery/plugins/` (git-ignored). |
| `npm run prepare:windows-runtime` | Windows only. Copies the pinned Microsoft VC++ DLLs, checking hashes and the Microsoft signature. |
| `npm run package` / `npm run package:test` | Host x64 release or instrumented build: NSIS and portable ZIP on Windows, AppImage and deb on Linux. Needs a native host of that platform. See [native packaging](../knowledge/native-packaging.md). |
| `npm run delivery:vera`, `delivery:plugins`, `delivery:plugin-deps`, `delivery:verify` | Collect and verify checksummed deliveries in `07_Delivery/vera-<version>/`. See the Delivery section of [02_Tools/README.md](../../02_Tools/README.md). |

Clean, offline Windows execution and real VC++ self-containment are required before a final release and are not established on the development host. The offline Windows probe needs network isolation and a machine that permits unsigned executables; a Smart App Control refusal is a failed environment probe. The Linux offline probe runs in an isolated VM.

## Verification

[Verification policy](../../02_Tools/verification-policy.md) rules: a ticket runs the smallest sufficient tests for the changed behavior and its immediate consumers, plus the static checks. Complete suites run once per milestone, on Windows and native Ubuntu. Static checks are not test results. Per-component test files are named in each [knowledge page](../knowledge/) and in the [test inventory](../../05_Software/tests/README.md); this section holds only what is common.

### Commands

| Command | Use |
|---|---|
| `npm run lint`, `typecheck`, `check:i18n`, `check:help`, `check:release-notes` | Static checks: Biome, `tsc -b`, the en/ro/de/fr catalog audit, the help page audit and the release notes audit. Run them for every ticket. |
| `npx vitest run <test files>` | Focused tests; the AEGIS `test_impacted` command. `--project <name>` selects one Vitest project. |
| `npm test` | Every Vitest project except `plugins`: workspace unit and component tests, then `tooling`, `integration` and `packaging`. |
| `npm run test:plugins` | `tests/plugins`, one suite per official plugin. Run it for a change to a plugin or to the plugin system, and before a delivery. |
| `npm run test:coverage` | `npm test` with V8 coverage in `coverage/`. |
| `npm run verify` | lint, typecheck, check:i18n, check:help, check:release-notes and `npm test`. Milestone gate. |
| `npm run verify:all` | `verify` plus `test:plugins`. The milestone gate also adds the complete e2e suite, the CLI regressions and strict AEGIS. |
| `npm run test:e2e [-- <spec> <Playwright args>]` | Playwright acceptance: sandboxed native Electron and Chromium against the mock renderer. |
| `npm run eval:retrieval` | Retrieval evaluation on the frozen corpus with the real local CPU worker, persisted search and the ADR 0015 floors. See [document search](../knowledge/document-search.md). |
| `npm run perf:sessions -- run\|calibrate\|compare` | Saved-session performance on an isolated instrumented build. See [session performance](../../06_SoftwareDocu/session-performance.md). |
| `npm run smoke:package -- --artifact <built native release>` | Release smoke on an already built artifact. See [release smoke](../knowledge/release-smoke.md). |
| `npm run smoke:live -- --provider <openai\|custom:slug> [--data <userData>]` | Manual. Builds release and runs the four-step real-provider test through the stored credentials. It may send real requests. It exits non-zero when a required step is incomplete. |
| `node tests/packaging/probe-upgrade.mjs <owned scratch folder>` | Update probe. Builds local instrumented artifacts and installs vN, then vN+1; it checks the SHA-512 refusal of a corrupt hash and turn/approval deferral, and publishes nothing. It does not check that settings, history or recovery survive an update. |
| `npm run make:demo-pdfs`, `node tests/support/make-office-fixtures.mjs` | Regenerate the fictional board PDFs and the committed office fixtures. |

There is no upgrade-safety suite, because every stored format is version 1.

### Rules and limits common to all suites

- Vitest installs a non-loopback fetch and socket guard before application modules. E2e blocks non-loopback traffic, keeps Chromium sandboxing and uses temporary `userData`.
- No live model is needed. Runtime, session and UI acceptance use deterministic replay and loopback transports. Real subscription sign-in, live web providers and live supplier keys are separate manual checks.
- No test reaches real hardware. Boards, probes, instruments, adapters and meters are simulated by stand-ins; real-device acceptance is pending for every hardware plugin.
- Linux in WSL2 is Linux execution. It is not native Ubuntu acceptance; say which one a result comes from. linux-arm64 execution is not established.
- Some cases run on one platform only: SIGTERM stop branches, the `script` PTY cases of the CLI and POSIX file symlinks run on Linux; junction and case-alias cases and LTspice run on Windows.
- `tests/integration/commands.test.ts` runs its Windows probe only where PowerShell 7 (`pwsh`) is installed; Windows PowerShell 5.1 drops double quotes from native arguments.
- Vitest runs at most four workers. `tooling`, `integration`, `packaging` and `plugins` run one file at a time, because they share CLI and build outputs. Stop the normal app and other builds or suites during `perf:sessions` measurements.
- Keep original logs, receipts and screenshots in the git-ignored `05_Software/evaluation-outputs/` or in a task-owned scratch folder, never in the repository.

### E2e

- `test:e2e` runs `tests/support/test-e2e.mjs`. It sets `VERA_TEST=1` unless the variable is already set, builds or reuses the desktop test build, then runs the `@parallel-browser` specs with two workers and the remaining specs with one. Linux runs under `xvfb-run -a`.
- `-- --browser-only` and `-- --serial-only` select one lane. The browser lane needs no desktop build. A failing lane stops the run, so run the lanes apart to see both.
- Native specs need a build made with `VERA_TEST=1`. A build made with another value compiles the seams out, and workbench creation in the specs then waits until its timeout.
- The e2e build rewrites `src/apps/desktop/out`, which `npm run dev` also uses. Stop the development app before native e2e. Restart it afterwards with `VERA_TEST=0`.
- Traces, videos and screenshots are off. The output is a temporary system folder that the cleanup reporter removes, also after failures; read errors from the console. Replacing the reporters from the command line can bypass the cleanup.
- Browser mock states are seeded through URL parameters such as `?mock=chat`.
- Native `session-delegation.spec.ts` runs replay launch, reasoning, independent parent work and
  result use, linked transcripts, Stop, missed notification recovery and restart. Set the optional
  `VERA_DELEGATION_PROOF_DIR` to an existing owned folder to keep the two UI captures.
- Optional outputs: `VERA_E2E_EVIDENCE_DIR` (ingest diagnostics on failure), `VERA_NAV_SCREENSHOT` and `VERA_PDF_SCREENSHOT` (screenshot path prefixes), `VERA_TERM02_EVIDENCE_DIR`, `VERA_TERM03_EVIDENCE_DIR`, `VERA_TERM05_EVIDENCE_DIR` and `VERA_BYP01_EVIDENCE_DIR` (native receipts). `VERA_TERM05_APP` points the terminal spec at an extracted packaged binary.

### Plugin suites

- Default runs need no network, no uv and no hardware. They use fakes and stand-ins under `tests/fixtures/<plugin>/` and `tests/support/`. [Official plugins](../knowledge/official-plugins.md) names each plugin's fixtures.
- The helper Python needs `paho-mqtt==2.1.0`, `cryptography`, `asyncssh==2.24.1`, `flatbuffers==25.12.19` and `PyYAML==6.0.3`. On Windows it also needs pip: several suites build `.exe` launchers with pip's vendored distlib. An isolated environment can live at `02_Tools/runtime/test-python`.
- `git` must be on PATH (Git 2.40 or newer for the git suite).
- `VERA_TEST_EVIDENCE_DIR` keeps original argv, output, events and approvals of replay runs. `VERA_CLI_EVIDENCE_DIR` does the same for CLI process tests.
- The raspberry-pi-linux SSH block needs a Linux shell with `/usr/bin/python3`: the host on Linux, the default WSL distribution on Windows. It connects only to 127.0.0.1 and removes its temporary home and user unit. `VERA_TEST_PI_REMOTE=none` skips it.
- Suites that find an installed vendor tool use it and otherwise skip those cases with a console note: KiCad 10, TShark and STM32CubeProgrammer (output texts asserted only on 2.23.0).
- zephyr and platformio run only their package and rule tests unless `VERA_ZEPHYR_PYTHON` or `VERA_PIO_PYTHON` names a Python 3.12 with the helper's pinned PEP 723 dependencies. Zephyr builds need a short `TEMP` path on Windows (MAX_PATH).
- LTspice never runs from a test without `-b`, and never with a fresh `-ini` file, because it then waits on a prompt.

Opt-in variables enable cases that use a real tool. Without them those cases are skipped.

| Variable | Enables |
|---|---|
| `VERA_EFUSE_UV`, `VERA_CAN_UV`, `VERA_SCPI_UV`, `VERA_LABVAL_UV`, `VERA_ELEC_UV`, `VERA_KICAD_UV`, `VERA_PARTS_UV`, `VERA_MCU_UV`, `VERA_NGSPICE_UV` | Provisioning through a real uv. Most reach PyPI or download uv's managed CPython. eFuse burns stay virtual (`--virt`); `VERA_EFUSE_SCRATCH` selects its scratch folder. `VERA_SCPI_PYTHON_SEED` names a uv Python folder to copy in. `VERA_NGSPICE_ARCHIVE` names the official `ngspice-47_64.7z`. |
| `VERA_BINUTILS_ARCHIVES`, `VERA_PROBE_RS_ARCHIVES`, `VERA_SIGROK_ARCHIVES` | Real x64 extraction and probes from locally prepared official archives, with no test network. |
| `VERA_TEST_NGSPICE`, `VERA_TEST_LTSPICE` | Real-engine cases with the named ngspice engine or the user's `LTspice.exe` (26 or newer, Windows). |
| `VERA_TEST_UV`, `VERA_TEST_KICAD_GUI`, `VERA_TEST_KICAD_CLI` | kicad-layout: the uv to use; PCB editor cases that open real KiCad 10 windows (KiCad's API enabled, no other KiCad window open); the `kicad-cli` path. |
| `VERA_RENODE_REAL`, `VERA_ZEPHYR_REAL`, `VERA_ZEPHYR_REAL_CLI`, `VERA_PIO_REAL`, `VERA_PIO_REAL_GCC` | Real Renode 1.17.0; a prepared west workspace with the Zephyr SDK; the real STM32_Programmer_CLI (no board); a prepared PlatformIO core with libraries; a host gcc for native tests. |
| `VERA_GDB_ORACLE_PYTHON`, `VERA_GDB_REAL_GDB`, `VERA_GDB_REAL_OPENOCD` | A Python with pyelftools 0.32 as oracle; a real arm-none-eabi-gdb 12 or newer against the fake target; a real OpenOCD 0.12 or newer that stops at the missing adapter. |
| `VERA_POWER_REAL_PYTHON`, `VERA_TEST_BLE_PYTHON`, `VERA_TEST_WOKWI_CLI` | A Python with pyjoulescope_driver 2.5.5 (no device); a Python with bleak 3.1.0 for one real scan, never a connection; the real wokwi-cli 0.29.1 for offline checks. |
| `VERA_TSHARK_LIVE_INTERFACE` | A bounded live capture of self-sent UDP on the loopback interface. The default live-capture step is denied. |

## Platform details

- Target platforms are Windows x64 and Linux x64. Windows and Ubuntu use separate Node distributions and native npm dependencies. Share sources and lockfile; keep a separate `node_modules` per platform.
- Core storage tests run the pinned real better-sqlite3 addon against temporary databases.
- Linux: e2e runs through `xvfb-run`. Maximize, restore and persisted-position checks need a real window manager on that display; WSLg alone does not provide it. `VERA_E2E_SESSION_WRAPPER` names an executable that starts the manager, runs the argv it receives and cleans up; `test:e2e` invokes it inside `xvfb-run`. Use a short `TMPDIR` for the Electron singleton sockets.
- Linux checks from a Windows host run in a WSL2 Ubuntu 24.04 clone of the repository, prepared with `setup.py` there. Do not copy working files from the NTFS mount without restoring file modes: NTFS reports every file as executable.
- Windows: POSIX file symlink cases need a privilege the development host lacks, so they run on Linux.
- On the development workstation PowerShell runs in Constrained Language Mode: .NET method calls fail in scripts. Edit files with an editor tool or a short Python script.
- The repository enforces LF line endings (`.gitattributes`). Python text-mode writes on Windows produce CRLF; pass `newline="\n"`.
- Portable mode: an executable-adjacent `vera.portable` selects adjacent data before readiness. Installed launches accept `--user-data-dir` for isolation.

## Authoritative references

- [Tools and setup](../../02_Tools/README.md)
- [Toolchain pins](../../02_Tools/environment/toolchain.json)
- [Verification and handover policy](../../02_Tools/verification-policy.md)
- [AEGIS commands and layout](../aegis.toml)
- [Software README](../../05_Software/README.md): commands and source layout
- [Test inventory](../../05_Software/tests/README.md): test folders, execution cost, e2e runner
- [Quality](../../00_Planning/architecture/08-quality.md): verification routes
- [Software tooling](../knowledge/software-tooling.md), [native packaging](../knowledge/native-packaging.md), [release smoke](../knowledge/release-smoke.md): component detail

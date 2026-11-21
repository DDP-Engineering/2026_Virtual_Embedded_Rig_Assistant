# Packaging, delivery and quality

How VERA is versioned, packaged, updated, signed and delivered, how a development machine is set up,
and how the code is checked. Data locations, including portable data, are in [System.md](System.md);
the plugin catalog mechanism is in [Plugins.md](Plugins.md).

## Versions and releases

- One Semantic Version for the whole app. Its source is `05_Software/src/apps/desktop/package.json`
  (`0.2.0`). A beta is `x.y.z-beta.n`.
- `02_Tools/release/set-version.mjs <x.y.z>` is the only way to change it. It refuses a version that
  is not SemVer or not higher than the current one, writes it to the four workspace packages and the
  lock file, rolls `## [Unreleased]` of the root `CHANGELOG.md` into a dated release section, and
  turns `05_Software/release-notes/unreleased.yaml` into `<x.y.z>.yaml`.
- Pre-release policy: every version below `1.0.0` is a pre-release (`AGENTS.md`, "Pre-release
  policy"). Every persisted format keeps its version field at `1`; any other value is invalid data.
  There are no migrations, upgrade backups, legacy fallbacks or "created by a newer VERA" handling.
  Data from an earlier development build may stop loading and is deleted or recreated.
- Each plugin has its own version in `plugin.yaml` and its own release cadence. A plugin fix never
  needs a new installer.
- The rules for versions, `CHANGELOG.md`, release-notes files and the release steps are in
  [01_Documentation/Releases.md](../01_Documentation/Releases.md). `npm run check:release-notes`
  (part of `verify`) enforces the release-notes rules. The app shows the notes in
  Settings > About > What's new.

## Packages

`npm run package` (`02_Tools/release/package.mjs`) builds the release packages of the host platform
with electron-builder 26.17.0. It extends `05_Software/src/apps/desktop/electron-builder.yml` and
supplies identity, targets, signing and the update feed. Packaging runs only on a native Windows x64
or Linux x64 host and packs only that host's native binaries.

| Platform | Artifact | Notes |
|---|---|---|
| Windows x64 | NSIS installer `VERA-<v>-win-x64.exe` | per user, one-click, never elevates; uninstall keeps app data |
| Windows x64 | portable ZIP `VERA-<v>-win-x64.zip` | built in a second pass; only this payload holds `vera.portable` |
| Linux x64 | AppImage | `chmod +x` and run |
| Linux x64 | deb | installed with the package manager; category Development |

The build fails unless both artifacts of its platform are produced.

What a package contains:

| Content | Where |
|---|---|
| Electron 44.11.4 and the electron-vite bundle (`out/`) | `app.asar` |
| Runtime packages kept outside the bundle (better-sqlite3, transformers, onnxruntime-node, sharp, pdfjs-dist, electron-updater, node-pty) and their dependencies | `app.asar`; native files in `app.asar.unpacked` |
| Embedding models `Xenova/bge-small-en-v1.5` and `Xenova/multilingual-e5-small`, pinned in `src/models/<id>/model-manifest.json` | `<resources>/models/<id>/` |
| uv 0.13.7 (`src/uv/uv-manifest.json`), which installs plugin programs | `<resources>/uv/` |
| The official plugins as a catalog release (manifests, skills, scripts; no plugin programs) | `<resources>/plugins/` |
| App help pages in four languages (`05_Software/help/`) | `<resources>/help/` |
| Windows only: five pinned VC++ x64 DLLs (`src/windows_runtime/`) and `NOTICE.txt` | beside the native binaries that need them |
| `LICENSE.txt` and `THIRD-PARTY-NOTICES.txt` (each bundled dependency's name, version, licence) | beside the executable |

Checks during packaging:

- Model files, uv, plugin zips and VC++ DLLs are checked by size and SHA-256 before and after
  packing; a DLL also needs a valid Microsoft Authenticode signature.
- No path over 160 characters, no secret-like file (`.env*`, `credentials*.json`, `*.pfx`, `*.p12`,
  `*.key`), no API-key or private-key pattern in text files. No size limit.
- A release build (`VERA_TEST=0`) fails if a test hook or `VERA_TEST_*` name remains in the code.
  `npm run package:test` (`VERA_TEST=1`) builds instrumented "VERA Test" packages (app id
  `engineering.ddp.vera.test`, files `VERA-test-…`) for debugging; they are never delivered.
- The build fails if its inputs (scripts, builder config, lock file, manifests) change while it runs.
- Output: `05_Software/release_tmp/release/` (or `test/`), rebuilt from scratch, with
  `package-report.json` (artifact sizes and SHA-256, signing state, checks, largest files, inputs).

Portable mode: a file `vera.portable` beside the executable makes VERA keep all its data in `data\`
beside the app, created on first start. Only the Windows ZIP ships that file. The portable app needs
no installation; the user unzips it and starts `vera.exe`.

No package needs network to install or start. Remote model providers need their own network.

## Updates

The update feed is a build input, `VERA_UPDATE_URL`, compiled into the main process and into
`app-update.yml`. It must be HTTPS without credentials, query or fragment; instrumented builds also
accept loopback HTTP. A build without a feed checks nothing, and "Check now" reports "This build has
no update feed configured."

- The feed is an electron-updater 6.8.10 generic feed folder: `latest.yml`, `beta.yml`,
  `latest-linux.yml`, `beta-linux.yml`, the installers and their `.blockmap` files.
- Settings: mode Off, Notify (default) or Download automatically; channel Stable (`latest`) or
  Beta (includes stable). Stable reads only `latest` and ignores pre-release versions. Beta reads
  `latest` and `beta` and offers the highest version. Only versions newer than the running one are
  offered; downgrades never are.
- VERA checks after the main window opens and then every 6 hours, while the mode is not Off.
  Turning updates on or changing the channel checks at once. "Check now" works also when Off.
- What each build does:

| Build | Behaviour |
|---|---|
| NSIS installer, AppImage ("installed") | check, download (by click in Notify, at once in Download automatically), install |
| Windows ZIP ("portable") | check only; "Open download link" opens the feed's `.exe` in the system browser after a confirmation; the user replaces the folder |
| deb, or any Linux build not started as an AppImage ("managed") | check only; shows "Install updates through your package manager." |

- Verification: every file listed in the feed must carry a SHA-512, or the check fails with an
  integrity error; electron-updater verifies the download against it. On a signed Windows build the
  download also requires `publisherName` in `app-update.yml`, and electron-updater checks the
  installer's publisher. A portable download link must have the feed's origin and lie under its
  folder.
- Install: on "Restart to update" (relaunch) or on the next quit, only after sessions, workbench,
  settings and logs have drained. While a turn runs or an approval waits the install is deferred and
  retried every 100 ms. A failed drain never starts the installer.
- Release notes come from the feed (`releaseNotes`, cut at 65,536 characters) and show in the Updates panel.
- Offline or failed: a feed that cannot be reached shows a network error with "Check again to
  retry"; nothing else changes. To update without network, run the newer installer by hand (the NSIS
  installer upgrades in place and keeps app data), replace the AppImage, or use the package manager.
  Rollback is the same with the older installer.
- `node tests/packaging/probe-upgrade.mjs <scratch>` builds two instrumented versions, installs the
  older one and updates it from a local feed (`02_Tools/release/update-feed.mjs`, 127.0.0.1).

## Signing

- Windows signing is requested when `WIN_CSC_LINK`, `CSC_LINK`, `VERA_CERTIFICATE_SHA1` or
  `VERA_CERTIFICATE_SUBJECT` is set at build time. The build then forces code signing and fails
  unless the executable and the installer carry a valid Authenticode signature. Without them the
  build is unsigned and still works; SmartScreen warns on the installer.
- Linux AppImage and deb are not signed. Every artifact's SHA-256 is in `package-report.json` and
  the delivery's `SHA256SUMS`.
- `package-report.json` and `delivery.json` record `requested`, `unsigned` or `not-applicable`. The
  `app.info` IPC reports `signed`, `unsigned` or `not-applicable`; About shows no signing label.
- `delivery:verify` warns "the installers are not code-signed" for an unsigned part and "the catalog
  is not signed" when the channel indexes have no `.sig` files, and also for parts built from
  different commits or an uncommitted tree. Warnings do not fail the check; they mark the delivery
  as not ready to release.
- Remote plugin catalog indexes are signed with Ed25519; the build pins the public key
  `02_Tools/release/catalog-signing-key.pub.pem` (or `VERA_PLUGIN_CATALOG_KEY`). Key handling and
  catalog publishing: [catalog-release.md](../02_Tools/release/catalog-release.md).

## Delivery

Three independent deliverables: VERA for Windows, VERA for Linux, and the plugins with their offline
dependency kits. Everything in `07_Delivery/` except `README.md` is git-ignored.

```
07_Delivery/
  plugins/               working catalog release (npm run prepare:plugins); packaged as <resources>/plugins/
  vera-<version>/
    vera-windows-x64/    VERA-<v>-win-x64.exe, VERA-<v>-win-x64.zip, RELEASE-NOTES.md, SHA256SUMS
    vera-linux-x64/      VERA-<v>-…AppImage, VERA-<v>-…deb, RELEASE-NOTES.md, SHA256SUMS
    plugins/             <id>-<version>.zip, index.json, index-stable.json, index-pre-release.json,
                         *.sig when signed, vera-plugins-<version>.zip, LICENSE.txt, SHA256SUMS
    plugin-deps/         vera-plugin-deps-<version>-windows-x64.zip, …-linux-x64.zip, SHA256SUMS
    delivery.json        version, commit, dirty flag and host per part; files with SHA-256 and size
```

`<version>` is the desktop version; while it is `0.0.0` the folder is `vera-0.0.0-<short commit>`.
`RELEASE-NOTES.md` is the English text of that version's release-notes file.

The npm scripts run the scripts in `02_Tools/delivery/`:

| npm script | Does |
|---|---|
| `delivery:vera -- --platform windows-x64\|linux-x64` | `npm run package` (release mode only), then copies the artifacts of `package-report.json` |
| `delivery:plugins [-- --signing-key <pem>]` | `prepare:plugins`, signs the channel indexes when a key is given, zips the catalog |
| `delivery:plugin-deps -- --platform …` | `vera catalog kit` (default `--skip sigrok`), zipped; needs network |
| `delivery:verify [-- <folder>]` | checks a delivery without changing or publishing anything |

- A platform part is built only on its own host. An existing part is refused; `--replace` rebuilds
  only that part. A part is built in a staging folder and moved into place at the end.
- `delivery:verify` checks the checksums, one version in every part, the expected files per part,
  the pinned model files inside each installer (with 7-Zip), the plugin zips and index signatures,
  and the catalog archive. It lists missing parts and exits 1 on any mismatch.
- The plugin catalog ships apart from the installer: one zip per plugin, or the whole catalog for an
  offline machine. Plugin programs are never in the installer or the plugin zips; the dependency kit
  carries the pinned files once per SHA-256. Vendor programs (for example KiCad) are never in it.
- Offline installation on a bench: `07_Delivery/README.md`, section "INSTALL".

## Development environment

- `python 02_Tools/environment/setup.py` (Python 3.11.4 or newer) checks Git, installs the pinned
  Node.js 24.21.0 (from `toolchain.json`, SHA-256 verified) into `02_Tools/runtime/`, and runs
  `npm ci` in `05_Software` with the npm and Electron caches in `02_Tools/cache/`. On Linux it reports
  missing system packages (Electron libraries, build tools, `xvfb`) with the `apt` command.
  `--check` reports only. Nothing is installed system-wide.
- `python 02_Tools/environment/npmw.py <npm|npx|node> …` runs that toolchain whatever is on the PATH
  and warns when `node_modules` is older than `package-lock.json`.
- Prepare scripts (`02_Tools/environment/`, npm scripts of the same name): `prepare:model` (download,
  or verify with `-- --offline`), `prepare:uv`, `prepare:plugins` (builds `07_Delivery/plugins/` with
  `vera catalog build`) and `prepare:windows-runtime` (DLLs from `System32` or `VERA_VC_REDIST_DIR`).
  `npm run package` runs the ones it needs.

## Quality

Commands, from `05_Software`:

| Command | Does |
|---|---|
| `npm run verify` | lint, typecheck, `check:i18n`, `check:help`, `check:release-notes`, test, in that order |
| `npm run verify:all` | `verify`, then `test:plugins` |
| `npm run lint`, `typecheck` | Biome (lint, format, import boundaries), including `02_Tools` scripts; `tsc -b` |
| `npm test` | `vitest run` over every project except `plugins`; `-- --project <name>` selects one |
| `npm run test:plugins` | the `plugins` project only |
| `npm run test:e2e` | Playwright over `tests/e2e/` through `tests/support/test-e2e.mjs` |
| `npm run smoke:package -- --artifact <path>` | checks an already-built release artifact |
| `npm run smoke:live -- --provider <id>` | release-mode connection test against a real provider, by hand only |

Test layers and Vitest projects (`vitest.config.ts` plus one config per workspace):

| Layer | Where | Project |
|---|---|---|
| Unit and component | beside the code in `src/libraries/*` and `src/apps/*`; renderer tests use jsdom and the mock API | `@vera/shared`, `core`, `core-resources` (heavy suites, one file at a time), `cli`, `desktop` |
| Tooling | `tests/tooling/` | `tooling` |
| Integration | `tests/integration/` (CLI process, documents, workers, retrieval, plugin system) | `integration` |
| Packaging | `tests/packaging/` (payload checks, smoke tools, update feed) | `packaging` |
| Plugins | `tests/plugins/<name>.test.ts`, one suite per official plugin or plugin family (not every plugin has one), often with its real programs | `plugins` |
| End-to-end | `tests/e2e/*.spec.ts` | Playwright |

`tooling`, `integration`, `packaging` and `plugins` run after the workspace tests, one file at a
time. The inventory of suites, fixtures and helpers is in
[05_Software/tests/README.md](../05_Software/tests/README.md).

- E2E has two lanes. The browser lane runs specs tagged `@parallel-browser` against the mock
  renderer in Chromium with two workers. The serial lane runs everything else, mainly the real
  Electron app with a temporary `--user-data-dir`, with one worker. `--browser-only` and
  `--serial-only` pick one lane; browser-only skips the Electron build. The runner sets `VERA_TEST=1`
  unless it is set, and wraps Playwright in `xvfb-run -a` on Linux.
- No test calls a real model. The replay provider (`src/libraries/core/src/llm/replay.ts`) plays
  JSONL scripts from `tests/fixtures/llm-scripts/`, one model step per line (`text`, `toolCalls`,
  optional `usage`). Model `replay/<name>` picks a script; `replay/auto` picks the first whose
  `match` regex fits the user message. `{{key}}` placeholders take values from earlier tool results.
  Replay models report a 32768-token context and up to 4096 output tokens. The CLI uses it with
  `vera run --provider replay --script <file>`, instrumented desktop builds with `VERA_REPLAY_DIR`.
  That and the other test switches (`VERA_TEST_*`) exist only in `VERA_TEST=1` builds.
- Fixtures are fictional (the demo workbench `tests/fixtures/workbenches/demo-board/`, documents,
  retrieval questions, app data, plugin inputs). Tests copy them and never change them in place.
- Network guard: every Vitest project loads `tests/support/network-setup.ts`, which fails a test
  after any non-loopback `fetch` or socket connect of the test process. Child processes (Python
  helpers, uv, Git) are not covered; their tests give them loopback endpoints. E2E specs install
  `tests/e2e/network-guard.ts` in the app's main process.
- Tool-gated plugin suites run only where the program exists. A missing program shows in the report
  as a named skip, "skips <suite>: <reason>", with what enables it (`tests/support/skip-marker.ts`).
- Release smoke (`tests/packaging/smoke/smoke-package.mjs`) runs a built release artifact, never an
  instrumented one. It installs or extracts it into `Release é`, then runs offline (the demo
  `Demo board é` indexes, a local search returns results, a PDF renders, the index survives a
  restart) and a scripted session against a harness server on an exact 127.0.0.1 port through the
  normal custom provider (`read`, an approved `write`, a cited answer, exactly 3 requests, the same
  snapshot after restart). It also checks Electron 44.11.4, the sandbox, and disabled spell-check
  downloads and ONNX Runtime telemetry. Exit 0 pass, 1 failure, 2 pass with egress proof pending.
- Egress check: on Linux every launch runs under `strace`; any `inet`/`inet6` destination outside
  the run's allowed list fails the smoke, failed attempts included (`smoke-calibration.mjs` is the
  negative control). On Windows the proof is a manual Windows Sandbox run with a `pktmon` capture
  (`02_Tools/release/sandbox/`), attached with `--windows-evidence`; without it it stays pending.

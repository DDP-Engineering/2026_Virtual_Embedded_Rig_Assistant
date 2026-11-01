# 07 — Packaging, portable mode, updates and migrations

This document describes the implementation as of 2026-11-01 (branch `master`, 33e72b8 plus the
working tree). Items marked "Not implemented as of 2026-11-01" are still planned.

PURPOSE: specify how VERA ships as self-contained packages, how portable mode works, how updates are
found, downloaded and installed, how persisted data survives upgrades, and how signed builds behave.
DONE-WHEN (for M4): the exact release packages install, start and index the demo workbench on clean
Windows and Ubuntu machines without Node, Python or internet access. A second run proves an agent
session through a scripted loopback endpoint using the normal custom provider; an installed vN
updates itself to vN+1 from a test feed with sessions and settings intact. The egress check of 08 §5
finds no unexpected connection; release builds contain no test switches.
Status 2026-11-01: the tooling for each check exists (08 §5). The clean/offline Windows run (Windows
Sandbox, `pktmon`, VC++ independence) is manual and still pending, and the upgrade proof comes from
instrumented builds only (§6), so the smoke report keeps both as pending.

## 1. Self-containment rules

- The package carries Electron 44.7.0 (Chromium and Node) and the app code that electron-vite bundles
  into `out/`. As `node_modules` it carries only the runtime packages kept external to the bundle
  (better-sqlite3, @huggingface/transformers, onnxruntime-node, pdfjs-dist, electron-updater) and their
  dependency closure, copied into `release_tmp/staging-<platform>-<mode>/`. It also carries the
  embedding model and the pdf.js cmaps, standard fonts and wasm files (checked byte for byte against the
  pinned pdfjs-dist). The UI uses system fonts.
- Nothing is installed system-wide besides the app. No admin rights: the Windows installer is per-user
  and never elevates. The deb installs through the system package manager.
- First start needs no network. Remote LLM providers need theirs; local endpoints need only localhost.
  The app disables Chromium spell-check dictionary downloads and ONNX Runtime telemetry.
- Native code is excluded from the asar archive (`asarUnpack`: better-sqlite3 prebuilds,
  `onnxruntime-node/bin`, `@img/**`, every `*.node`), because native code cannot read inside it. The
  model is not in the archive at all: `extraResources` places it in `<resources>/models/` with
  `<resources>/model-manifest.json`.
- Model delivery: `src/models/model-manifest.json` pins Xenova/bge-small-en-v1.5 (q8) at an immutable
  Hugging Face revision, with each file's HTTPS URL, size and SHA-256 (ADR-0013, ADR-0015).
  `npm run prepare:model` (also run by `package`) downloads missing files at build time and verifies
  cached ones; `-- --offline` only verifies. The model files are git-ignored. `package` verifies them
  again in the unpacked output.
- Windows VC++ runtime: `src/windows_runtime/windows-runtime-manifest.json` pins five Microsoft VC++
  x64 DLLs (14.44.35211.0: `msvcp140`, `msvcp140_1`, `msvcp140_atomic_wait`, `vcruntime140`,
  `vcruntime140_1`) by size and SHA-256. `npm run prepare:windows-runtime` (also run by `package` on
  Windows) takes them from `System32` or `VERA_VC_REDIST_DIR`, accepts a file only when its hash and its
  Microsoft Authenticode signature match, and writes a `NOTICE.txt`; the DLLs are git-ignored. They are
  placed beside the onnxruntime-node binding in `app.asar.unpacked/.../napi-v6/win32/x64/`, because
  Node's addon loader searches that folder, and verified again after packing. Proof on a clean Windows
  machine without a system VC++ runtime is pending (08 §5).
- Only the build host's x64 native binaries are packaged: foreign better-sqlite3, ONNX Runtime, sharp
  and canvas binaries, ONNX Runtime CUDA/TensorRT libraries, onnxruntime-web and the transformers web
  builds are excluded, and the required natives (on Windows also DirectML, dxcompiler, dxil) must be
  present. Packaging runs only on native Windows x64 or Linux x64 hosts.
- Payload checks before and after packing: paths up to 160 characters, no secret-like files (`.env*`,
  `credentials*.json`, `*.pfx`, `*.p12`, `*.key`) and no API-key or private-key patterns in text files.
  The build fails if its inputs (scripts, builder config, lock file, manifests) change while it runs.
- No size budget (ADR-0017). The packaging script may report the largest contributors but never
  fails on size; `package-report.json` lists the 15 largest files. A pinned `uv` binary for plugins is
  planned (ADR-0017, plugin work package PLG-05); not implemented as of 2026-11-01 — nothing in
  `package.mjs` or `electron-builder.yml` ships it.
- `npm run package` produces release artifacts with test switches compiled out (`VERA_TEST=0`).
  `package:test` (`VERA_TEST=1`) produces separately labelled instrumented artifacts for debugging;
  they are never delivered: app id `engineering.ddp.vera.test`, product "VERA Test", executable
  `vera-test`, files `VERA-test-…`. Both modes inspect the emitted and the packed code; a release build
  fails if any test marker (`VERA_REPLAY_DIR`, `VERA_TEST_DIALOG_PATH`, `VERA_TEST_ALLOW_WRITES`,
  `VERA_TEST_CHATGPT`, `registerReplay`, the packaging probe …) remains.
- Output: `release_tmp/release/` or `release_tmp/test/`, rebuilt from scratch, with
  `package-report.json` (each artifact's size and SHA-256, signing state, payload checks, largest
  contributors, runtime packages, input fingerprints). WP-33 tests the already-built release artifacts
  and records their SHA-256 (08 §5).

## 2. Targets

| Platform | Target | Auto-update | Notes |
|---|---|---|---|
| Windows x64 | NSIS, per-user one-click, no elevation; electron-builder's per-user default `%LOCALAPPDATA%\Programs\VERA` | yes | primary distribution; uninstall keeps app data |
| Windows x64 | zip (portable) | check only | unzip and run; contains `vera.portable`, data beside the app (§4) |
| Linux x64 | AppImage | yes, when run as an AppImage | primary Linux distribution |
| Linux x64 | deb | check only ("Install updates through your package manager") | for managed machines; category Development |

Built by electron-builder 26.17.0 through `scripts/package.mjs`, which extends
`src/apps/desktop/electron-builder.yml` and supplies identity, targets, publish settings and file
filters. On Windows the NSIS installer and the zip are two builder passes, so only the zip payload
receives `vera.portable`. The build fails unless both targets of its platform are produced. Files are
named `VERA-<version>-<os>-<arch>.<ext>` (`VERA-test-…` for `package:test`). Only the target
platform's native binaries are included.

## 3. Version and channels

- One Semantic Version per build, taken from `src/apps/desktop/package.json` (`0.0.0` on 2026-11-01);
  pre-releases use `-beta.N`.
- Channels `latest` ("Stable") and `beta` ("Beta (includes stable)"). The Updates setting picks the
  channel. electron-builder writes update files for all channels. The app keeps one updater per channel:
  Stable reads only the `latest` feed and ignores pre-release versions; Beta reads `latest` and `beta`
  and offers the highest version newer than the running one. Downgrades are never offered.

## 4. Portable mode

- A file named `vera.portable` beside the executable moves `<userData>` to `<app folder>/data/`
  (created when missing) before `app.whenReady()` (01 §6); it takes precedence over `--user-data-dir`.
  Only the zip ships with that file.
- Copying the folder copies settings, credentials and user skills. Credentials encrypted with
  safeStorage are bound to the OS user account and do not decrypt on another machine. "VERA then asks
  for them again" is not implemented as of 2026-11-01: an entry that cannot be decrypted makes the
  credential load fail with INVALID, and start-up stops.
- Portable builds never download or install updates. They check the feed under the same Updates
  setting and show "Version X is available" with the release notes. "Open download link" opens, after a
  confirmation dialog, the feed's installer link (the `.exe`, or the `.AppImage` on Linux) in the system
  browser; the link must have the feed's origin and lie under its path. The user replaces the app folder.

## 5. Update mechanism

```
after the window opens, then every 6 h, when the mode is not Off and the build has a feed
  → check: Stable reads the latest feed; Beta reads latest and beta, the highest newer version wins
  → available → AppEvent update.available {version, notes}; update.changed carries every phase
                  Notify: the user clicks "Download update" (installed builds only)
                  Download automatically: download at once (installed builds only)
  → ready     → banner "Update downloaded. Restart to update."
  → install on "Restart to update" (relaunches) or on the next quit (no relaunch), after sessions,
    workbench, settings and logs have drained; while a turn runs or an approval waits the phase is
    "deferred" and the request is retried every 100 ms. A failed drain never starts the installer.
```

- Turning updates on or changing the channel checks at once; switching to "Download automatically"
  while an update is available starts the download.
- Distribution: NSIS and AppImage are "installed" (check, download, install). The zip is "portable"
  (§4). On Linux a build not started as an AppImage (the deb) is "managed": it reads the feed metadata
  and shows the offer with "Install updates through your package manager", but never downloads.
- Provider: electron-updater 6.8.10 with a **generic** feed (NSIS, AppImage and deb updaters). The feed
  URL is a build setting, `VERA_UPDATE_URL`, compiled into the main process and into `app-update.yml`.
  It must be HTTPS without credentials, query or fragment; instrumented builds also accept loopback HTTP.
  A build without it has no timer, and "Check now" reports "This build has no update feed configured."
  The feed folder holds `latest.yml` and `beta.yml` (Windows), `latest-linux.yml` and `beta-linux.yml`
  (Linux), the installers and their `.blockmap` files.
- Integrity: every file listed in the feed must carry a SHA-512, otherwise the check fails with an
  integrity error; electron-updater verifies the download against it. On signed Windows builds (§7) the
  download requires `publisherName` in `app-update.yml`, and electron-updater verifies the installer's
  publisher. Automatic download and install-on-quit of electron-updater and its web installer are off;
  VERA drives each step. Errors appear as network or integrity failures with "Check again to retry".
- Setting values: Off, Notify (default), Download automatically. "Check now" works also when Off.
- Offline update: run the newer installer by hand. The per-user NSIS installer upgrades in place and
  keeps `<userData>`. For AppImage, replace the file; for deb, use the package manager.
- Release notes come from the feed (`releaseNotes`, text or list, up to 64 KiB) and appear in the
  Updates panel.
- Rollback: install the previous version's installer by hand; the updater never downgrades. Data
  compatibility follows §6.
- `scripts/update-feed.mjs` serves a local feed folder on 127.0.0.1, with range requests and a request
  log, for the upgrade probe (§6).

## 6. Data migrations

| Data | Versioned by | Rule |
|---|---|---|
| `settings.json` | `schemaVersion` (4) | versions 0–3 are migrated on load; the original is first copied to `settings.json.bak-<old version>` (the next free number, never overwritten), then the result is written atomically |
| `credentials.json` | `schemaVersion` (1) | only version 1 exists; no migration code yet |
| `.vera/vera.db` | `meta.schema_version` (3) | only the current schema opens; an empty database receives it. Any other version (older or newer) is refused with INVALID and the files stay untouched (02 §9). Not implemented as of 2026-11-01: checksummed migrations and backups into `.vera/backups/` |
| `.vera/workbench.yaml` | `format` | `1`; no migration code exists. Not implemented as of 2026-11-01: the migration with a backup and a notice that a later bump requires |

- Data with a newer version than the app knows is never modified (L10). Newer settings load as defaults
  in read-only mode: Settings shows a read-only notice and every change is DENIED. A newer
  `credentials.json` is refused with DENIED. A workbench with a newer `format` does not open and the UI
  says it was created by a newer VERA (`WORKBENCH_TOO_NEW`); a database with another schema version
  gives only the plain INVALID message. `tests/e2e/upgrade-safety.spec.ts` checks that these files and
  existing backups stay unchanged.
- Upgrade test: `node scripts/probe-upgrade.mjs <scratch>` (WP-31) and `… --migration-safety` (WP-32)
  build two instrumented versions (0.31.0 → 0.31.1, 0.32.0 → 0.32.1), install the older NSIS or
  AppImage package for real, update it through electron-updater from the local feed and verify
  settings, sessions, recovery of an interrupted turn, turn/approval deferral, SHA-512 refusal, the deb
  ("managed") and portable behaviour. It is not an npm script and runs on a connected host. Not
  implemented as of 2026-11-01: an upgrade proof on release artifacts (08 §5).

## 7. Signed builds

- Signing is requested on Windows when `WIN_CSC_LINK`, `CSC_LINK`, `VERA_CERTIFICATE_SHA1` or
  `VERA_CERTIFICATE_SUBJECT` is set at build time; the build then forces code signing and fails unless
  the executable and the installer have a valid Authenticode signature. Without these, development
  builds are unsigned and still work; unsigned installers trigger a SmartScreen warning.
  `package-report.json` records `requested`, `unsigned` or `not-applicable`, and the `app.info` IPC
  reports `signed`, `unsigned` or `not-applicable`. "Unsigned build" in About is not implemented as of
  2026-11-01: the About metadata deliberately shows no signing or build label.
- Linux AppImage and deb are not signed. Their SHA-256 (like the Windows artifacts') is recorded in
  `package-report.json`; no separate checksum file is produced. The update feed carries SHA-512 for
  every platform (§5).

NOTES:
- Work packages cite this file as `07 §n`.
- Procedures for the release smoke and the Windows Sandbox run: `06_SoftwareDocu/release-package-smoke.md`.

# M4 — Delivery

PURPOSE: VERA installs, starts offline, updates itself and keeps users' data across versions.
STATE: 2026-11-01 — implemented; WP-30…WP-33 and the M4 epic are closed in Gitea. This file is now a
historical record of the plan: the WP text below is unchanged, and
[Implementation notes](#implementation-notes-2026-11-01) record what the code does.
DONE-WHEN: the DONE-WHEN of 07 holds — offline clean-machine install and a scripted loopback session
on the Windows and Ubuntu release artifacts, an update vN → vN+1 from a test feed with sessions and
settings intact, and an egress check with no unexpected connection (08 §5).

## WP-30 Packaging targets

**Goal:** the four packages of 07 §2, self-contained and within budget.
**Depends on:** WP-05, WP-26. **Specs:** 07 §1, §2, §4, §7; 01 §1 (L5).
**Start from:** the `electron-builder.yml` of WP-05; `09_Others/benchpilot-reference/scripts/package.mjs` checks.

Scope:
- `package` builds release-mode NSIS per-user installer and portable zip (with `vera.portable`) for
  Windows x64; AppImage and deb for Linux x64. `package:test` builds separately labelled instrumented
  artifacts for debugging; only release artifacts are delivered (08 §3, §5).
- `asarUnpack` for native modules and models; only the target platform's native binaries.
- The embedding model under `src/models/`.
- Pre-packaging checks: no secrets in the package, path lengths, native files complete.
- Release check: the test switches are compiled out; `VERA_REPLAY_DIR`, `VERA_TEST_DIALOG_PATH` and
  `VERA_NETWORK_AUDIT` have no effect on the release app.
- Record each artifact's SHA-256, so the smoke report names the exact package it tested.
- Size-budget check (≤ 250 MB for the Windows installer) listing the largest contributors.
- Authenticode signing when signing credentials are supplied to the build; unsigned builds show
  "unsigned build" in About.

Done when:
- [ ] All four packages build on their platform and start on a clean machine.
- [ ] Test and release packages are visibly distinct; release payload checks find no test hooks,
  and release launch ignores their environment variables.
- [ ] The size check passes, or fails with its report.

## WP-31 Auto-update

**Goal:** VERA finds, downloads and installs updates without interrupting work.
**Depends on:** WP-30. **Specs:** 07 §3, §5; ADR-0008.

Scope:
- electron-updater on a generic feed whose URL is a build setting; channels `latest` and `beta`.
- Modes Off, Notify (default), Download automatically; "Check now"; release notes in the Updates panel.
- `update.*` IPC and `AppEvent`s; the "Restart to update" banner; installation on restart or quit, never
  while a turn runs or an approval waits.
- Portable builds: read the feed and announce only.
- A local feed server for tests.

Done when:
- [ ] Test: an installed vN finds vN+1 on the local feed, downloads it, and installs on restart.
- [ ] Test: an update is deferred while a turn runs and installs after it ends.
- [ ] Test: the portable build announces the version and never downloads.

## WP-32 Upgrade and migration safety

**Goal:** data survives upgrades, and newer data is never damaged by an older VERA.
**Depends on:** WP-17, WP-30. **Specs:** 07 §6; 02 §9; 03 §6, §8; 01 §1 (L10).

Scope:
- Migration tests for settings, credentials, the workbench database and the workbench format, each from
  a fixture of the previous version.
- Database fixtures include an interrupted turn, a pending approval and a `pending` change; the
  upgraded app recovers them per 03 §6, §8 before a new turn starts.
- The upgrade test: install vN, create sessions and settings, upgrade to vN+1, verify both.
- The newer-version UI: read-only settings banner; "created by a newer VERA" for workbenches.

Done when:
- [ ] Every migration has a previous-version fixture test.
- [ ] The upgrade test passes on Windows and Ubuntu.
- [ ] Opening newer data shows the refusal and leaves the files untouched.
- [ ] The interrupted-session fixture opens after the upgrade with the session `idle` and its
  `pending` change resolved.

## WP-33 Release-package smoke and egress check

**Goal:** prove on the release package itself that VERA works offline and talks only to its allowed
destinations.
**Depends on:** WP-18, WP-28, WP-30, WP-31, WP-32. **Specs:** 08 §3–§5; 01 §8; 07 DONE-WHEN; ADR-0012.
**Start from:** `09_Others/benchpilot-reference/scripts/package-smoke.mjs`, `scripts/smoke.mjs`, `scripts/sandbox/BenchPilot.wsb`.

Scope:
- `smoke:package -- --artifact <path>` takes an already-built release artifact. Offline run: install
  or extract into a path with a space and a non-ASCII character, temporary user data, updates Off;
  open, index and view a copy of the demo workbench.
- Scripted run: a small OpenAI-compatible test server on a loopback port drives a session through the
  normal custom provider — tool calls, a citation, an approval and a restart. No test switches.
- Egress: `strace` over the app's process tree on Ubuntu, automated; Windows Sandbox with networking
  disabled and `pktmon`, by hand (08 §5).
- `scripts/sandbox/VERA.wsb` for the Windows run.

Done when:
- [ ] The offline run passes on Windows and Ubuntu; each of the four delivery formats installs or
  extracts and starts on its target.
- [ ] The scripted session passes on the release artifact, connecting only to its loopback endpoint.
- [ ] On Ubuntu, a test build's deliberate request from the renderer makes the egress check fail.
- [ ] The report names the tested artifacts by SHA-256 and includes the upgrade result of WP-31/32.

## Implementation notes (2026-11-01)

Checked against the working tree on `master` (33e72b8 plus uncommitted changes) by reading code,
scripts and tests; nothing was built or run. Paths are relative to `05_Software/`: `core/` =
`src/libraries/core/src/`, `main/` and `renderer/` = `src/apps/desktop/src/main/`, `…/renderer/`.
Clean-machine, Windows Sandbox and `pktmon` items are manual; no smoke or upgrade report is committed.

- WP-30: implemented with deviation: the four targets, `package`/`package:test`, `asarUnpack`, the
  model, pre-packaging checks, compiled-out test switches and per-artifact SHA-256 exist
  (`scripts/package.mjs`, `scripts/package-checks.mjs:39-142`, `src/apps/desktop/electron-builder.yml:17-50`,
  `tests/tooling/build-mode.test.ts`, `tests/packaging/packaging.test.ts`); there is no size budget,
  only a largest-contributors list, per ADR-0017 (`tests/packaging/packaging.test.ts:213-217`); About
  does not show "unsigned build" — `signing` is computed (`main/app-info.ts:17`) but not displayed
  (`renderer/components/metadata.tsx:6-13`).
- WP-31: implemented as planned (`main/update-backend.ts:55-107`, `main/updates.ts:63-182`,
  `renderer/components/updates.tsx`, `scripts/update-feed.mjs`, `main/updates.test.ts:57-145`); the
  vN → vN+1, deferral and portable checks live in the manual test-build probe
  `scripts/probe-upgrade.mjs`, which has no npm script.
- WP-32: partly implemented: settings v0–v3 → v4, credential and workbench-format fixtures and the
  read-only/newer banners exist (`core/settings/service.test.ts:37-60`, `main/credentials.test.ts:45-91`,
  `core/workbench/service.test.ts:200-217`, `tests/e2e/upgrade-safety.spec.ts:56-146`); missing: any
  workbench-database migration (schema fixed at v3, see M1 WP-07), the "created by a newer VERA"
  message for a newer database — it shows the generic `INVALID` (`tests/e2e/upgrade-safety.spec.ts:126`)
  — and a previous-version database for the interrupted-session fixture, which is seeded into the
  current schema (`core/storage/session-recovery.test.ts:85`, `scripts/upgrade-fixture.mjs`).
- WP-33: implemented with deviation: `smoke:package -- --artifact`, a path with a space and "é",
  updates Off, a loopback custom-provider session with tools, citation, approval and restart, `strace`
  egress on Ubuntu, artifact SHA-256 and `scripts/sandbox/VERA.wsb` exist (`scripts/smoke-package.mjs`,
  `scripts/smoke-runtime.mjs:98,261-267,412`, `scripts/smoke-egress.mjs`); the deliberate-request check
  runs in a separate `data:` probe window on development Electron, not in VERA's renderer in a test
  build (`scripts/smoke-calibration.mjs:47-68`); the report marks the release upgrade result and the
  Windows `pktmon` evidence "pending" (`scripts/smoke-report.mjs:49-61`).

Not in the plan, implemented in this area:
- An app-local Microsoft VC++ runtime beside onnxruntime (`scripts/prepare-windows-runtime.mjs`,
  `src/windows_runtime/`); a packaging-input fingerprint guard and a pdf.js resource integrity check
  (`scripts/package-checks.mjs:8-37`).
- Update hardening: HTTPS feed only (loopback HTTP in test builds), SHA-512, no downgrade, publisher
  check; the deb install only reads update metadata (`scripts/update-config.mjs`,
  `main/update-backend.ts:96-164`).
- ONNX telemetry and Electron dictionary downloads disabled at start (`06_SoftwareDocu/release-package-smoke.md`).
- Release builds keep a `--vera-smoke-provider` switch for `smoke:live` (`main/index.ts:697-718`).
- Test-build probes without npm scripts: `scripts/probe-upgrade.mjs`, `smoke-calibration.mjs`,
  `probe-windows-offline.ps1`, `probe-windows-sandbox.ps1`, `probe-linux-offline.sh`; `smoke:package`
  options `--resume` and `--windows-evidence`.

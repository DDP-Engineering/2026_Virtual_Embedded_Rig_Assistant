# M4 — Delivery

PURPOSE: VERA installs, starts offline, updates itself and keeps users' data across versions.
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

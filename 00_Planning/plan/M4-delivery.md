# M4 — Delivery

PURPOSE: VERA installs, starts offline, updates itself and keeps users' data across versions.
DONE-WHEN: the DONE-WHEN of 07 holds — offline clean-machine install on Windows and Ubuntu, an update
vN → vN+1 from a test feed with sessions and settings intact, and a green egress audit.

## WP-30 Packaging targets

**Goal:** the four packages of 07 §2, self-contained and within budget.
**Depends on:** WP-05, WP-26. **Specs:** 07 §1, §2, §4, §7; 01 §1 (L5).
**Start from:** the `electron-builder.yml` of WP-05; BenchPilot `scripts/package.mjs` checks.

Scope:
- NSIS per-user installer and portable zip (with `vera.portable`) for Windows x64; AppImage and deb for Linux x64.
- `asarUnpack` for native modules and models; only the target platform's native binaries.
- The embedding model under `resources/models/`.
- Pre-packaging checks: no secrets in the package, path lengths, native files complete.
- Size-budget check (≤ 250 MB for the Windows installer) listing the largest contributors.
- Authenticode signing when signing credentials are supplied to the build; unsigned builds show
  "unsigned build" in About.

Done when:
- [ ] All four packages build on their platform and start on a clean machine.
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
**Depends on:** WP-30. **Specs:** 07 §6; 02 §9; 01 §1 (L10).

Scope:
- Migration tests for settings, credentials, the workbench database and the workbench format, each from
  a fixture of the previous version.
- The upgrade test: install vN, create sessions and settings, upgrade to vN+1, verify both.
- The newer-version UI: read-only settings banner; "created by a newer VERA" for workbenches.

Done when:
- [ ] Every migration has a previous-version fixture test.
- [ ] The upgrade test passes on Windows and Ubuntu.
- [ ] Opening newer data shows the refusal and leaves the files untouched.

## WP-33 Offline packaged smoke and egress audit

**Goal:** prove on the packaged app that VERA works offline and talks only to its allowed destinations.
**Depends on:** WP-30. **Specs:** 08 §6; 01 §8; 07 DONE-WHEN.
**Start from:** BenchPilot `scripts/package-smoke.mjs`, `scripts/smoke.mjs`, `scripts/sandbox/BenchPilot.wsb`.

Scope:
- `smoke:package`: extract or install into a path with a space and a non-ASCII character; minimal
  environment; start offline; open a copy of the demo workbench; index it; run a replay session.
- `VERA_NETWORK_AUDIT=1` records every outbound connection; the smoke fails on any destination outside
  the run's allowed list.
- `scripts/sandbox/VERA.wsb` for a manual clean-machine run on Windows.

Done when:
- [ ] `smoke:package` passes on Windows and Ubuntu with an empty allowed list.
- [ ] A deliberate outbound request in a test build makes the smoke fail.

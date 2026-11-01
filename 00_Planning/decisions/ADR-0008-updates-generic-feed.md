# ADR-0008: Updates through electron-updater and a generic feed

Date: 2026-10-09
Status: Accepted; implemented

## Context
VERA needs an update mechanism that works without admin rights, from any static HTTPS location, with
integrity checks, plus a manual path
for offline machines and a portable variant.

## Decision
electron-builder packages VERA (NSIS per-user and zip on Windows, AppImage and deb on Linux).
electron-updater checks a **generic** HTTPS feed fixed at build time, verifies the SHA-512 in the feed
and, when signing is configured, the Windows publisher. Modes: Off, Notify (default), Download
automatically; installation happens on restart and never during a running turn. Portable builds only
check and announce. Details: 07 §5.

## Alternatives considered
- Electron Forge with Squirrel.Windows: an install model less flexible than per-user NSIS.
- An own updater: more code and more security surface for no gain.

## Consequences
- The feed URL is a build setting, not code.
- Without code signing, users see a SmartScreen warning on install.
- deb installs update through the package manager, not inside the app.

## Implementation status (2026-11-01)
- Targets as decided: NSIS per-user without elevation plus zip, AppImage plus deb, electron-builder
  26.17.0 (`src/apps/desktop/electron-builder.yml`).
- electron-updater 6.8.10 with `provider: "generic"`
  (`src/apps/desktop/src/main/update-backend.ts:55-60`). The feed URL is the build input
  `VERA_UPDATE_URL` (`scripts/update-config.mjs`, `electron.vite.config.ts:16,93`); without it
  updates are disabled (`main/index.ts:663-672`).
- Every file must carry SHA-512 (`update-backend.ts:96-101`); the publisher is checked when built
  signed (`update-backend.ts:139`); no auto-download, no install on quit, no downgrade (`:63-68`).
- Modes `off`/`notify`/`download`, `notify` by default (`src/libraries/shared/src/updates.ts:3`,
  `shared/src/settings.ts:138`). Installation waits for session shutdown (`main/updates.ts:150-174`).
  Portable only announces and opens the release page (`updates.ts:177-180`); deb is `managed`
  (`update-backend.ts:161-164`).
- Addition: `latest` and `beta` channels (`update-backend.ts:78-83`).
- Open: code signing is not configured (`signAndEditExecutable: false`).

# ADR-0008: Updates through electron-updater and a generic feed

Date: 2026-10-09
Status: Accepted

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

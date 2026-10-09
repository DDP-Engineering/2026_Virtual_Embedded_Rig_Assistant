# 07 — Packaging, portable mode, updates and migrations

PURPOSE: specify how VERA ships as self-contained packages, how portable mode works, how updates are
found, downloaded and installed, how persisted data survives upgrades, and how signed builds behave.
DONE-WHEN (for M4): on clean Windows and Ubuntu machines without Node, Python or internet access, the
packaged app installs, starts, indexes the demo workbench and runs a replay session; an installed vN
updates itself to vN+1 from a test feed with sessions and settings intact.

## 1. Self-containment rules

- The package carries Electron (Chromium and Node), every npm dependency, native modules prebuilt for
  the target, the embedding model, fonts and pdf.js assets.
- Nothing is installed system-wide besides the app. No admin rights: the Windows installer is per-user.
- First start needs no network. Remote LLM providers need theirs; local endpoints need only localhost.
- Native modules (better-sqlite3, onnxruntime-node) and model files are excluded from the asar archive
  (`asarUnpack`), because native code cannot read inside it.
- Size budget: Windows installer ≤ 250 MB. The packaging script fails above it and lists the largest
  contributors.

## 2. Targets

| Platform | Target | Auto-update | Notes |
|---|---|---|---|
| Windows x64 | NSIS, per-user, `%LOCALAPPDATA%\Programs\VERA` | yes | primary distribution |
| Windows x64 | zip (portable) | check only | unzip and run; data beside the app (§4) |
| Linux x64 | AppImage | yes | primary Linux distribution |
| Linux x64 | deb | no (package manager) | for managed machines |

Built by electron-builder from `apps/desktop/electron-builder.yml`; files named
`VERA-<version>-<os>-<arch>.<ext>`. Only the target platform's native binaries are included.

## 3. Version and channels

- One Semantic Version per build; pre-releases use `-beta.N`.
- Channels `latest` (stable) and `beta`. The Updates setting picks the channel; the beta channel also
  receives stable releases.

## 4. Portable mode

- A file named `vera.portable` beside the executable moves `<userData>` to `<app folder>/data/`
  before `app.whenReady()` (01 §6). The zip ships with that file.
- Copying the folder copies settings and user skills. Credentials encrypted with safeStorage are bound
  to the OS user account and do not decrypt on another machine; VERA then asks for them again.
- Portable builds never download or install updates. They read the feed and show "Version X is
  available" with the release notes and a link, opened after confirmation.

## 5. Update mechanism

```
start-up, then every 6 h, when updates are enabled → electron-updater checkForUpdates() on the generic feed
  → update-available  → AppEvent update.available {version, notes}
                        download after the user agrees, or at once in "Download automatically" mode
  → update-downloaded → banner "Restart to update"
  → install on the user's restart or on the next quit; never while a turn runs or an approval waits
```

- Provider: electron-updater's **generic** feed. The feed URL is a build setting; any static HTTPS
  location works. The feed folder holds `latest.yml` and `beta.yml` (Windows), `latest-linux.yml` and
  `beta-linux.yml` (Linux), the installers and their `.blockmap` files for differential downloads.
- Integrity: electron-updater checks the SHA-512 listed in the feed file. On signed Windows builds
  (§7) it also verifies the installer's publisher.
- Setting values: Off, Notify (default), Download automatically. "Check now" always works.
- Offline update: run the newer installer by hand. The per-user NSIS installer upgrades in place and
  keeps `<userData>`. For AppImage, replace the file.
- Release notes come from the feed (`releaseNotes`) and appear in the Updates panel.
- Rollback: install the previous version's installer by hand; data compatibility follows §6.

## 6. Data migrations

| Data | Versioned by | Rule |
|---|---|---|
| `settings.json` | `schemaVersion` | migrated on load and written back; backup `settings.json.bak-<n>` first |
| `credentials.json` | `schemaVersion` | as settings |
| `.vera/vera.db` | `meta.schema_version`, checksummed migrations | backup into `.vera/backups/` first (02 §9) |
| `workbench.yaml` | `format` | `1` in 1.0; a later bump migrates with a backup and a notice |

- Data with a newer version than the app knows is never modified. Settings fall back to read-only
  defaults with a banner; a workbench does not open and the UI explains that a newer VERA created it (L10).
- WP-32 keeps an upgrade test: install vN, create sessions and settings, upgrade to vN+1, verify both.

## 7. Signed builds

- Windows builds are Authenticode-signed when signing credentials are supplied to the build; unsigned
  development builds still work and show "unsigned build" in About. Unsigned installers trigger a
  SmartScreen warning.
- Linux AppImage and deb ship with SHA-256 checksums.

NOTES:
- Work packages cite this file as `07 §n`.

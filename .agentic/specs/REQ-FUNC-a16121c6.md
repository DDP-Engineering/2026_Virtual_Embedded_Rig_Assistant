# Auto-update contract

Applies to REQ-FUNC-a16121c6, REQ-FUNC-d11a1f5c, REQ-REL-61e5471c,
REQ-PLAT-f905ba1a and REQ-UX-a809496e. Sources: WP31,07 sections3-5 and ADR0008.

## Behavior inventory

| Trigger/state | Response | Positive oracle | Boundary/failure |
|---|---|---|---|
| enabled startup / six hours | generic metadata check | offer or current | Off no scheduled check; offline error |
| Check now / Off | explicit metadata check | available | no automatic artifact request in Off |
| beta | greatest newer beta or stable | stable selected when greater | no downgrade; latest excludes prerelease |
| consent / automatic | verified download | progress then ready | checksum/publisher failure not ready |
| restart / next quit | safety gate then persisted shutdown/install | newer installed executable | active turns/approval preserved |
| portable / deb | announce | notes and confirmed link / manager guidance | no download/install |
| settings/events | strict snapshot and localized controls | live banner/release notes | unsafe feed text treated as text |

## Feed and distribution

VERA_UPDATE_URL is compiled into main and supplied to builder generic publish metadata;
runtime environment and renderer requests cannot change it. Empty means unconfigured
and creates no requests. URLs require HTTPS, no credentials/fragment. Instrumented
local test builds additionally accept HTTP on127.0.0.1/localhost/[::1], fixed at build.
Release builds exclude that allowance.

Latest checks stable metadata only. Beta checks beta and latest, compares valid semver,
and selects the greatest compatible version newer than app.getVersion. No downgrades.
Each channel has an independent electron-updater instance with autoDownload=false
and autoInstallOnAppQuit=false. The selected instance owns download and install.
Signed Windows builds retain builder publisherName; digest verification is updater-owned.
Every candidate file requires a canonical SHA512 digest; SHA256-only metadata is refused
before an offer/download. Managed Linux uses DebUpdater for metadata with artifact actions
gated off; it can check without APPIMAGE.
Windows portable uses the same metadata path with artifact actions prohibited.
Linux APPIMAGE selects AppImage; other Linux distributions are manager-owned.

## IPC/state

update.get({}), update.check({}), update.download({confirmed:true}),
update.restart({}), update.openRelease({confirmed:true,version}) return strict snapshots.
Download requires an available installable offer. OpenRelease requires the current
portable offer/version; the main-derived link stays on the fixed feed origin.
Invalid states produce standard VeraError, never raw updater errors/paths/URLs.

Snapshot: distribution, configured, phase(idle/checking/current/available/downloading/
ready/deferred/error), offer(version,notes,link), progress0..100 or null, errorCode or null.
AppEvents: update.available {version,notes}, update.changed {snapshot}.
Notes are bounded plain text. Settings retain schema4 and unknown extension data;
accepted update enums widen existing values without a destructive migration.

## Ordering and recovery

Checks/downloads serialize; repeated calls reuse pending operations or return BUSY.
Settings changes affect the next check and scheduling; a downloaded offer stays tied
to its verified selected backend and is not replaced by another check.
Unrelated settings notifications preserve the existing six-hour deadline.
Automatic mode downloads after discovery; Off and Notify require explicit consent.
Quit/restart requests during live work are deferred without closing windows, aborting
turns or disposing services. Core activity includes actual active promises and unresolved
approvals independently of UI subscription. After quiescence the host atomically closes
new-session-operation admission, drains owned services/logs, then calls quitAndInstall once.
Failure to drain prevents installation and remains diagnosable. Install cannot run from
updater's implicit quit hook. Portable/deb never enter this path.

## Verification

Focused service/adapter/schema/UI and immediate-consumer tests on Windows/native Ubuntu,
plus exact-artifact installed vN->vN+1 local-feed upgrade and deferred real-turn acceptance,
and packaged portable metadata-only acceptance. Full M4 belongs to coordinator/WP33.
Raw logs/exit codes and SHA256/SHA512 bind evidence to source and package bytes.
WP32 exhaustive data migration fixtures and final clean/offline/CRT/kernel checks remain separate.

# Desktop updates

## Routing

Select for update modes/channels, fixed generic feed, update events, restart banner and
turn/approval installation barriers. Start at main/updates.ts and main/update-backend.ts.
[Native packaging](native-packaging.md) owns assets/identity, [app data](app-data.md)
owns preferences and [sessions](sessions.md) owns actual session work.

## Purpose and boundaries

Main owns scheduling/capabilities and payload lifecycle. ElectronUpdateBackend delegates
metadata, downloads, SHA512/publisher verification and installation to electron-updater.
SessionsHost closes admission atomically at core quiescence. Main drains persistence before
installation. Renderer presents strict snapshots, plain text notes and portable confirmation. The native confirmation closes on disposal and restores its connected opener.

## Public interface

update.get/check/restart use empty strict requests. update.download requires confirmed:true.
update.openRelease requires confirmed:true and the current offer version. Shared updates.ts
defines snapshots; AppEvents update.available/update.changed deliver state.
VERA_UPDATE_URL fixes generic feed at compilation and builder metadata; empty is unconfigured.

## Invariants

- Release feeds require HTTPS without credentials/query/fragment. Instrumented builds also
  permit compile-time loopback HTTP. Runtime settings/environment cannot replace the feed.
- Off disables scheduling; Check now works. Enabled checks run at startup and every6hours.
  Unchanged update preferences preserve the scheduled deadline through other settings writes.
- Latest excludes prereleases; beta chooses the greatest compatible newer stable/beta.
  Downgrade, implicit download and implicit on-quit installation are disabled.
- Notify/Off download after consent; automatic mode downloads installable offers.
- electron-updater verifies SHA512 and the configured Windows publisher; signed Windows
  requires nonempty publisher configuration before download. Candidate metadata requires
  canonical SHA512; SHA256-only feeds are refused.
- Portable/managed reject download/install; portable confirms a current feed-derived link;
  managed Linux checks DebUpdater metadata without APPIMAGE and directs to its package manager.
- Downloaded metadata/backend stay pinned. Deferred requests keep windows and turns alive.
  Core activity includes active promises and pending approvals, independently of UI subscriptions.
- SessionsHost synchronously checks queued operations/core activity and locks new admission.
  Main drains session/workbench/settings/log persistence before explicit quitAndInstall.
- Errors/logs expose bounded categories. Notes are bounded React text and scrubbed at transport.

## Change map

| Change | Start | Focused proof |
|---|---|---|
| modes/safety | main/updates.ts | updates.test.ts |
| channels/integrity | main/update-backend.ts | update-backend.test.ts, actual upgrade |
| admission | core sessions/service.ts, main/sessions.ts/index.ts | approvals.test.ts, sessions.test.ts |
| UI/IPC | shared updates/ipc/events, renderer updates.tsx | shared/UI tests, e2e/updates.spec.ts |
| build/feed | update-config.mjs, package.mjs, update-feed.mjs | tooling/updates.test.ts, packaging.test.ts |

## Key behaviors

REQ-FUNC-a16121c6 discovery; REQ-FUNC-d11a1f5c downloads; REQ-REL-61e5471c safe install;
REQ-PLAT-f905ba1a distribution limits; REQ-UX-a809496e controls/events.
[Exact contract](../specs/REQ-FUNC-a16121c6.md).

## Architecture

```mermaid
flowchart LR
 UI[UpdatesPanel + UpdateBanner] --> IPC[shared update IPC]
 IPC --> U[main Updates]
 U --> B[ElectronUpdateBackend] --> F[generic feed]
 U --> G[SessionsHost admission gate] --> C[SessionService hasActiveWork]
 U --> Q[main persistence drain] --> I[explicit verified quitAndInstall]
 U --> E[AppEvents] --> UI
```

The backend owns download bytes; main owns installation timing.

## Files

Paths relative to05_Software:

- packages/shared/src/{updates,settings,ipc,events}.ts — state/actions/preferences.
- apps/desktop/src/main/{updates,update-backend,index,sessions}.ts — lifecycle/adapters.
- packages/core/src/sessions/service.ts — actual activity.
- renderer components/updates.tsx/settings.tsx, App.tsx, mocks/mockApi.ts/locales — presentation.
- scripts/{update-config,package,update-feed,probe-upgrade}.mjs — build/feed and actual artifact probe.
- shared updates.test.ts, main updates/update-backend.test.ts, core approvals.test.ts,
  renderer updates.test.ts, tooling updates.test.ts and e2e/updates.spec.ts — proof seams.

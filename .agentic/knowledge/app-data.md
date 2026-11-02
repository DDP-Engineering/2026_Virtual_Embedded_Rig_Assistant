# Application data, settings and logging

## Routing

Select for settings.json, installationId, schemaVersion, app.settings.get/update, portable data,
PathProvider/Clock/FileAccess/Logger, atomic writes and secret redaction. Start with
05_Software/src/libraries/core/src/settings/service.ts and src/libraries/shared/src/settings.ts.
Focused tests sit beside the service and main adapters. Native lifecycle is
[desktop-shell](desktop-shell.md); validated transport is [ipc-boundary](ipc-boundary.md).

## Purpose and boundaries

Core owns versioned settings and serial updates through injected host ports. Desktop main supplies
paths, clock, atomic filesystem and JSON logs, loads settings before creating the renderer,
and drains accepted updates/log writes on quit. Shared owns persisted and patch schemas.

## Public interface

- Optional suppressBypassWarning is a non-secret application preference, false by default. The typed patch accepts a boolean and serial settings persistence confirms suppression before the notice closes. It affects presentation only, leaving session/workbench mode and execution authority independent.

- SettingsService.load/get/update/close; get/update return detached {settings}. Settings are
  never read-only.
- Update preferences accept off/notify/download and latest/beta; notify/latest
  are defaults. [Updates](updates.md) owns their scheduling and artifact behavior.
- Main-owned conditional updates may supply an internal predicate evaluated against the latest
  state inside the serialized queue. ChatGPT default selection and logout use it to retain
  concurrently selected models from another provider; IPC patches cannot supply predicates.
- schemaVersion 1 persists a stable installation UUID, language/theme/textScale and current non-secret
  model/provider/update/recent/limit defaults. Optional sessionOrder (session ids per workbench
  id, TASK-c99ca08c) is main-owned: only the internal service patch writes it, the IPC settings
  patch rejects it. Exact contract: [data spec](../specs/REQ-DATA-4a030001.md).
- app.settings.get({}) and app.settings.update(patch) use validated schemas.
  VeraApi exposes getSettings/updateSettings; mockApi uses the same schemas and event behavior.
- PathProvider supplies userData/settings/logs; Clock supplies now/sleep; FileAccess supplies
  read/writeAtomic; Logger supplies log/registerSecret/flush.
- A regular executable-adjacent vera.portable selects adjacent data before readiness and the
  instance lock; otherwise explicit user-data-dir precedes installed userData. Selected override
  directories are created recursively before Electron setPath, whose contract requires existence.
- Logs contain ISO UTC timestamp, debug/info/warn/error level, message and optional data in
  userData/logs/vera-YYYY-MM-DD.log. registerSecret returns idempotent unregistration.

Renderer preferences consume this snapshot through Query and i18next; [renderer foundation](renderer-foundation.md) owns a separate versioned localStorage geometry record. Main applies nativeTheme after loading and confirmed updates.

## Invariants

- Selected directories preserve existing contents; creation errors propagate before setPath with
  the previous host path intact. Installed defaults are resolved without eager creation.
- installationId/schemaVersion are immutable through strict nested patches. The stored schema is
  strict: unknown keys are invalid. webAccess is required. Providers reject credentials. The optional
  `plugins {index?, proxy?}` holds http(s) URLs without user name or password (plugin program installs
  pass them to uv); renderer patches may set it.
- The only valid schemaVersion is 1; it is never incremented during development (root AGENTS.md
  development compatibility policy). There are no migrations, backups or read-only mode.
  [Providers](providers.md) owns strict provider writes, non-secret configurations and credential persistence.
- An unreadable or invalid file, including any other schemaVersion, returns INVALID and stays
  untouched; desktop startup logs app.startup.failed and exits, and the CLI fails the same way.
- Saves use exclusive temporary files, flush/close and same-directory rename. Windows transient
  rename errors receive bounded asynchronous retries; the previous target stays valid on failure.
- Updates serialize, merge against the latest state, and emit after successful changed saves.
  Failed saves preserve memory/events and allow later updates. No-op patches emit nothing.
- Close denies new updates and drains accepted work; logs drain after window close.
- Log content keys/values are scrubbed before serialization and at write time, preserving valid JSON.
  Rotation retains the newest seven daily logs and unrelated files.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Settings schema/validation/update | shared settings.ts; core settings/service.ts | service.test.ts |
| Atomic filesystem/retry | main file-access.ts | file-access.test.ts |
| Portable locations | main data-locations.ts and index.ts | data-locations.test.ts |
| Levels/rotation/redaction | main logger.ts | logger.test.ts |
| Native persistence | main index.ts; IPC contracts | tests/e2e/shell.spec.ts |

## Key behaviors

- REQ-DATA-4a030001 — first-run schemaVersion 1 defaults and stable unique identity.
- REQ-DATA-dfbfac7c — ten typed recents; [workbench](workbench.md) owns lifecycle and missing state.
- REQ-REL-4a030003 — interrupted saves preserve valid settings.
- REQ-FUNC-4a030005 — strict serial partial updates and post-save events.
- REQ-FUNC-4a030006 — validated settings bridge/API/mock.
- REQ-PLAT-4a030007 — portable data selected before readiness.
- REQ-FUNC-4a030008 — structured levels and seven UTC daily logs.
- REQ-SEC-4a030009 — registered-secret content redaction.

## Files

Paths below are relative to 05_Software.

- src/libraries/shared/src/settings.ts — persisted/patch/snapshot schemas, defaults and merge.
- src/libraries/core/src/{index,ports}.ts — exports and host contracts.
- src/libraries/core/src/settings/service.ts and service.test.ts — load/validate/serial state/lifecycle.
- src/libraries/core/vitest.config.ts — Node test project and shared source resolution.
- src/apps/desktop/src/main/{data-locations,file-access,host-ports,logger}.ts — host adapters.
- src/apps/desktop/src/main/{data-locations,file-access,logger}.test.ts — storage/log regression seams.
- src/apps/desktop/src/main/index.ts — handlers, initialization and shutdown drains.
- src/apps/desktop/src/main/app-info.ts — effective portable-mode metadata.
- src/apps/desktop/src/renderer/api/{client,ipc}.ts and mocks/mockApi.ts — settings API/mock parity.
- tests/e2e/shell.spec.ts — real update/restart persistence.

App settings also support optional keyboardShortcuts, a bounded validated map of
command IDs to aliases. An absent command uses shared defaults; [] disables it.
Updates replace the complete override map through existing atomic SettingsService
writes; {} restores every default. Conflicting, duplicate, reserved and unknown
bindings are rejected at the shared IPC/storage boundary.

Web access preferences are non-secret {enabled:true, provider:exa, authentication:anonymous} defaults in the current settings contract. The provider enum is exa/tavily/brave, with Brave requiring key mode. Dedicated web.access.save/removeKey own changes; generic renderer patches reject webAccess. Web credentials stay in CredentialFile under separate web:<provider> slots, never settings.json. See [web access](web-search.md).

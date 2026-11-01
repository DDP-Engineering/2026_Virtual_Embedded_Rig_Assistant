# Application data and settings contract

## Data and API
Schema version 1 holds installationId UUID, language system/en/ro/de, theme system/light/dark,
textScale 0.875/1/1.125/1.25/1.5, defaultModel nullable validated providerId/modelId reference, providers {openai:{model?},custom:[non-secret endpoint configurations]}, updates {mode:"notify",channel:"latest"},
recentWorkbenches up to ten {folder,id,name,lastOpened} entries, limits {maxToolCallsPerTurn:50}. Provider writes use strict providers.save/remove channels and the main credential store; see [provider contract](REQ-SEC-fe4d5c4c.md). The general settings patch excludes providers. defaultModel accepts null or a validated model reference, split at the first slash. Recent folder existence is derived at read time; workbench lifecycle owns order and removal: opening a listed workbench updates it in place, a new one goes first, and a move swaps it with its nearest neighbour of the same pinned state (TASK-c99ca08c). Optional sessionOrder maps a workbench id to the session ids in the order the user arranged; only the internal service patch writes it (the public settings patch rejects it), and main applies it to session.list.
The defaults are system language/theme, scale 1. Mutable patches omit installationId/schemaVersion.
limits.maxToolCallsPerTurn accepts positive safe integers. Strict patches reject unknown/immutable fields, including secret-bearing provider keys. The stored settings schema is strict too: an unknown key makes the file invalid. Nested patches merge, other values replace.
app.settings.get({}) and app.settings.update(patch) return {settings}. Settings are never read-only.
No-op patches return the snapshot without writing or emitting. Successful changed saves emit
settings.changed after persistence. Updates after shutdown reject DENIED; malformed patches reject INVALID.

## Web access preferences

The current schema requires webAccess {enabled:boolean, provider:exa|tavily|brave, authentication:anonymous|api-key}, default enabled anonymous Exa; Brave requires API-key mode. General app.settings.update rejects this authority field; dedicated web.access.save/removeKey serialize persistence alongside credentials. web.access.get returns preferences/keys:{exa,tavily,brave}/secureStorage, each key metadata containing only keyConfigured/storage. Test/remove require provider id; test results identify that provider. Keys use isolated web:<provider> slots with existing security/consent. Removing the active Brave key disables access; other providers select anonymous. No migration or compatibility branch is introduced.

## Persistence and recovery
PathProvider provides userData/settings/logs; Clock supplies Date and asynchronous retry delay.
FileAccess supplies optional UTF-8 read (absence only) and atomic write.
The only valid schemaVersion is 1; the development compatibility policy never increments it.
An unreadable file, invalid JSON, a strict-schema failure or any other schemaVersion rejects INVALID.
The file stays untouched; host startup safely logs app.startup.failed and exits, and the CLI fails
the same way. There are no migrations, backups or read-only mode.
Updates serialize, merge against the latest successful state, and recover the queue after failures.
A failed save changes neither the current state nor events. Shutdown denies new updates and drains
accepted work. First load completes before renderer creation.
Host atomic writes use exclusive UUID temporary files in the same directory, flush and close,
then rename; EPERM/EBUSY/EACCES retries use 20 asynchronous waits of 10 ms, then cleanup.
The previous target is never deleted before rename. Settings objects returned to callers are detached.

## Host paths and logs
A regular vera.portable marker beside process.execPath selects the executable directory/data
before app.whenReady and the instance lock. Portable selection takes priority over explicit
user-data-dir; without a marker an explicit user-data-dir is used for isolated tests.
The selected portable or explicit override directory is created recursively before Electron setPath,
app readiness and the instance lock. Existing contents are preserved; real creation errors propagate
without falling back to installed or override storage. Installed mode uses Electron userData
without an override or eager directory creation. App metadata reports the same marker decision.
Logger writes timestamp (ISO UTC), level (debug/info/warn/error), message and optional data.
UTC dates determine filenames; a serialized asynchronous queue preserves order and retains the
newest seven matching vera-YYYY-MM-DD.log files. Other files remain. flush exposes I/O failures
and the queue recovers for later entries; host error logging cannot crash IPC.
Registered non-empty secrets are scrubbed from log content (raw and JSON-escaped forms),
longest first, covering nested keys/values and repeated occurrences. JSON syntax stays intact. Secret registration returns
an idempotent disposer; the main credential store retains registration through process exit.

## Acceptance
Unit tests cover defaults/UUIDs, invalid and other-version files, interrupted rename/retry exhaustion,
strict patches, concurrent updates and shutdown, portable selection,
log rotation/levels and secret redaction. Native Electron update-to-dark survives restart on both
Windows and Ubuntu; mock settings preserve the same shape and event semantics.
UI and credential/provider configuration are routed through their current component pages. [LLM gateway](REQ-FUNC-05ee1ae5.md) owns model requests; update execution has its own seam.

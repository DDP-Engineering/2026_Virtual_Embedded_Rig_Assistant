# Application data and settings contract

## Data and API
Schema version 2 holds installationId UUID, language system/en/ro/de, theme system/light/dark,
textScale 0.875/1/1.125/1.25/1.5, defaultModel null, providers {}, updates {mode:"notify",channel:"latest"},
recentWorkbenches up to ten {folder,id,name,lastOpened} entries, limits {maxToolCallsPerTurn:50}. The provider/model fields accept their current empty values. Recent folder existence is derived at read time; workbench lifecycle owns order and removal.
The defaults are system language/theme, scale 1. Mutable patches omit installationId/schemaVersion.
limits.maxToolCallsPerTurn accepts positive safe integers. Strict patches reject unknown/immutable fields, including secret-bearing provider keys. Persisted top-level/updates/limits/recent extensions are retained. Nested patches merge, other values replace.
app.settings.get({}) and app.settings.update(patch) return {settings,readOnly}.
No-op patches return the snapshot without writing or emitting. Successful changed saves emit
settings.changed after persistence. Read-only updates reject DENIED; malformed patches reject INVALID.

## Persistence and recovery
PathProvider provides userData/settings/logs; Clock supplies Date and asynchronous retry delay.
FileAccess supplies optional UTF-8 read (absence only), atomic write and exclusive backup.
Version 0 is the same known preference shape with schemaVersion:0 and optional missing fields/id;
missing fields receive defaults and a missing UUID is generated. Version 1 has complete preferences and empty recents. Both migrate to version 2 with original bytes backed up; valid existing UUID and extension values are preserved.
Backup suffix starts at the source version and increments to avoid overwriting previous backups.
Malformed/unsupported old data rejects INVALID, preserving its bytes; host startup safely logs
the category and exits. Higher integer schema versions bypass parsing and expose read-only defaults.
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
an idempotent disposer; future credential integration owns registration lifecycle.

## Acceptance
Unit tests cover defaults/UUIDs, v0 fixture/backup collision, interrupted rename/retry exhaustion,
future schema/read-only, strict patches, concurrent updates and shutdown, portable selection,
log rotation/levels and secret redaction. Native Electron update-to-dark survives restart on both
Windows and Ubuntu; mock settings preserve the same shape and event semantics.
UI controls, credential storage and provider/update execution belong to later work packages.

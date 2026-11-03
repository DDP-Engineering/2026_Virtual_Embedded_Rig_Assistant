# REQ-DATA-f563074f — program run records, the Runs channels and the plugin review

Exact formats behind the Runs tab and the review screen. Shared schemas:
`05_Software/src/libraries/shared/src/plugins.ts` (`programRunSchema`, `pluginReviewSchema`); channels:
`05_Software/src/libraries/shared/src/ipc.ts`.

## Run record — `.vera/runs/<run id>.json`

Written by `ProgramRunner` right before the process is spawned (after the log opens and the pre-spawn check
passes) and rewritten when the run ends, each time through `<id>.json.tmp` and a rename, so a list never reads
half a record. A run whose pre-spawn check fails has a log only and is not listed; a run stopped before its
spawn gets its end record without a process. The last stop check sits after the first record write, right
before the spawn. UTF-8 JSON, one object, at most 512 KiB (64 arguments of up to 4096 characters fit):

| Field | Type | Rule |
|---|---|---|
| `format` | `1` | any other value is skipped as malformed |
| `id` | ULID | equals the file name |
| `sessionId` | string | the session that started the run |
| `plugin` | plugin id, optional | absent for runs started without a label (runner tests) |
| `program` | program name, optional | the declared program the agent named |
| `args` | string[] (≤ 64) | the agent's arguments only: never the resolver's executable, download `prefix` or program `prefix`, so no install path leaks into the list |
| `background` | boolean | |
| `startedAt` | ISO date-time | the clock's time when the record is first written |
| `end` | `exited` \| `stopped` \| `timedOut`, optional | absent while the run has not ended |
| `exitCode` | integer or null, optional | with `end` |
| `error` | string ≤ 256, optional | the system error code of a program that could not start (`ENOENT`) |
| `durationMs` | integer ≥ 0, optional | with `end` |

`end` is `stopped` for Stop, a session stop, a workbench close and app exit; `timedOut` for the
timeout; `exited` otherwise, including a program that could not start (`exitCode` null, `error` set).
A record write that fails never fails the run (best effort, like the log).

Pruning keeps the newest `logsKept` (200) run ids, taken from both `<id>.log` and `<id>.json` names, and
deletes both files of every older id except an unfinished run's.

## Listing — `runs.list {workbenchId}`

Returns `{ runs: ProgramRun[] }`, newest id first, at most 50. A `ProgramRun` is the record without
`format`, plus:

- `state`: `running` when the runner holds the run unfinished, else `end`, else `interrupted`
  (the app ended without finishing the record, for example a crash);
- `log`: `.vera/runs/<id>.log`.

Malformed, oversized or linked records are skipped. A missing `.vera/runs` gives an empty list. Desktop main
redacts known credentials from each run's `args` and `error` before they reach the renderer.
`workbenchId` must be the open workbench (CONFLICT otherwise, as other workbench channels).

## Log — `runs.log {workbenchId, id}`

Returns `{ id, text, truncated, running }`: the last 1 MiB (1 048 576 bytes) of `<id>.log`, decoded as
UTF-8 with replacement characters. A truncated tail starts after its first line break, so it never begins
inside a line (a multibyte character or a secret the redaction would then miss). An id that is
not a ULID, or a log that does not exist or is not a regular file (a link included), is NOT_FOUND. Desktop main
redacts known credentials from `text`, as it does for documents and program approvals.

## Stop — `runs.stop {workbenchId, id}`

Stops the run's process tree (as Stop in `program_stop`) and resolves after it ends, returning `{}`. A
run that is not unfinished in that workbench is NOT_FOUND.

## Review — `plugins.review {path}` and `plugins.install {path, sha256}`

`plugins.review` reads the folder or zip with the install checks (links, sizes, file counts, paths) and
returns `{ path, kind: folder|zip, sha256, issues, manifest?, installed? }`: `sha256` is the integrity
hash `install.json` would record; `manifest` whenever the manifest parses, also with `id` or missing-file
issues; `installed: { version? }` when a plugin folder with the manifest's id is installed. Package-level
failures (missing path NOT_FOUND, link DENIED, limits or not a folder/zip INVALID) are thrown, as install
throws them. Nothing is written.

`plugins.install` requires the reviewed `sha256`; the store recomputes the hash of what it read and
refuses CONFLICT when it differs, before writing anything. The CLI install (`vera plugin install`) has
no review and passes no hash.

## Picker — `plugins.choose {kind: folder|zip}`

Returns `{ path: string | null }`. Instrumented builds return `VERA_TEST_PLUGIN_PATH` when set.

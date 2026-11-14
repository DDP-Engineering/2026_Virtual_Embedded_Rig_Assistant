# REQ-DATA-cb0ccbea - micropython-tool operations, run folders and result documents

Governs REQ-DATA-cb0ccbea, REQ-SEC-bf7892ca, REQ-FUNC-884fed95, REQ-SEC-dee0e930, REQ-REL-2eaebfec,
REQ-FUNC-b829232e, REQ-FUNC-d8afbfa0, REQ-FUNC-9d90c56e, REQ-SEC-d31255bc, REQ-SEC-b493a006, REQ-FUNC-9dc200c3,
REQ-REL-af9aefa3, REQ-REL-1499a74b, REQ-REL-8d35cfbd, REQ-FUNC-ab3282a4, REQ-FUNC-eddae180, REQ-FUNC-2c9933c0,
REQ-FUNC-44f315bd, REQ-SEC-d8ec50bc. The serial-port lease is host behaviour: spec REQ-DATA-f2cbfc23 §2 and §5.

## Behavior

`micropython-tool` is the only program of the official `micropython` plugin: a PEP 723 script with the dependencies
`mpremote==1.29.0`, `pyserial==3.5` and `platformdirs==4.14.0`, which VERA's uv installs at "Install programs" and runs
offline. It uses mpremote's serial transport (`mpremote.transport_serial.SerialTransport`: open, raw REPL, raw-paste
execution, `read_until`) as its engine; every command it sends to the board is a fixed snippet of the helper whose
only variable parts are validated paths, sizes and data written with `repr`. It prints exactly one JSON document on
stdout. Exit codes: 0 status `pass`; 1 `fail`; 2 `blocked` (refused before the board's file system or code was
touched; `errors[]` say why); 3 `incomplete` or `error`.

There is no REPL, `connect`, `exec`, `eval`, `mount`, `mip` or firmware operation; an unknown operation or option is
`blocked` with code `arguments`. No argument is executed as code: `run-file` and `deploy-file` take workbench files.

### Operations

| Operation | Arguments | Board effect | Run folder |
|---|---|---|---|
| `ports` | none | none (enumeration only, no port opened) | no |
| `identify` | device options | interrupts the running program | yes |
| `files` | device options, `[--path /] [--depth 1..16, default 8]` | interrupts | yes |
| `read-file` | device options, `--remote PATH` (at most 1 MiB) | interrupts | yes, `files/<name>` |
| `deploy-file` | device options, `--source FILE --remote PATH [--expect-sha256 HEX \| --expect-absent] [--mkdir] [--startup]` | interrupts, writes the file system | yes |
| `run-file` | device options, `--source FILE [--timeout 1..3500, default 60] [--max-output 1024..1048576, default 65536]` | soft reset, runs code | yes, `output.txt` |
| `capture-output` | device options, `--duration 1..600` | none, or interrupt and soft reset with `--restart` | yes, `output.txt` |
| `reset` | device options, `--mode soft\|hard` | restarts the board | yes |
| `report` | `--run DIR [--run DIR]... [--title TEXT]` | none | yes, `report.md` |

Device options: `--port PORT --identity KEY` (both required), `--restart` (identify, files, read-file, deploy-file,
run-file, capture-output: after the operation, a soft reset from the normal REPL so boot.py and main.py run again),
`--baud 9600..2000000` (default 115200). Every operation with a run folder takes `--run-id ID` (1...64 of
`[A-Za-z0-9._-]`, starting and ending with a letter or digit) and `--results-dir DIR` (default
`arduino-iot-results`); the folder `<results-dir>/<run-id>/` is created exclusively inside the working directory and
never inside `.vera` (`run-exists`, `path`). Workbench paths follow the shared path rules of the electronics plugins
(`workspace.py`, byte-identical copy).

### Ports and identity (REQ-FUNC-884fed95, REQ-SEC-dee0e930)

`ports` lists pyserial's `comports()`: `address`, `identity`, `stable`, `vid`, `pid`, `serialNumber`, `description`,
`manufacturer`, and `bridge` for the USB-to-serial bridges of the arduino-cli plugin's table (FTDI, WCH, Silicon Labs,
Prolific). The identity key is `usb:<vid>:<pid>:<serial number>` (4-digit lower-case hex, serial number as reported,
control characters removed; stable), else `usb:<vid>:<pid>`, else `serial:<address>` (both unstable). No board model
is named; a bridge says nothing about the board behind it.

A device operation lists the ports first: `--port` absent -> `blocked port-missing`; present with another key than
`--identity` -> `blocked identity-mismatch`. The port is compared case-insensitively on Windows, else by its resolved
device path. Only then is the port opened. A port that cannot be opened is `blocked port-open-failed`.

### Session, firmware and application state (REQ-REL-2eaebfec, REQ-FUNC-b829232e)

Opening: `SerialTransport(port, baudrate, timeout=10)` (the read timeout bounds mpremote's blocking reads; the helper
keeps the bytes read since the current exchange began, at most 4 KiB, so a reboot banner mpremote dropped is still seen), then `enter_raw_repl(soft_reset=False)`, which sends Ctrl-C and so
interrupts the running program (`run-file` uses `soft_reset=True`: a clean interpreter; boot.py runs, main.py does
not). A board that does not answer is `error no-repl`. The first snippet reads `sys.implementation`: a name other than
`micropython` or a version below 1.22.0 is `blocked incompatible-firmware` with `firmware {implementation, version}`;
nothing else is sent, `--restart` included. `capture-output` without `--restart` sends nothing and so reads no
firmware (`firmware: null`); with `--restart` and `reset --mode soft` the raw REPL checks the firmware first. At the end the helper leaves the raw REPL (Ctrl-B), sends Ctrl-D when `--restart` asked for it
(confirmed by `soft reboot` within 5 s) and closes the port, so no REPL session stays open; after a lost link it sends Ctrl-C, Ctrl-C, Ctrl-B once and closes.

`application` in the document: `interrupted` (identify, files, read-file, deploy-file; run-file after a timeout),
`stopped` (run-file: after the soft reset main.py did not run), `restarted` (`--restart` confirmed, `reset`),
`unchanged` (capture-output without `--restart`), `unknown` (the board was lost or the restart was not confirmed).
Opening a port can itself restart some boards (ESP32 DTR/RTS auto-reset); mpremote's open avoids it for CP210x
bridges on Windows, nothing else is promised.

`identify` adds `firmware {implementation, version, machine, platform, release, mpy}`, `uniqueId` (hex of
`machine.unique_id()` or null), `memFree`, `filesystem {size, free, blockSize}` of `/` (null when `os.statvfs` fails).

### Remote paths (REQ-SEC-d31255bc, REQ-SEC-b493a006)

A remote path is absolute, at most 255 characters and 16 segments, with no empty, `.` or `..` segment, no backslash
and no control character; else `blocked remote-path`. A `deploy-file` target named `boot.py` or `main.py` (any
folder) needs `--startup`, else `blocked startup-file`. A target ending in `.vera-part` is `remote-path`.

### files and read-file (REQ-FUNC-d8afbfa0, REQ-FUNC-9d90c56e)

`files` walks `--path` on the board to `--depth` levels: `entries [{path, type: file|dir, size}]` in walk order, at most
1000, `omitted` the rest, plus `filesystem`. A missing path is `blocked remote-missing`.

`read-file` stats `--remote` (missing `blocked remote-missing`, a folder `blocked not-a-file`, more than 1 MiB
`blocked too-large`), reads it in 512-byte chunks into `files/<basename>`, and records `file {remote, size, sha256,
deviceSha256, path}`; `deviceSha256` is the board's `hashlib.sha256` result or null without hashlib. A difference is
`fail hash-mismatch`.

### deploy-file (REQ-FUNC-9dc200c3, REQ-REL-af9aefa3, REQ-REL-1499a74b, REQ-REL-8d35cfbd)

Before the port opens: `--source` is a regular workbench file of at most 1 MiB, copied to `files/source` in the run
folder; the copy's SHA-256 is what is written (the approval binds the original's hash; VERA refuses a changed file
with CONFLICT before the helper starts). `--expect-sha256` is 64 hex digits.

On the board, in order:

1. Firmware check; the parent folder exists (else `blocked remote-missing`; with `--mkdir` the missing levels are
   created after step 3, recorded in `created`); a target that is a folder is `blocked not-a-file`.
2. `before {exists, size, sha256}` of the target. `--expect-sha256` differing or `--expect-absent` with an existing
   target -> `blocked conflict`.
3. Space: `os.statvfs` of the deepest existing parent: free bytes below the source size plus one block -> `blocked
   no-space`. Every refusal comes before this point; then missing folders are created and a leftover
   `<target>.vera-part` is removed with warning `stale-part-removed`.
4. `result.json` is written with status `incomplete`, `phase: transfer`, `target: unchanged`; then the copy goes to
   `<target>.vera-part` in 256-byte chunks. A board OSError ENOSPC -> `fail no-space`; the part file is removed.
5. The board hashes the part file; a difference from the copy's hash -> `fail hash-mismatch`, part removed. Without
   hashlib the part file is read back and hashed by the helper (`deviceHash: false`).
6. The target is hashed again; when it differs from `before` -> `fail conflict`, part removed, target untouched.
7. `phase: replace` is written; `os.rename(part, target)`; when it fails with EEXIST and the target exists,
   `os.remove(target)` and rename (`mechanism: remove-then-rename`: between the two calls the target is absent), else
   `mechanism: rename`. Any other rename error is `fail write-failed` with the part removed and the target untouched.
8. The target is hashed: equal -> `pass`, `after {size, sha256}`, `verified: true`; else `fail verify-failed`.

A lost connection at any step (serial error, unanswered command) ends `error` with `disconnected` when the port has left
the port list, `device-reset` when the bytes received since the failing exchange began (or just after it) hold `soft reboot` or a `MicroPython v` banner,
else `no-response`; `application: unknown`; `phase` says how far the deploy came. A killed helper leaves the
`incomplete` result.json of step 4 or 7. No firmware backup or restore is attempted.

### run-file (REQ-FUNC-ab3282a4)

`--source` (at most 256 KiB, valid UTF-8, copied to `files/source`) is sent after a soft reset with raw-paste execution
and is never stored on the board. Output (stdout) is captured until the first end marker, up to `--max-output` bytes
(`outputTruncated` counts the rest), the traceback until the second; both bounded by `--timeout` from the start of
execution. No traceback -> `pass`; a traceback -> `fail` with `traceback` (last 4000 characters) and `exception` (its
last line); the deadline -> Ctrl-C, `incomplete timeout`, `application: interrupted`. `output.txt` holds the output.
Stop kills the helper; it does not stop code already running on the board.

### capture-output and reset (REQ-FUNC-eddae180, REQ-FUNC-2c9933c0)

`capture-output` opens the port without entering the REPL and reads for `--duration` seconds (bytes to `output.txt`,
at most 1 MiB, then counted); with `--restart` it first enters the raw REPL (firmware check), leaves it and sends
Ctrl-D (restart confirmed by `soft reboot`). `reset --mode soft` checks the firmware and restarts the program like
`--restart`; `--mode hard` runs
`import time, machine; time.sleep_ms(100); machine.reset()` without waiting for an answer, closes the port and then
polls the port list every 0.5 s for up to 15 s for the same identity: `port {address, identity, stable, after}`, or
`error port-lost`.

### Documents

Common fields: `format: 1`, `kind: "micropython-tool-result"`, `tool: "micropython-tool 1.0.0"`, `operation`, `runId`,
`startedAt`, `finishedAt`, `status` (`pass`, `fail`, `incomplete`, `blocked`, `error`), `errors [{code, message}]`,
`warnings`, and for device operations `port {address, identity, stable}`, `firmware`, `application`. Run folders hold
`result.json` and `report.md`; `resultPath` names the run folder's result.json (paths in documents are relative to the working directory); stdout repeats the document with long lists cut to 11 000 UTF-16 units
(`omittedFromOutput` counts the cut items). `report` lists for each `--run` its `path, operation, status, port, identity,
firmware version, source and target hashes`; a folder whose result.json is not a micropython-tool result is
`blocked run-invalid`.

## Rationale

mpremote's command line soft-resets on its first command, writes files in place and hashes on the host when the board
has no hashlib; using its transport with fixed snippets lets the helper choose when the program is interrupted, write
through a temporary file and say which hash it compared. MicroPython 1.22 is a modern floor that has raw-paste mode,
`os.statvfs` and `hashlib.sha256` on the common ports.

## Open decisions

- Rename semantics per port and file system are probed per deploy, not tabulated.
- Real boards and native Ubuntu are unverified until a board is connected.

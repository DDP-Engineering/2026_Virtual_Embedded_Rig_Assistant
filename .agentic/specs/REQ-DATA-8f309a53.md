# REQ-DATA-8f309a53 - circuitpython-tool operations, run folders, library sets and result documents

Governs REQ-DATA-8f309a53, REQ-SEC-a6773cd2, REQ-FUNC-1bb6b2bb, REQ-FUNC-3f98ad97, REQ-SEC-b561dad0,
REQ-SEC-8ddddfbb, REQ-REL-e00b3fb2, REQ-FUNC-96d699ae, REQ-FUNC-33fb01a8, REQ-FUNC-e51d0294, REQ-FUNC-37730607,
REQ-REL-33085a32, REQ-REL-ca9500d0, REQ-SEC-15d58156, REQ-SEC-1d4b7f0a, REQ-FUNC-5a6f4aec, REQ-SEC-a59697a3,
REQ-REL-aa8de0c7, REQ-REL-3542e56c, REQ-REL-dff06f35, REQ-REL-b71b5cab, REQ-FUNC-9845bd14, REQ-FUNC-3371a413,
REQ-FUNC-52e12d99, REQ-SEC-1102b4a6. The volume lease is host behaviour: spec REQ-DATA-f2cbfc23 §2.

## Behavior

`circuitpython-tool` is the only program of the official `circuitpython` plugin: a PEP 723 script with the
dependencies `circup==3.1.0` and `pyserial==3.5`, which VERA's uv installs at "Install programs". From circup it uses
the bundle conventions only - `shared.PLATFORMS` / `SUPPORTED_PLATFORMS` (supported majors 9, 10, 11),
`Bundle` naming of release assets, `command_utils.clean_library_name` and `libraries_from_requirements`,
`NOT_MCU_LIBRARIES`, and `shared.extract_metadata` for module versions - never its CLI (which takes the first
CIRCUITPY volume, downloads the latest bundle, offers update-all and copies in place). The board is reached through its
USB drive (CIRCUITPY, a FAT volume the host mounts) and, for console capture, its serial port; nothing is sent to the
REPL as code. It prints exactly one JSON document on stdout. Exit codes: 0 status `pass`; 1 `fail`; 2 `blocked`
(refused before any volume file was written or any byte was sent to a board); 3 `incomplete` or `error`.

There is no REPL, exec, eval, firmware, UF2, install, update or update-all operation; an unknown operation or option is
`blocked` with code `arguments`.

### Operations

| Operation | Arguments | Board effect | Network | Run folder |
|---|---|---|---|---|
| `devices` | none | reads boot_out.txt of mounted CIRCUITPY volumes; no port opened | no | no |
| `identify` | volume options | reads the volume | no | yes |
| `inspect-code` | volume options | reads the volume | no | yes, `files/` |
| `inspect-libraries` | volume options | reads the volume's /lib | no | yes |
| `prepare-libraries` | `--library NAME` (1...32) `--circuitpython 9\|10\|11 --bundle-tag YYYYMMDD` | none | bundle zips unless cached | yes, `libraries/`, `library-set.json` |
| `deploy` | volume options, `[--libraries SET] [--source FILE --target PATH]... [--boot] [--expect-from RESULT] [--capture 1..120 --port PORT]` | writes the volume; the firmware may autoreload code.py | no | yes |
| `capture-output` | `--port PORT --identity KEY --duration 1..600 [--reload]` | none; Ctrl-C and Ctrl-D with `--reload` | no | yes, `console.txt` |
| `report` | `--run DIR [--run DIR]... [--title TEXT]` | none | no | yes, `report.md` |

Volume options: `--volume PATH --identity KEY` (both required). Every operation with a run folder takes `--run-id ID`
(1...64 of `[A-Za-z0-9._-]`, starting and ending with a letter or digit) and `--results-dir DIR` (default
`arduino-iot-results`); the folder `<results-dir>/<run-id>/` is created exclusively inside the working directory and
never inside `.vera` (`run-exists`, `path`). Workbench paths follow the shared path rules of the electronics plugins
(`workspace.py`, byte-identical copy). `--source`, `--libraries` and `--expect-from` name workbench files, so VERA's
approval binds their hashes; `--source` and `--target` pair in order (1...32 pairs, counts must match).

### Volumes, identity and binding (REQ-FUNC-1bb6b2bb, REQ-FUNC-3f98ad97, REQ-SEC-b561dad0, REQ-SEC-8ddddfbb)

Mounted volumes: Windows - drive letters whose volume label is `CIRCUITPY` (GetVolumeInformationW with critical-error
dialogs suppressed), with the volume serial number and the read-only flag (FILE_READ_ONLY_VOLUME); Linux - mounts in
`/proc/self/mounts` whose source is `/dev/disk/by-label/CIRCUITPY*` after links or whose mount point ends in
`CIRCUITPY`, read-only from the `ro` option, serial from `/dev/disk/by-uuid`. Test seam: `VERA_CIRCUITPYTHON_FAKE_BENCH`
names a JSON bench whose `volumes` replace the enumeration; VERA's runner never passes that variable to a program.

boot_out.txt (at most 4 KiB): line 1 `<vendor> CircuitPython <version> on <date>; <board name> with <mcu>`; optional
`Board ID:<id>`; optional `UID:<hex>`. The version's first number is the major.

Identity key of a volume: when the UID equals (ignoring case) the USB serial number of exactly one serial port, that
port's identity key (`usb:<vid>:<pid>:<serial>`, as `ports` of the micropython plugin) and `bound: true`, `port`;
else `circuitpy-uid:<uid lower-case>`; else `volume-serial:<serial>` (`stable: false`); else none. `devices` lists
`volumes[]` {path, label, identity, stable, bound, port, readOnly, firmware {version, major, date, board, boardId,
uid} or null, problem} and `ports[]` {address, identity, stable, vid, pid, serialNumber, description, manufacturer}.

A volume operation lists the volumes first: `--volume` not among them (compared case-insensitively on Windows, a drive
spelled `E:`, `E:\` or `e:/`; resolved paths on Linux) -> `blocked volume-missing`; another key than `--identity` ->
`blocked identity-mismatch`; a volume without any key cannot be named and is `blocked identity-insufficient` for
every operation. A deploy also refuses `ambiguous` (another listed volume has the same key); read operations still run
on such a volume.

### Firmware (REQ-REL-e00b3fb2, REQ-FUNC-96d699ae)

Major 9, 10 or 11 is supported: platform `<major>.x-mpy`, .mpy header `C\x06`. A missing or unparseable boot_out.txt,
or another major, ends every volume operation `blocked incompatible-firmware` with `firmware` as read (or null).
`identify` adds `platform`, `mpyHeader: "C6"`, `filesystem` {size, free, blockSize}, `readOnly`, `port`.

### inspect-code (REQ-FUNC-33fb01a8)

`entries[]` {path, type file|dir, size, sha256} for at most 2000 entries, depth 8, hidden system folders
(`.fseventsd`, `.Trashes`, `System Volume Information`) skipped; `omitted` counts the rest. `sha256` only for files of
at most 1 MiB. `startup` is the first of `/code.txt`, `/code.py`, `/main.txt`, `/main.py` that exists (null when
none); the startup file and `/boot.py` (each at most 1 MiB) are copied to `files/`. `settings.toml` and `secrets.py`
(any letter case) are listed with size and `secret: true`, never read, hashed or copied. A startup file or boot.py
over 1 MiB is not copied (warning `too-large`).

### inspect-libraries (REQ-FUNC-e51d0294)

`modules[]` {name, path, kind mpy|py|package, version (circup `extract_metadata`; null when absent), abi
compatible|incompatible|source, files, incompatibleFiles[]}. A .mpy file is compatible when its first two bytes are
`C\x06`. A package is incompatible when any .mpy file in it is; `source` when it has no .mpy file. Each incompatible
module adds warning `mpy-incompatible`; a volume without /lib adds `no-lib`; the status stays `pass`.

### prepare-libraries and the library set (REQ-FUNC-37730607, REQ-REL-33085a32, REQ-REL-ca9500d0, REQ-SEC-15d58156)

Bundle: `adafruit/Adafruit_CircuitPython_Bundle`, tag = `--bundle-tag` (8 digits), assets
`adafruit-circuitpython-bundle-<platform>-<tag>.zip` for `py` and `<major>.x-mpy`, downloaded from
`https://github.com/adafruit/Adafruit_CircuitPython_Bundle/releases/download/<tag>/` (test seam
`VERA_CIRCUITPYTHON_DOWNLOAD_BASE`, accepted only as `http://127.0.0.1:<port>/`), at most 64 MiB each, 60 s timeout.
Cache: `<home>/bundles/<tag>/<asset>` with `<home>/bundles/<tag>/hashes.json` {asset: sha256}; home =
`$VERA_CIRCUITPYTHON_HOME` or `~/.vera-circuitpython`. A cached zip is used only when its SHA-256 equals the recorded
one (`blocked cache-changed` otherwise); a download is recorded after it completes (written aside, renamed). A failed
download is `error download-failed`.

Resolution: names canonicalized with circup's `clean_library_name` (lower case); `[a-z0-9_]{1,64}` or `blocked
arguments`. A library exists when the .mpy zip holds `<root>/lib/<name>.mpy`, `<name>.py` or a folder `<name>/`. Its
dependencies are the py zip's `<root>/requirements/<name>/requirements.txt` (circup's `libraries_from_requirements`,
names cleaned, `NOT_MCU_LIBRARIES` skipped) and `pyproject.toml` `[circup] circup_dependencies`, transitively. A
requested library not in the bundle -> `blocked unknown-library`; a dependency not in the bundle -> warning
`dependency-not-in-bundle` (host-only packages in `NOT_MCU_LIBRARIES` are skipped silently). Every selected .mpy must
start with `C\x06` (`blocked mpy-incompatible`, files named). An unreadable zip or an oversized member is `error
bundle-invalid`; a set over 16 MiB is `blocked too-large`. Downloads go to a per-process `<asset>.<pid>.part` and are
renamed over the cache file.
Zip members are read by name, never extracted: names with `..`, a drive or a leading `/` are skipped; each file at
most 4 MiB, the set at most 16 MiB.

Output: `libraries/lib/<files>` and `library-set.json`:

```json
{ "format": 1, "kind": "circuitpython-library-set", "circuitpython": 9, "platform": "9.x-mpy",
  "bundle": { "repo": "adafruit/Adafruit_CircuitPython_Bundle", "tag": "20261110",
              "assets": [ { "name": "...-py-20261110.zip", "sha256": "...", "size": 1 } ] },
  "requested": ["adafruit_bme280"],
  "libraries": [ { "name": "adafruit_bme280", "version": "2.6.4", "requiredBy": [],
                   "files": [ { "path": "lib/adafruit_bme280/basic.mpy", "size": 1, "sha256": "..." } ] } ],
  "totalBytes": 1 }
```

### deploy (REQ-FUNC-5a6f4aec, REQ-SEC-1d4b7f0a, REQ-SEC-a59697a3, REQ-REL-aa8de0c7, REQ-REL-3542e56c, REQ-REL-dff06f35, REQ-REL-b71b5cab, REQ-FUNC-3371a413)

Refusals, all before any write (exit 2): arguments; targets (`target-path`: not absolute, longer than 255, more than
8 segments, backslash, control characters, empty/`.`/`..` segments, `/boot_out.txt`, a `.vera-part` name, two pairs with one target;
`startup-file`: `/boot.py` in any case without `--boot`); volume selection; firmware; `--libraries`
(`library-set-invalid`: not a format 1 library set; `incompatible-libraries`: its `circuitpython` differs from the
board's major; `library-set-changed`: a file missing or with another size or SHA-256, or a .mpy without `C\x06`);
`read-only`; `--expect-from` (`conflict`: a target whose current SHA-256 differs from that inspect-code result, or
that exists when the result lists it absent); space (`no-space`: free < sum over targets of max(0, rounded new -
rounded old) + rounded largest new file, rounding up to the block size); `--port` (`port-mismatch` unless it is the
volume's bound port; `--expect-from` of another volume's inspection is `identity-mismatch`). A `--source` over 1 MiB
is `too-large`. When a deployed startup name is not the first of `/code.txt`, `/code.py`, `/main.txt`, `/main.py` that
will exist, the warning `startup-shadowed` names the file that runs instead and `startup` reports it.

Order: library files, then `--source` pairs whose target is not a startup name, then `/boot.py`, then the startup
names (`/code.txt`, `/code.py`, `/main.txt`, `/main.py`). For each target: record the current size and SHA-256 (or
absence), create missing parent folders (`created[]`), remove a stale `<target>.vera-part` (warning
`stale-part-removed`), write `<target>.vera-part` and fsync, read it back (`hash-mismatch` on difference, part removed),
check the target still has the recorded state (`conflict`, part removed), replace (`os.replace`), flush to the device
(`os.sync` where the system has it: a Linux vfat mount otherwise keeps the rename in the page cache), read the target
back (`verify-failed`) and mark it `confirmed`. For `settings.toml` and `secrets.py` the recorded `before` holds
`{exists, size, secret: true}`; their hashes are compared in memory only, and `--expect-from` compares their size. `files[]` {target, source, size, sha256, before {exists, size, sha256}, state
confirmed|unconfirmed|failed}. Before the first write and after each file, result.json is rewritten with `status:
incomplete`, `phase: transfer`, so a killed helper leaves the confirmed list. Failures during the transfer:
ENOSPC -> `fail no-space`; EROFS, EACCES, EPERM or a write-protect error -> `fail read-only`; the volume root gone,
EIO, ENODEV, ENXIO or Windows errors 21, 55, 433, 1167 -> `incomplete disconnected`; any other OSError -> `fail
write-failed`. `application`: `updated` when every file is
confirmed, `partially-updated` when some are, `unchanged` when none, `unknown` when the volume vanished.
`autoreload`: `expected` (the firmware may restart code.py on each write; CircuitPython defers it until writes stop).

With `--capture N --port PORT`: the port is opened before the first write and read until N seconds after the last
write; the console is parsed as in capture-output. A traceback -> `fail exception`; no run started -> `incomplete
no-run-observed`; else the run's state (`finished`, `running`).

### capture-output (REQ-FUNC-9845bd14)

`--port` and `--identity` are checked as in the micropython plugin (`port-missing`, `identity-mismatch`). Without
`--reload` nothing is written to the port and the port is read for `--duration` seconds. With `--reload`: Ctrl-C,
0.5 s, Ctrl-D (CircuitPython restarts code.py), then reading stops when the restarted run has finished or raised, at
the latest after `--duration` seconds.
Parsing of the console text (CR LF normalized): `Auto-reload is on` / `Auto-reload is off` -> `autoreload`
on|off (else unknown); a line `<name>.py output:` or `<name>.txt output:` starts a run; `Code done running.` ends it;
`Traceback (most recent call last):` starts a traceback whose last non-empty line is `exception`. `run` {file, output,
state finished|exception|running, traceback, exception} for the last run, null when none. Status: exception ->
`fail exception`; otherwise `pass` (a running or absent run is reported, not judged). `application` is `restarted`
with `--reload`, else `unchanged`. `console.txt` keeps at most 1 MiB. A port that cannot be opened is `blocked
port-open-failed`; a port that stops answering adds the warning `port-lost`. With autoreload off the firmware prints
no banner after file writes, so a deploy capture then reports `autoreload: unknown`.

### Results (REQ-FUNC-52e12d99)

Header: `format: 1`, `kind: "circuitpython-tool-result"`, `tool: "circuitpython-tool 1.0.0"`, `operation`,
`startedAt`, `finishedAt`, `status`, `errors[]` {code, message}, `warnings[]`, plus `runId`, `resultPath`, `volume`
{path, identity, bound, port} and `firmware` where they apply. report.md mirrors the document. `report` lists each run
{path, runId, operation, status, identity, firmware, confirmed, librarySet}; a folder without a circuitpython-tool
result is `blocked run-invalid`. An unexpected exception ends any operation with `error internal`; its run folder,
if created, gets the same document.

## Rationale

The USB drive is CircuitPython's own deploy path: the firmware reloads code.py after files change, and the REPL is not
needed to write files. circup's CLI is unsuitable as the engine (first volume, latest bundle, update-all, in-place
copy), but its bundle conventions are the reference that the Adafruit bundles follow, so the helper imports them from
the pinned package. A library set prepared into the workbench with per-file hashes makes the network step separate
from the offline deploy, and VERA's approval of the manifest's hash binds every library file through it.

## Open decisions

- A UF2/bootloader workflow is out of scope; web-workflow boards are not supported.
- The volume binding relies on boot_out.txt's UID equalling the USB serial number; proven offline only until a board is
  connected.

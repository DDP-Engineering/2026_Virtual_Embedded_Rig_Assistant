# gdb-debug: operations, profiles and results

Owner requirement: REQ-DATA-d7da2a71. Plugin `05_Software/plugins/gdb-debug/` (LAB-04, #105). The helper scripts are
standard-library Python >= 3.11 (PEP 723, no dependency).

## 1 Programs

| Program | Install | Role |
|---|---|---|
| `gdb-elf` | script `scripts/gdb_elf.py` | offline: `inspect`, `diagnose`; never starts another process |
| `gdb-debug` | script `scripts/gdb_debug.py`, `uses: [arm-none-eabi-gdb, openocd]` | live: `tools`, `snapshot`, `break`, `step`; cleanup `release` |
| `arm-none-eabi-gdb` | find (PATH, Arm/xPack/STM32Cube toolchains; `/usr/bin/gdb-multiarch` on Linux) | driven by `gdb-debug` only; version >= 12 |
| `openocd` | find (PATH, xPack, distribution paths) | driven by `gdb-debug` only; version >= 0.12.0 |

No download is declared: GDB and OpenOCD are the user's installs (a managed download needs a verified archive path,
which no test on this machine established). The helper receives the two paths as `VERA_PROGRAM_ARM_NONE_EABI_GDB` and
`VERA_PROGRAM_OPENOCD`.

## 2 Options

Every option is `--name value` (argparse, abbreviations off; `--name=value` is accepted and matched by the rules as
the same tokens). Values never start with `-`.

- `gdb-elf inspect <elf>`; `gdb-elf diagnose <run-folder> [--elf <elf>]`.
- `gdb-debug tools`.
- `gdb-debug snapshot|break|step --probe <alias> --elf <elf> --firmware-effect none|actuates --on-exit halted|resume
  [--read <variable>]... (at most 8) [--frames <1..64>, default 16] [--results-dir <dir>] [--run-id <id>]`.
  - `break` adds `--at <location>` and `--timeout <1..3000>` seconds.
  - `step` adds `--count <1..100>` and `--instruction`.
- `gdb-debug release --probe <alias>` (the manifest's cleanup).

Accepted syntax (REQ-SEC-a7bab79f): a variable is `name(.member|[index])*` with C identifiers and decimal indexes
(at most 128 characters); a location is a function name, `file:line` (file `[A-Za-z0-9_.-]{1,64}` with an extension,
line 1...999999) or `*0x<hex>` inside a profile flash region. Anything else is refused before any process starts.

## 3 Profiles

`profiles/<id>.json`, selected by the registry entry's `profile`:

```json
{
  "format": 1, "id": "stm32f4-stlink", "status": "unverified",
  "description": "STM32F4 (Cortex-M4F) through an ST-LINK/V2-1 or V3 over SWD",
  "probe": { "vid": "0483", "pids": ["374b", "3748", "374e", "374f", "3752", "3753", "3754"] },
  "openocd": { "interface": "interface/stlink.cfg", "target": "target/stm32f4x.cfg", "speedKhz": 1800 },
  "gdb": { "architecture": "armv7e-m" },
  "core": { "name": "cortex-m4", "partno": "0xc24", "arch": "v7E-M", "faults": "v7m" },
  "memory": { "flash": [{ "start": "0x08000000", "size": 2097152 }], "ram": [{ "start": "0x20000000", "size": 196608 }] },
  "rtos": "none"
}
```

Unknown fields, script names outside `interface/` or `target/` with characters other than `[a-z0-9_./-]`, `..`,
overlapping regions or an unknown fault model refuse the profile. Fault models: `v6m` (no fault status registers),
`v7m` (CFSR/HFSR/MMFAR/BFAR), `v8m` (v7m plus STKOF). Status `unverified` is reported in every result until a real
board run records it verified. The registry probe's VID must equal `probe.vid` and its PID be listed in
`probe.pids`.

## 4 Registry kind `probe` (REQ-DATA-ea470ec1)

`{ "alias": "stlink1", "kind": "probe", "resource": "0483:374b:066DFF485153826687243634", "profile": "stm32f4-stlink",
"note": "..." }`. `resource` = 4 hex VID, 4 hex PID, serial `[A-Za-z0-9._-]{1,64}` (it reaches OpenOCD inside a Tcl command, so no Tcl
metacharacter can appear). Keys
`probe:<vid>:<pid>:<serial>` and `probe:<vid>:<pid>`, lower-cased (two probes of one model therefore exclude each
other; the second key makes a probe-rs `--probe VID:PID`
selector BUSY too).

## 5 A live session

1. Validate options, registry entry (from `$GDB_DEBUG_REGISTRY`, the approved hash `$VERA_REGISTRY_SHA256` when set),
   profile and ELF (`inspect` facts: EM_ARM, ELF32, little endian, M profile, arch not above the profile's) - else
   exit 2, nothing started.
2. Create `embedded-lab-results/<run-id>/` (exclusive; run id ULID-like unless `--run-id`).
3. Start OpenOCD: `-f <interface> -c "adapter serial <serial>" [-c "adapter speed <khz>"] -f <target>
   -c "bindto 127.0.0.1" -c "gdb_port <p>" -c "telnet_port disabled" -c "tcl_port disabled"
   -c "gdb_memory_map enable" -c "gdb_flash_program disable" -c "gdb_breakpoint_override hard"
   -c "[target current] configure -event gdb-attach { halt }"
   -c "[target current] configure -event gdb-detach { catch {<halt|resume>}; echo \"VERA-DETACH [[target current]
   curstate]\" }"`. `<p>` is a free loopback port the helper picked. Ready when the output shows `Listening on port <p>
   for gdb connections` (20 s), else error. stdout and stderr go to `openocd.log`. OpenOCD's working folder is a new
   empty temporary folder outside the workbench (it resolves `-f` scripts there first), removed after the run; a
   missing or unstartable OpenOCD or GDB executable is an `openocd`/`gdb` error with a result.
4. Start GDB: `--interpreter=mi3 -nx -q -iex "set auto-load off" -iex "set debuginfod enabled off"
   -iex "set history save off" -iex "set confirm off" -iex "set pagination off" -iex "set width 0"
   -iex "set height 0" -iex "set mi-async on" -iex "set trust-readonly-sections off" -iex "set may-call-functions off"
   -iex "set remotetimeout 10"` (no expression can call target code, e.g. an overloaded C++ `operator[]`),
   cwd `<run>/gdb/`, stdin/stdout pipes owned by the helper. Every exchange goes to `mi.log`.
5. Fixed MI commands, each with a numeric token and a timeout (10 s; connect 20 s):
   `-gdb-set architecture <arch>`, `-file-exec-and-symbols "<elf>"`, `-interpreter-exec console "mem <start> <end>
   ro"` per profile region (flash and RAM read-only: no fixed command writes target memory) plus the System Control Block fault registers (`0xE000ED00 0xE000ED40
   ro`; `0xE000ED00 0xE000ED04` for `v6m`), `-interpreter-exec console "set mem inaccessible-by-default on"`,
   `-target-select remote 127.0.0.1:<p>`, `-data-read-memory-bytes <addr> <n>`, `-data-list-register-names`,
   `-data-list-register-values --skip-unavailable x`, `-stack-info-depth <frames+1>`, `-stack-list-frames 0
   <frames-1>`, `-stack-list-variables --simple-values`, `-data-evaluate-expression "sizeof(<var>)"` and
   `"&(<var>)"`, `-interpreter-exec console "whatis <var>"`, `-break-insert -h <location>`, `-break-delete <n>`,
   `-exec-continue`, `-exec-interrupt`, `-exec-step`, `-exec-step-instruction`, `-target-detach`, `-gdb-exit`.
   GDB's `compare-sections` is not used: OpenOCD answers its CRC request by running code in the target's RAM work
   area, which would overwrite firmware RAM.
6. Identity: CPUID part number (0xE000ED00 bits 15:4) must equal `core.partno`, else `blocked` (no further read).
7. ELF match: every allocated, non-writable, non-empty PROGBITS or NOTE section (the build id) is read from the target in chunks of at most
   4096 bytes (4 MiB in all) and compared byte for byte: all equal -> `matched`; any difference -> `mismatched` with
   the first differing address; a failed read, a section outside the profile flash or bytes beyond the 4 MiB bound
   -> `unchecked` with `elf.matchNote`; `elf.compared` counts the equal bytes. Symbols, files, lines, locals and
   `--read` values are reported for `matched`, and for `unchecked` with `compared` > 0 together with an `elf-unchecked`
   problem and a limit; `mismatched` and `unchecked` with nothing compared keep addresses only and read no variable
   (REQ-SEC-7e237fa9).
8. Operation (`snapshot`, `break`, `step`), then the snapshot (registers, frames, locals, reads, fault).
9. Exit: `-target-detach` (OpenOCD's gdb-detach event applies the policy), `-gdb-exit`; read `VERA-DETACH <state>`
   from OpenOCD (3 s) -> `target.after`; terminate OpenOCD; kill GDB if still alive. A GDB that hangs is killed first:
   its closed connection still fires the gdb-detach event.

Stop (`$VERA_RUN_CONTROL/stop`) is checked every 100 ms in every wait. A pending command gets one more second to
finish and is abandoned after that (GDB then counts as unresponsive); a running core is interrupted, a snapshot not
yet started is skipped, step 9 runs, status `incomplete`. A stop that arrives while the snapshot's own reads are
already running lets them finish (they only read a halted core), and the result is that completed snapshot. Step 9
and the cleanup commands are not interruptible and are bounded (at most about 28 s in all), so one more second for
a pending command plus step 9 fit the manifest's 30 s grace with little margin; a slower real GDB/OpenOCD would need
a larger grace. `state.json` reports phases `start`, `identified`, `acting`, `cleaning`,
`released`; physical `pending` from connect, `confirmed` when OpenOCD's marker reported the policy's state, else
`unknown`. `release` writes `released`/`unknown` and starts nothing.

## 6 Result document

`<run>/result.json`, also summarised on stdout (at most 11 000 UTF-16 units; `result` names the file):

```text
format 1, kind "gdb-debug-result", tool {name, version}, operation, runId, started, finished,
status pass|incomplete|blocked|error, problems [{code, message}], artifacts [{path, bytes, sha256}] (mi.log, openocd.log),
tools {gdb {path, version, target}, openocd {path, version}},
probe {alias, resource, profile, profileStatus, faults}, server {address "127.0.0.1", port, pid},
elf {path, sha256, bytes, machine, arch, debug, match matched|mismatched|unchecked,
  sections [{name, addr, size, status}], compared (equal bytes), firstDifference?, matchNote?},
firmwareEffect, onExit, target {core, cpuid, partno, detected, state halted|running|unknown|disconnected,
  stopReason?, after halted|running|unknown},
snapshot? {registers {name: hex}, frames [{level, addr, func?, file?, line?}], depthTruncated,
  locals [{name, arg, type, value?}], reads [{name, type, address, size, bytes, value?} | {name, refused} |
  {name, error}], scb? (hex of the 64 bytes at 0xE000ED00; v7m/v8m), fault (section 7, with sites)},
breakpoint? {location, number, address, hit, reason}, steps? [{index, reason, addr, func?, file?, line?}],
events [{t (ms since start, strictly increasing), kind async|stale|untokened|stream|stderr|timeout|unparsed|exit|
  stopped,
  text}], eventsDropped? (beyond 400 events), limits [text], lifecycle {phases, physical}
```

Problem codes include `openocd`, `architecture` (blocked), `identity` (blocked), `elf-mismatch`, `not-hit`,
`unexpected-stop`, `step-timeout`, `stopped`, `timeout`, `disconnected`, `gdb`, `state`, `elf-unchecked`,
`exit-unconfirmed`, `internal` (an unexpected helper error; the exit sequence still ran).
Statuses: `pass` the operation finished as requested; `incomplete` Stop, breakpoint not hit, step cut short, ELF
`mismatched`; `blocked` refused at identity or architecture level before the operation; `error` MI timeout,
disconnect, GDB/OpenOCD failure. An unconfirmed exit adds `exit-unconfirmed` without changing the status. Exit codes:
0 pass, 2 refused before any process (no folder), 3 incomplete/blocked/error.

A refusal prints `{format 1, kind "gdb-debug-refusal" | "gdb-elf-refusal", status "refused", problems}` (exit 2).
`gdb-debug tools` prints `{format 1, kind "gdb-debug-tools", gdb {path, version, target}, openocd {path, version},
profiles [{id, status, description, architecture, gdbSupports}]}`; `release` prints `{format 1, kind
"gdb-debug-release", probe, physical "unknown", note}`.

`gdb-elf inspect` prints `{format 1, kind "elf-inspection", file {path, sha256, bytes}, elf {class, endian, type,
machine, machineCode, entry, flags, float}, arm? {cpuName, arch, profile}, buildId, segments, sections {count,
allocated}, symbols {count, functions, objects}, debug {present, sections, compressed, dwarfVersions, units,
producers, optimization, languages}, limits}`; `diagnose` prints `{format 1, kind "gdb-debug-diagnosis", run, elf
{path, sha256, same}, match, fault, sites [{role, addr, symbol?, offset?}], limits}`; attribution only when the ELF's
SHA-256 equals the recorded one and the recorded match is `matched`, or `unchecked` with a recorded `compared` > 0. Both exit 0, or 2 refused.

## 7 Fault decoding

Exception number = xPSR[8:0]. In an exception (number != 0) the active stack is PSP when EXC_RETURN (LR) bit 2 is set,
else MSP; the frame r0, r1, r2, r3, r12, lr, pc, xpsr is read only when it lies in a RAM region. `v7m`/`v8m`: CFSR
bits MMFSR IACCVIOL 0, DACCVIOL 1, MUNSTKERR 3, MSTKERR 4, MLSPERR 5, MMARVALID 7; BFSR IBUSERR 8, PRECISERR 9,
IMPRECISERR 10, UNSTKERR 11, STKERR 12, LSPERR 13, BFARVALID 15; UFSR UNDEFINSTR 16, INVSTATE 17, INVPC 18, NOCP 19,
STKOF 20 (v8m), UNALIGNED 24, DIVBYZERO 25; HFSR VECTTBL 1, FORCED 30, DEBUGEVT 31. MMFAR/BFAR are reported only with
their VALID bit. `v6m` reports the exception and stacked frame and the limit "ARMv6-M has no fault status registers".
Sites (`pc`, `lr`, `stacked-pc`, `stacked-lr`) are mapped to the ELF's FUNC symbols (Thumb bit cleared) only when the
match is `matched`.

## 8 Limits stated in every live result

RTOS threads are not decoded (`rtos: none` in every profile); peripheral registers are never read; profiles are
`unverified` until a recorded board run; OpenOCD's detach behaviour is confirmed only by its marker.

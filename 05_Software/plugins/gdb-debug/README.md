# GDB debugging (gdb-debug)

Symbol-aware debugging of Cortex-M firmware without a debugger console. `gdb-elf` reads firmware ELF files offline;
`gdb-debug` runs one finite, supervised session per call: OpenOCD from a package profile on 127.0.0.1, GDB in MI mode
driven by the helper through pipes it owns, a fixed command set, the declared exit policy, then both processes are
stopped. Specification: `.agentic/specs/REQ-DATA-d7da2a71.md`.

## Operations

| Call | Effect | Risk |
|---|---|---|
| `gdb-elf inspect <elf>` | SHA-256, class, machine, ARM architecture/profile, entry, segments, symbols, build id, DWARF versions, producers, optimisation level when recorded | safe |
| `gdb-elf diagnose <run> [--elf <elf>]` | recomputes a saved snapshot's fault decoding and symbol attribution; refuses attribution for a different ELF | safe |
| `gdb-debug tools` | GDB and OpenOCD versions, GDB's target, architecture support per profile | safe |
| `gdb-debug snapshot --probe A --elf F --firmware-effect none\|actuates --on-exit halted\|resume [--read VAR]... [--frames N]` | halts the core, checks CPUID and the ELF against flash, reads registers, backtrace, locals, permitted variables, fault registers and the stacked exception frame | device-write; irreversible with `actuates` |
| `gdb-debug break ... --at LOCATION --timeout S` | one hardware breakpoint, run until hit or timeout, snapshot | device-write; irreversible with `actuates` |
| `gdb-debug step ... --count N [--instruction]` | N source lines (or instructions), snapshot | device-write; irreversible with `actuates` |
| `gdb-debug release --probe A` | VERA's cleanup after an interrupted run: touches nothing, reports the state unknown | safe |

`arm-none-eabi-gdb` and `openocd` are blocked for direct calls. Results: `embedded-lab-results/<run-id>/` with
`result.json` (kind `gdb-debug-result`), `mi.log` (every MI exchange) and `openocd.log`.

## Setup

1. Install GDB 12 or newer that knows ARM (Arm GNU Toolchain / xPack `arm-none-eabi-gdb`; `gdb-multiarch` on Ubuntu)
   and OpenOCD 0.12.0 or newer. VERA finds them on PATH and in the usual toolchain folders; no driver, udev rule or
   USB driver is installed for you.
2. Declare the probe in `lab/resources.json` by its USB VID, PID and serial and pick a profile:

   ```json
   {"format": 1, "resources": [
     {"alias": "stlink1", "kind": "probe", "resource": "0483:374b:066DFF485153826687243634", "profile": "stm32f4-stlink"}
   ]}
   ```

   The serial is required: VERA never attaches to "the first probe found". `probe-rs list` shows VID:PID:serial.

Profiles (`profiles/*.json`, all `unverified` until a recorded board run): `stm32f4-stlink` (Cortex-M4F, armv7e-m)
and `stm32g0-stlink` (Cortex-M0+, armv6-m). A profile names OpenOCD's own interface and target scripts, the GDB
architecture, the expected CPUID part number, the fault model and the flash and RAM regions GDB may read.

## What the helper guarantees

- Nothing starts before every value is checked: the probe entry and its profile, the ELF (inside the workbench, ELF32
  little-endian ARM M-profile, an architecture the core can run), `--read` paths (identifiers, `.member`, `[index]`)
  and `--at` locations (function, `file:line`, `*0x<flash address>`). No expression with an assignment, call,
  increment, dereference, register or `$` variable, and no GDB or OpenOCD command, can be written.
- GDB starts with `-nx`, auto-loading, debuginfod, history and calls of target functions off; OpenOCD with telnet and Tcl off, its GDB port on
  127.0.0.1 only, flash programming through GDB off and hardware breakpoints forced. The GDB protocol has no
  authentication; the port lives only for the call.
- GDB may read only (never write) the profile's flash and RAM and the System Control Block fault registers (`mem` regions with
  inaccessible-by-default); a `--read` outside RAM or over 256 bytes is reported refused. Nothing is ever written to
  target memory, flash or option bytes.
- Every MI command carries a token; a late, stale or untokened answer is an event, never another command's result.
  An MI timeout, a lost connection or an unrequested stop leaves the target state `unknown`, `disconnected` or the
  reported stop reason - never a breakpoint hit.
- The ELF is compared with the target's flash byte for byte (read-only sections). A mismatch withholds every symbol,
  source line, variable and fault-site attribution; `unchecked` with an `elf-unchecked` problem means only part of the ELF could be compared: names are partly verified, or withheld when nothing was compared; a foreign CPUID blocks the session
  after identification.
- Exit: OpenOCD's gdb-detach event applies `--on-exit` (halt or resume) and prints the core state it left; that
  state confirms the physical state, else it is `unknown`. Stop, timeout and app close detach the same way; when GDB
  hangs it is killed and the closed connection still fires the event. `release` never reconnects (a reconnect would
  halt the core).

## Limits

- No probe or board was available while this package was built. The session logic was run against a real GDB
  (xPack arm-none-eabi-gdb 16.3.90) connected to a stand-in target that serves the fixture firmware over GDB's remote
  protocol, and against a real OpenOCD (xPack 0.12.0-7) up to the missing probe; OpenOCD's detach handling on a core,
  real fault timing and each profile's board stay to be recorded.
- No RTOS awareness, no peripheral register view, no memory or flash writes, no semihosting, no SWO/ITM.
- One session per call; a halted core stays halted between calls (`--on-exit halted`), which lets a breakpoint or a
  step follow a snapshot.
- Two probes of the same VID:PID are reserved as one model (a probe-rs selector `VID:PID` names either).
- BUSY covers access that names the probe: probe-rs with `--probe`, HIL plans that reserve it and other gdb-debug runs; a probe-rs call without `--probe`, stm32-cubeprog (`sn=`) or another tool reaching the same probe is not detected.
- No standalone continue: the core runs only until a breakpoint (`break`) or after the session (`--on-exit resume`).
- Memory is read only as named variables (`--read`), the stacked frame and the fault registers; there is no read by
  address range.
- clang records the `-O` level in DWARF only with `-grecord-command-line`; GCC records it by default.

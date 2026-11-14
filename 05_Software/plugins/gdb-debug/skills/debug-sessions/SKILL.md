---
name: debug-sessions
description: Diagnose a crashed or misbehaving Cortex-M firmware with symbols - inspect the ELF offline, take a supervised GDB snapshot (registers, backtrace, locals, variables, decoded HardFault/UsageFault/BusFault cause), stop at a breakpoint or step - through a declared probe, without a debugger console. Use when firmware faults, hangs or computes wrong values on a real board.
---

Use `run_program` with programs `gdb-elf` (offline) and `gdb-debug` (live). Never ask for a GDB or
OpenOCD console, scripts, `monitor` commands or memory writes: they are not offered and the direct
programs are blocked.

## 1. Start offline

- `gdb-elf inspect build/app.elf`: confirm ARM, the M profile and architecture (v6-M, v7-M, v7E-M,
  v8-M), symbols and DWARF. No debug information means no source lines or locals; say so.
- Confirm with the user that this ELF is exactly the image on the board. Rebuilt firmware does not
  match, and gdb-debug will withhold every symbol when the flash differs.

## 2. Know the bench

- The probe must be in `lab/resources.json` as `{"alias", "kind": "probe", "resource":
  "VID:PID:SERIAL", "profile"}`. `probe-rs list` shows VID:PID:serial; never guess a serial.
- Profiles: `stm32f4-stlink` (Cortex-M4F), `stm32g0-stlink` (Cortex-M0+). `gdb-debug tools` shows
  the installed GDB/OpenOCD and which profile architectures GDB supports.
- Ask what the firmware drives (relays, motors, heaters, outputs). Then choose:
  - `--firmware-effect actuates` when halting or running it can act on hardware (irreversible
    approval), else `none`.
  - `--on-exit halted` to keep the core stopped for a follow-up call, `resume` to let it run again.
    Never pick `resume` for actuating firmware without the user's explicit agreement.

## 3. Debug in finite steps

- Fault or hang: `gdb-debug snapshot --probe stlink1 --elf build/app.elf --firmware-effect none
  --on-exit halted`. Read `snapshot.fault` (exception, causes, stacked frame, `sites` with symbols),
  `frames` and `locals`. Add `--read counter --read state.mode` for globals in RAM.
- Reach a point: `gdb-debug break ... --at sample --timeout 30` (also `fault.c:42` or
  `*0x08000120`). `breakpoint.hit` false means it was not reached in time or the core stopped for
  another reason (`breakpoint.reason`).
- Walk forward: `gdb-debug step ... --count 3` (`--instruction` for single instructions).
- Re-read a saved run offline: `gdb-elf diagnose embedded-lab-results/<run-id>`.

## 4. Report honestly

- Quote `status`, `elf.match` and `limits`. `mismatched` means the symbols are unknown; never name
  a function from addresses yourself in that case. `unchecked` (problem `elf-unchecked`) means only
  part of the ELF was compared: say the names are not fully verified; with nothing compared they are
  withheld like `mismatched`.
- `lifecycle.physical` `unknown` or `target.after` not matching `--on-exit` means the core's state
  must be checked before anyone relies on it.
- No RTOS thread view, no peripheral registers, no memory writes: say so instead of improvising.

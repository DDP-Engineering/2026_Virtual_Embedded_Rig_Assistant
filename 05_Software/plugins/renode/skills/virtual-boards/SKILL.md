---
name: virtual-boards
description: Run and test a Cortex-M firmware ELF on a virtual board (Renode) before or without hardware - check the ELF against a supported platform profile, boot it headless and read its UART, run the approved test set (boot banner and version, UART receive, timer ticks, button and LED) and report the virtual result next to HIL results. Use when there is no board at hand, to catch firmware logic errors early, or to compare a simulation with a hardware test.
---

Use `run_program` with program `renode-sim`. Never ask for a Renode console, monitor commands, `.resc` scripts,
Robot keywords or Python: they are not offered, and the `renode` program is blocked.

## 1. Pick a profile and check the firmware offline

- `renode-sim profiles` lists the supported virtual boards in one row each. `renode-sim profiles --profile <id>` shows
  the full facts: CPU, memory, boot address, modeled peripherals, stimuli, observables and what the model does not
  support. Only these profiles run. The first one is
  `stm32f4-discovery` (STM32F407, Cortex-M4F, Renode 1.17.0).
- `renode-sim validate --profile stm32f4-discovery --firmware build/app.elf --arch cortex-m4 --boot-address 0x08000000`.
  You must state the architecture and the boot address explicitly; they must match the profile. A refusal names
  the check that failed (`machine`, `arch-mismatch`, `memory-map`, `boot-address`, `vector-table`). Never retry with
  another profile just to make it pass: a firmware for another chip is not validated by a CPU that happens to run it.

## 2. Run it

- `renode-sim run <same options> --virtual-budget 2` boots the firmware and records the console UART with the virtual
  time of each line.
- `renode-sim capture-uart <same options> --until "^version " --virtual-budget 5` stops at the first matching line.
- `renode-sim test <same options> --test-set board-basics [--param version=1.2.3]` runs the approved test set.
  Workbench test sets live in `renode/tests/<id>/testset.json` (data only: uart, count, stimulus, observe and run
  steps on the profile's declared stimuli and observables). Workbench profiles live in `renode/profiles/<id>/`.
  Their `.repl` may use only the engine's own hashed platform files, and their `.resc` may hold only the approved
  machine lines.
- Add `--real-timeout S` (default 300) for the wall-clock budget. `--virtual-budget` and the case budgets are virtual
  seconds.

## 3. Read the result honestly

- `pass`. `fail` means an assertion failed: a wrong line or a wrong LED state. `timeout` with code
  `virtual-timeout` means nothing came within the virtual budget; with `real-timeout`, the wall-clock budget ended and
  the engine was stopped. `incomplete` with `unmodeled-peripheral` means the firmware touched a peripheral the model
  does not implement, so the virtual board is not a valid stand-in for it. `blocked` means nothing ran. With
  `run-path`, the run folder's path holds a space the engine cannot take: use `--results-dir` with a plain path.
- Virtual time is simulated time, not physical timing. A simulation proves nothing about electrical timing, power
  consumption, EMI or the analog circuit. Say so whenever you report a virtual pass.
- `renode-sim report --run embedded-lab-results/<run-id> [--hil embedded-lab-results/<hil-run>]` writes report.md,
  report.html and junit.xml. With `--hil` it adds a requirement table with separate virtual and hardware columns.
  Never present the virtual column as hardware evidence.
- A run stopped from VERA leaves `result.json` in state `running`. `report` turns it into `stopped`/`interrupted`
  with the cases recorded until then.

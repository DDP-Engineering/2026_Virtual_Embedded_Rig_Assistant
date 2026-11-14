---
name: hil-planning
description: Write, check and run a hardware-in-the-loop test plan on a real board - setup and firmware hash, flash/verify, reset, UART commands, waiting for a boot event, instrument captures, lab-validate criteria and cleanup - and read its report. Use when firmware must be tested on the bench with a repeatable, approved scenario.
---

Use `run_program` with program `hil`. VERA itself compiles and runs the plan: never run the
plan's steps one by one with other programs, never write a script that does, and never claim a
result the report does not show.

## 1. Know the bench before writing anything

- Ports: `serial list` (serial-monitor). Probes: `probe-rs list`. Instruments: `lab/resources.json`
  (skill `bench-instruments`). Never guess a port, probe selector, chip name or alias.
- Ask the user what the firmware does to the outside world once it runs (relays, motors, heaters,
  outputs). That is `setup.firmwareEffect`: `device-read` (only LEDs/UART), `device-write`
  (changes stored state of other devices) or `irreversible` (actuates anything physical). When
  unsure, ask; never pick the lower one.
- The plan names the firmware by path and SHA-256. Run `hil check` with any 64-hex placeholder:
  the refusal names the file's actual SHA-256. Confirm with the user that this file is the build
  to test, put its hash in the plan, and rebuild nothing afterwards: a changed image needs a new
  hash and a new approval.

## 2. Write the plan

A JSON file in the workbench, for example `hil/blinky.json` (format 1, every key strict):

```json
{"format": 1, "id": "blinky-smoke", "title": "Blinky smoke test on NUCLEO-F401RE",
 "setup": {"board": "NUCLEO-F401RE", "revision": "C-03",
           "description": "ST-LINK V2-1 on USB, its VCP on COM5 is USART2; scope CH1 on PA5",
           "wiring": ["scope CH1 -> PA5 (LD2)", "scope GND -> CN7 pin 8"],
           "firmwareEffect": "device-read", "effectNote": "Toggles LD2, answers ping on USART2."},
 "firmware": {"path": "build/blinky.elf", "sha256": "<64 hex>", "format": "elf"},
 "budget": {"seconds": 300},
 "steps": [
   {"id": "probe", "phase": "setup", "use": "probe-rs.list", "expect": "0483:374b:066DFF"},
   {"id": "flash", "phase": "setup", "use": "probe-rs.flash", "with": {"probe": "0483:374b:066DFF", "chip": "STM32F401RETx"}},
   {"id": "verify", "phase": "setup", "use": "probe-rs.verify", "with": {"probe": "0483:374b:066DFF", "chip": "STM32F401RETx"}},
   {"id": "boot-log", "use": "serial.capture", "background": true,
    "with": {"port": "COM5", "baud": 115200, "duration": 10, "until": "^READY"}},
   {"id": "reset", "use": "probe-rs.reset", "with": {"probe": "0483:374b:066DFF", "chip": "STM32F401RETx"}},
   {"id": "boot", "use": "await", "with": {"step": "boot-log"}},
   {"id": "ping", "use": "serial.send", "retries": 2,
    "with": {"port": "COM5", "baud": 115200, "text": "ping", "until": "^pong", "duration": 2}},
   {"id": "cap", "use": "scpi.capture", "with": {"instrument": "scope", "channel": "CHAN1"}},
   {"id": "blink", "use": "lab-validate.compare", "with": {"request": {
     "format": 1, "title": "LD2 blink rate", "decisionRule": "simple", "missingData": "incomplete",
     "sources": {"scope": {"importer": "scpi-capture", "step": "cap", "bandwidth": "100 MHz"}},
     "signals": {"led": {"source": "scope", "channel": "CHAN1"}},
     "measurements": [{"id": "f", "signal": "led", "metric": "frequency", "window": {"from": "0 s", "to": "2 s"}}],
     "criteria": [{"id": "C1", "value": "f", "op": "==", "limit": "1 Hz", "tolerance": "5 %"}]}}}],
 "cleanup": [{"id": "halt", "use": "probe-rs.reset", "with": {"probe": "0483:374b:066DFF", "chip": "STM32F401RETx"}}]}
```

- `phase: setup` steps are preconditions: if one does not pass, the plan is `blocked` and nothing
  after it runs. Test steps are the assertions; `expect` adds an output check.
- Step kinds (`use`): `probe-rs.list|flash|verify|reset`, `esptool.identify|flash|verify` (a `bin`
  firmware with `address`), `serial.capture|send`, `scpi.identify|status|read|capture|configure|
  output|close`, `lab-validate.compare` (a validation request whose sources name an earlier
  `scpi.capture` step by `step`, or a workbench file by `path`; skill `validation-planning`) and
  `await` (waits for a `background` step). Nothing else exists: no shell, no script, no loop.
- `retries`/`repeat` only for repeatable kinds (list, verify, capture without reset, send, scpi
  reads and captures). Flash, reset, output and configure run once; never try to hide a failure
  by retrying them.
- A `background` step (a UART capture, a `scpi.output` power hold) owns its port or instrument
  until its `await`; using that resource earlier is refused. Unawaited background steps are
  stopped when the steps end.
- `cleanup` always runs, also after Stop, timeout or the budget. Put everything that makes the
  bench safe there (`scpi.close` of a power supply, a reset that halts the firmware).
- `skip` (a reason) marks a step you leave out on purpose; the plan then cannot pass.

## 3. Check, then run

1. `hil check hil/blinky.json` - no hardware is touched. Show the user the expansion: every
   command, its risk, the firmware effect, the reserved ports/probes/instruments and the cleanup.
   Fix every problem it names (the path points into the plan).
2. `hil run hil/blinky.json` (add `background: true` for long plans, then `program_output`).
   The user approves the whole plan once, at its highest risk; an irreversible plan asks them to
   type the plan id. A changed plan, firmware or registry after the approval is CONFLICT.
3. Read `embedded-lab-results/<run>/result.json` (or `report.md`): status `pass`, `fail` (an
   assertion), `blocked` (a precondition or an absent instrument), `error` (a tool or transport
   failure, or a changed file) or `incomplete` (stopped, budget, skipped or unfinished); the
   physical state `confirmed`, `unchanged` or `unknown`. Quote the failing step, its attempt log
   (`steps/<id>-<rep>-<attempt>.log`) and the lab-validate criteria. `physical: unknown` means the
   bench is not known to be safe: tell the user before anything else.

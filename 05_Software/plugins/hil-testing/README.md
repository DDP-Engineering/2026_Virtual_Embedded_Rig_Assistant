# HIL testing (hil-testing)

Finite hardware-in-the-loop test plans on a real board. A plan is JSON data - setup, board and revision, firmware
path and SHA-256, wiring, the firmware's effect on the outside world, steps, budget and cleanup - never a script.
VERA itself compiles and runs it: every step becomes an operation of another enabled plugin (probe-rs, esp32-esptool,
serial-monitor, scpi-instruments, lab-validation), classified by that plugin's own risk rules, so this plugin never
adds a second way to flash, open a port or drive an instrument. Specification: `.agentic/specs/REQ-DATA-5f714098.md`.

## Operations

| Call | Effect | Risk |
|---|---|---|
| `hil check <plan>` | compiles the plan: operations, risks, bound files, reserved ports/probes/instruments; nothing starts | safe |
| `hil run <plan>` | one approval for the whole plan, then the run; `background: true` allowed | the highest operation risk and the firmware effect when the plan flashes or resets; at least device-read |
| `hil report --run DIR` | report.html, report.md, junit.xml of a finished run (VERA runs it after every plan) | safe |

Step kinds: `probe-rs.list|flash|verify|reset`, `esptool.identify|flash|verify`, `serial.capture|send`,
`scpi.identify|status|read|capture|configure|output|close`, `lab-validate.compare`, `await`. The adapters live in VERA
core (`core/src/plugins/hil/adapters.ts`) as registrations; later work adds kinds there, never a second executor.
GDB, Zephyr, PlatformIO and Twister are not adapters of this release.

## What VERA guarantees

- Refusal before any process or approval: unknown keys or kinds, parameters out of bounds or starting with `-`,
  `retries`/`repeat` on flash, reset, output or configure, an alias missing from `lab/resources.json`, a firmware whose
  hash differs from the plan, a step that would use a port, probe or instrument a background step still uses.
- One approval binds the plan file, the firmware, every file an operation names, the registry and every plugin; a
  change before the start is CONFLICT, a change during the run stops before the next operation (`changed`).
- The plan run holds the probe, the serial ports and the instruments (lease folder shared by the desktop app and the
  CLI); its own operations use them one after another, everyone else gets BUSY.
- Stop, timeout, the budget, session stop and app exit stop the running operation (with the instrument's grace and
  cleanup), then every cleanup step runs once; the physical state is `unknown` when a cleanup step fails, an operation
  reported unknown, or irreversible firmware was started without a passing cleanup.
- `embedded-lab-results/<run-id>/`: `plan.json`, `result.json` (kind `hil-test-result`, states prepared ->
  awaiting-approval -> running -> cleaning-up -> done, status pass/fail/blocked/error/incomplete), `events.jsonl`
  (monotonic `t` in ms and host time), `steps/` (each attempt's output, the scpi and lab-validate run folders, the
  generated validation requests) and the report files.

## Limits

- Steps run one at a time, except background UART captures and power holds; a boot log printed before a capture
  starts is lost (start the capture in the background before the reset).
- VERA cannot lock out programs outside VERA; serial-monitor runs in another VERA process are not leased.
- A probe is reserved by its selector text: a run of the same VERA process naming it with `--probe` gets BUSY, but
  `0483:374b` and `0483:374b:SERIAL` are not recognised as one probe, and another VERA process is refused only through
  a plan of its own.
- Events inside a step are known only within that step's time window; instrument clocks are not synchronized with the
  host clock.

## Support matrix

| Platform | Evidence |
|---|---|
| Windows x64 | offline tests and real helper processes (fake pyserial, fake PyVISA, probe-rs stand-in), 2026-11-14 - no board |
| Ubuntu x64 (native) | not run yet |
| Real board | not run yet (no board or probe attached to the development machine) |

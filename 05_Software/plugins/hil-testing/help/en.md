# HIL testing

HIL testing runs finite hardware-in-the-loop test plans on a real board. A plan is a JSON file, never a script: setup, firmware and its SHA-256, wiring, the firmware's effect on the outside world, steps, a time budget and cleanup. VERA compiles every step into an operation of another enabled plugin, asks for one approval for the whole plan, reserves the probe, serial ports and instruments, and runs the steps. The cleanup always runs, also after Stop or a timeout. Results and reports (JSON, JUnit, HTML, Markdown) go to `embedded-lab-results/<run-id>/` in the workbench.

## What it needs

- **hil**: a script in the plugin, installed automatically by **Install dependencies** on the plugin page.
- The plugins whose operations the plan uses, enabled in the workbench: probe-rs, esp32-esptool, serial-monitor, scpi-instruments and lab-validation.
- The board with its probe or serial port, and instruments declared in `lab/resources.json` when the plan names them by alias.
- The firmware file to test; the plan records its SHA-256.

## How to use it

- "Write a HIL smoke test for the blinky build on the NUCLEO-F401RE: flash, reset, wait for READY, send ping and check the LED blink rate with the scope." (skill `hil-planning`)
- "Check the plan hil/blinky.json and show me every operation and its risk."
- "Run hil/blinky.json in the background."
- "Why did the plan fail? Show the failing step and its log."

Before writing a plan the agent asks you what the firmware drives (relays, motors, heaters, outputs) and never picks a lower effect when unsure. `hil check` touches no hardware and shows the full expansion for your review.

## Risk and approvals

- Safe, runs without asking: `hil check` and `hil report`.
- `hil run`: one approval for the whole plan, at the highest risk of its operations as the other plugins rate them, and of the firmware's declared effect when the plan flashes or resets; never lower than device-read. An irreversible plan asks you to type the plan id. A plan, firmware or registry changed after approval is refused.
- Flash, reset, output and configure steps run once; they cannot be retried or repeated.

If a run ends with the physical state `unknown`, the bench is not known to be safe; the agent tells you first.

## Limits

- Windows x64 and Linux x64. Tested on Windows with stand-ins only; native Ubuntu and a real board are not yet run.
- Steps run one at a time, except background UART captures and power holds. Start a boot-log capture in the background before the reset, or the log is lost.
- VERA cannot lock out programs outside VERA.
- GDB, Zephyr, PlatformIO and Twister steps are not available.

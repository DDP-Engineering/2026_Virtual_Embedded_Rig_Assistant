# probe-rs

This plugin lets the agent work with a debug probe connected to your computer through probe-rs 0.32.0. It identifies probes and targets, flashes, verifies and restarts the exact build ELF in one run, backs up the firmware that is on the board, reads memory and peripheral registers, follows RTT logs in the background, catches a HardFault or an unexpected reset with its stack trace, runs on-target tests and profiles the running firmware, on ARM, RISC-V and supported Xtensa targets (for example `esp32`, `esp32s3`, `esp32c3`).

## What it needs

- **probe-rs 0.32.0.** VERA first looks on PATH and in `~/.cargo/bin`; if it finds nothing, **Install dependencies** downloads the pinned portable release into VERA's program folder. A found copy of another version is reported as unavailable: correct PATH or that installation first.
- **A debug probe and target board**, with drivers and device access you set up yourself. On Linux this is the probe-rs udev rule and `plugdev` membership. On Windows, ST-Link uses ST's STSW-LINK009 driver, J-Link and FTDI need WinUSB, and CMSIS-DAP normally needs nothing extra. VERA never installs drivers or rules. Setup guide: https://probe.rs/docs/getting-started/probe-setup/
- No other plugins and no configuration.

## How to use it

The agent uses the `probe-rs-connect`, `probe-rs-flash`, `probe-rs-rtt`, `probe-rs-inspect`, `probe-rs-test` and `probe-rs-profile` skills. It always names the probe and chip it observed and never guesses them from an example.

- "List the connected debug probes and identify the target on the ST-Link."
- "Flash build/app.elf to the STM32, verify it and reset the target."
- "Back up the firmware that is on the board, then flash build/app.elf."
- "Attach to the target and follow the RTT log until it prints 'ready', then stop."
- "Read the RCC_CR register of the STM32F4 and decode its fields."
- "The board crashes after a few minutes: watch it and show me where in the code."
- "Run the on-target tests in build/tests.elf and tell me which failed."
- "Profile the firmware for 10 seconds and list the functions that take the most time."

## Risk and approvals

- **Safe** (runs without asking): help, version, the target list, the description of a chip and listing probes; these do not connect to a target.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): info, read, verify, attach, profile and trace may halt the target briefly; reset restarts it without changing the firmware.
- **Device write** (asks in **Ask** and **Auto-edit**): download, run, erase and benchmark overwrite flash or RAM; a profile with `--flash` writes the firmware first; itm configures the trace hardware. `write` changes memory words: a write to a flash controller or option register can lock the chip, and a write to a GPIO register drives pins. The approval binds the ELF's hash.
- **Blocked**: interactive debugging, GDB and DAP servers, shell completion and remote probes (`--host`).

## Limits

- Windows x64, Linux x64 and Linux ARM64.
- Flashing, verifying, erasing, reading memory and profiling may run for 30 minutes, tests and logs for one hour, every other command for 2 minutes.
- A log capture stops the target on a HardFault and on a reset, to show where it happened; the agent can turn that off to log across resets.
- RTT input is not supported; firmware with RTT down channels is not yet checked on a bench.
- The plugin has not yet been checked with a real probe and board.

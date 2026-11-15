# probe-rs

This plugin lets the agent work with a debug probe connected to your computer through probe-rs 0.32.0. It identifies probes and targets, flashes and verifies the exact build ELF, resets the target, reads memory and peripheral registers, and streams RTT logs in the background on ARM, RISC-V and supported Xtensa targets (for example `esp32`, `esp32s3`, `esp32c3`).

## What it needs

- **probe-rs 0.32.0.** VERA first looks on PATH and in `~/.cargo/bin`; if it finds nothing, **Install dependencies** downloads the pinned portable release into VERA's program folder. A found copy of another version is reported as unavailable: correct PATH or that installation first.
- **A debug probe and target board**, with drivers and device access you set up yourself. On Linux this is the probe-rs udev rule and `plugdev` membership. On Windows, ST-Link uses ST's STSW-LINK009 driver, J-Link and FTDI need WinUSB, and CMSIS-DAP normally needs nothing extra. VERA never installs drivers or rules. Setup guide: https://probe.rs/docs/getting-started/probe-setup/
- No other plugins and no configuration.

## How to use it

The agent uses the `probe-rs-connect`, `probe-rs-flash`, `probe-rs-rtt` and `probe-rs-inspect` skills. It always names the probe and chip it observed and never guesses them from an example.

- "List the connected debug probes and identify the target on the ST-Link."
- "Flash build/app.elf to the STM32, verify it and reset the target."
- "Attach to the target and follow the RTT log until it prints 'ready', then stop."
- "Read the RCC_CR register of the STM32F4 and decode its fields."
- "The firmware hit a HardFault: map the stacked PC and LR to source lines."

## Risk and approvals

- **Safe** (runs without asking): help, version, the target list and listing probes; these do not connect to a target.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): info, read, verify, attach, profile and trace may halt the target briefly; reset restarts it without changing the firmware.
- **Device write** (asks in **Ask** and **Auto-edit**): download, run, erase and benchmark overwrite flash or RAM; itm configures the trace hardware. The approval binds the ELF's hash.
- **Irreversible** (asks, and you type the confirmation word `write`): writing arbitrary memory, because a write to a flash controller or option register can enable permanent read protection, and a write to a GPIO register drives pins. In **Bypass — full access** this runs without asking.
- **Blocked**: interactive debugging, GDB and DAP servers, shell completion and remote probes (`--host`).

## Limits

- Windows x64, Linux x64 and Linux ARM64.
- RTT input is not supported; firmware with RTT down channels is not yet checked on a bench.
- The plugin has not yet been checked with a real probe and board.

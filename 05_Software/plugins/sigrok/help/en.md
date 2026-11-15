# sigrok (DDP fork)

This plugin lets the agent capture and decode digital and analog signals and read or configure bench instruments through sigrok-cli. Captures are bounded and saved as srzip files in the workbench; saved captures can be decoded offline with UART, I2C, SPI, CAN, 1-Wire and, in the DDP fork, an Ethernet decoder stack. The DDP fork of sigrok adds drivers for the ATK-DL16 logic analyzer and the Hantek DSO-3062L mixed-signal oscilloscope.

## What it needs

- **sigrok-cli.** **Install dependencies** offers a SHA-256-pinned package of the DDP fork for the current platform; it takes precedence over a local copy. Until it is installed, VERA uses a sigrok-cli on PATH (on Linux also `/usr/bin/sigrok-cli`). An upstream sigrok-cli can decode protocols and use the devices it lists, but lacks the fork's drivers.
- **A supported instrument** and USB access, which you set up yourself. On Linux install the fork's and libsigrok's udev rules, join `plugdev` and log in again. On Windows bind WinUSB with Zadig to the Hantek, ATK-DL16 or fx2lafw-class device when required.
- No other plugins and no configuration.

## How to use it

The agent uses the `sigrok-capture`, `sigrok-decode`, `sigrok-instruments`, `atk-dl16` and `hantek-dso3062l` skills. It checks which drivers the installed sigrok-cli has and never guesses a connection.

- "Capture 100 000 samples of D0 to D2 on the ATK-DL16 at 10 MHz into captures/logic.sr."
- "Trigger on a rising edge of D8 and capture one buffer."
- "Take a single frame from the Hantek DSO-3062L."
- "Decode the UART on D0 at 115200 baud in captures/logic.sr."
- "Read the voltage of the Korad supply on COM3."

## Risk and approvals

- **Safe** (runs without asking): help, version, the supported lists and decoding a saved capture.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): scanning, listing serial ports, showing a driver, reading values and bounded captures with an explicit driver.
- **Device write** (asks in **Ask** and **Auto-edit**): changing instrument settings, including a read that applies settings first.
- **Irreversible** (asks, and you type the confirmation word shown on the card): changing settings of power supplies, electronic loads, signal generators, relays and similar output-driving instruments, any setting without an explicit driver, and the ATK-DL16's PWM generator output. In **Bypass — full access** these run without asking.

## Limits

- Windows x64, Linux x64 and Linux ARM64.
- The pinned packages point to a private release that is not yet published; until it is, use a sigrok-cli on PATH.
- A local version string does not prove the fork's drivers are present; the agent checks for `atk-dl16` and `hantek-dso3062l` itself.
- A trigger that never fires can give zero samples and no file.

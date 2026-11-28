---
name: probe-rs-connect
description: How to list debug probes, identify the target chip and choose the --probe and --chip values every probe-rs run needs. Use before any probe-rs run on hardware, and when a probe is missing, inaccessible or cannot connect.
---
# probe-rs-connect

The program `probe-rs` (plugin probe-rs, version 0.32.0) reaches a board through a debug probe: ST-Link,
J-Link, CMSIS-DAP, FTDI or the USB-JTAG of an ESP32. Run it only through `run_program`.

| Command | Risk | Use |
|---|---|---|
| `probe-rs list` | safe | every connected probe with its `VID:PID:Serial`; `(inaccessible)` marks one the system will not open |
| `probe-rs chip info <name>` | safe | cores and memory map (RAM and NVM ranges) of a chip name; no hardware |
| `probe-rs chip list` | safe | every supported chip; thousands of lines, so `grep` the run log for a part of the name |
| `probe-rs info --probe S --non-interactive` | device-read | connects and prints `Detected chip: <name>` |

## Procedure

1. Run `probe-rs list`. `No debug probes were found.` (exit 0) means nothing is connected: ask the user to
   plug the probe in. Never take a selector, serial number or chip from an example.
2. The selector `S` is the listed `VID:PID:Serial`, written in full (an FTDI probe may need
   `VID:PID-INTERFACE`). Name it in every run: while a background run holds a probe, VERA refuses
   another run naming it, in full or by its `VID:PID` alone (BUSY). A run with no `--probe` is not
   recognised and fails on the USB device instead.
3. Run `probe-rs info --probe S --non-interactive`. It detects the chip itself and ignores `--chip`.
   A failed `info` does not prove broken hardware: check that the board is powered and wired, then try
   `--protocol swd` or `--protocol jtag`, a lower `--speed <kHz>`, and, only when the reset line is
   wired, `--connect-under-reset` (it resets the target).
4. The chip name `C` comes from the project (`.cargo/config.toml` runner, `Embed.toml`, board
   documentation) or from `info`, in the registry's spelling: `STM32F401RETx`, `nRF52840_xxAA`,
   `RP2040`, `esp32c3`, `esp32s3`. Confirm a candidate with `probe-rs chip info C`.
5. Every later command on hardware takes `--probe S --chip C --non-interactive`.
6. A `.probe-rs.toml` in the working folder or the home folder may hold a preset named `default`; its
   arguments are added to every run. Read it when a run behaves as if it had other arguments. Arguments
   on the command line win.

## When the probe is not there

VERA installs no drivers and no system rules and never elevates: show the remedy to the user.

- Linux, probe `(inaccessible)` or a permission error: the probe-rs udev rule is missing. The user
  installs `69-probe-rs.rules` in `/etc/udev/rules.d/`, reloads udev and joins the `plugdev` group, as
  https://probe.rs/docs/getting-started/probe-setup/ describes, then replugs the probe.
- Windows ST-Link: ST's driver `STSW-LINK009`. J-Link: switch it to WinUSB with J-Link Configurator or
  Zadig. FTDI: WinUSB with Zadig (the serial-port driver does not work). CMSIS-DAP and ESP32 USB-JTAG
  normally need nothing; Zadig on the debug interface only, so the serial port keeps working.
- `debug`, `gdb`, `dap-server`, `serve`, `complete` and `--host` are blocked. For breakpoints and stepping use the
  gdb-debug plugin.

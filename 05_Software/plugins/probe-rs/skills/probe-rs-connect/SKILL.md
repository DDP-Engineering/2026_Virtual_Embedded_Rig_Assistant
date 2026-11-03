---
name: probe-rs-connect
description: Identify a local debug probe and target, select the observed chip/probe explicitly, and diagnose driver, wiring and permission problems for probe-rs.
---

Use `run_program` with program `probe-rs` and an argument array. The user installs/enables this plugin
and explicitly chooses Install programs if needed. VERA searches PATH then ~/.cargo/bin, accepts only
0.32.0, and offers the pinned portable download if no executable is found. An incompatible found
version is unavailable; the user must correct PATH or that installation before trying again.

1. Run `probe-rs list`. Report the observed VID:PID:serial and accessibility. If there are no probes,
   stop and ask the user to connect one. Never infer a board, probe serial or COM port from an example.
2. Choose the exact observed `--probe VID:PID:Serial` (FTDI may need VID:PID-INTERFACE). Run
   `probe-rs info --probe <selector> --non-interactive`. Info may auto-detect the chip in 0.32.0;
   a failed info result alone does not establish broken hardware. Confirm markings/project target
   against the result. Do not flash until the target and build agree.
3. Use `probe-rs chip list` only when necessary (large output). Prefer `probe-rs chip info <name>`
   for a known candidate. Use names returned by the registry: for example `esp32c3` and `esp32s3`,
   not display names with invented hyphens. Confirm ambiguous STM32 variants against the board.
4. Pass explicit `--probe`, `--chip` and `--non-interactive` to subsequent device commands. Where
   necessary use the documented `--protocol swd|jtag` and `--speed <kHz>` appropriate to the wiring.
   `--connect-under-reset` is a recovery step only with the user's known reset wiring; it resets/halts
   the target. Never add `--allow-erase-all` as a connection fix. Avoid configuration presets: keep
   target-affecting options visible in the approved argument array.

User-managed access remedies (VERA never installs drivers, system rules or elevates privileges):

- Linux: follow https://probe.rs/docs/getting-started/probe-setup/ for `69-probe-rs.rules` in
  `/etc/udev/rules.d/`, rule reload/trigger and `plugdev` membership, then reconnect/re-login as directed.
  Report inaccessible probes as a permissions issue. The user/admin performs system changes.
- Windows ST-Link: official ST driver `STSW-LINK009`. J-Link: switch to WinUSB in J-Link Configurator
  or Zadig. FTDI: WinUSB with Zadig; VCP/D2xx does not provide the required interface. CMSIS-DAP:
  normally no additional driver. ESP32 USB-JTAG normally needs none; the user can use Zadig if
  DeviceInterfaceGUIDs is missing. Choose only the correct debug interface, preserving serial access.

Safe list/chip/help do not connect to the target. Info and other device-read operations may halt it;
reset resets it. `debug`, `gdb`, `dap-server`, `serve`, `complete` and every `--host` are blocked.

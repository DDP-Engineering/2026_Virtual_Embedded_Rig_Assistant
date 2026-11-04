# sigrok (DDP fork)

Enable **Signal capture and bench instruments** in the Firmware analysis pack.
The plugin exposes `sigrok-cli` through VERA's program tools. The installed
pinned fork takes precedence. Until it is installed, VERA searches PATH and
on Linux also tries `/usr/bin/sigrok-cli`, the Raspberry Pi deb's entry point.
A local version string alone does not establish fork capabilities. Check for
`atk-dl16` and `hantek-dso3062l` in the full `-L` log in Runs, or use
`--driver <id> --show` to check one driver. A truncated result is inconclusive.
An upstream CLI can decode protocols and use devices it lists.

**Install programs** offers a SHA-256-pinned package for the current platform,
even while a local executable is available. Windows uses the zip's portable CLI and its bundled
Python. The Linux AppImages launch in CLI mode with
`--appimage-extract-and-run --cli`, which avoids a FUSE dependency. The download
URLs describe the proposed private LAN release. They require publication and a
trusted HTTPS endpoint that serves the assets without a Gitea login. VERA
currently ships Windows x64 and Linux x64 builds.

## Device access

- **Linux** Install the fork's `60-sigrok-instruments.rules` and upstream
  `60-libsigrok.rules` under `/etc/udev/rules.d/` where needed. The fork rule
  covers Hantek `04b5:3062` and ATK `1a86:ffcc` for `plugdev`. Join the
  group, reload udev rules, reconnect the USB devices and start a new login
  session. The Raspberry Pi deb includes the fork rule.
- **Windows** Use Zadig to bind WinUSB to the identified Hantek, ATK-DL16 or
  fx2lafw-class device when required. Match the USB identity before replacing
  any driver. Serial instruments use their observed COM port.

VERA leaves driver installation and system permissions to the user.
Instrument configuration can affect live outputs. In Ask mode the program
tool waits for typed confirmation before irreversible commands.

## Source

The packages identify DDP PulseView build
`66540df92da13c4d6861736e788b523709526262`. The sigrok stack and DDP
drivers are GPL-3.0-or-later. The fork's current licensing map identifies
bundled components and the corresponding source. VERA invokes the CLI as
a separate program. [Source revision](http://192.168.1.15:3001/dpasare/2026_Pulseview/commit/66540df92da13c4d6861736e788b523709526262)

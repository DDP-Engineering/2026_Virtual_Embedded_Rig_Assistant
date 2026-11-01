# Plugin `sigrok` — logic analyzers, oscilloscopes and bench instruments

PURPOSE: specify the official `sigrok` plugin, which lets the agent capture and decode signals and
read or drive bench instruments through `sigrok-cli` from the DDP Engineering sigrok fork.
DONE-WHEN: on Windows x64 and Linux x64 the agent scans for an ATK-DL16 logic analyzer and a Hantek
DSO-3062L, captures a bounded trace to a workbench file, decodes UART and I2C from it, and reads a
bench power supply; setting a supply output waits for the typed confirmation outside `bypass`.
STATUS: proposed 2026-11-01; not implemented. Plugin format and rules: [architecture.md](architecture.md).
Work package: PLG-21 in [plan.md](plan.md).

## 1. Source: the DDP sigrok fork

Repository `ssh://git@192.168.1.15:2222/dpasare/2026_Pulseview.git` ("2026 PulseView"), revision
`66540df` (built 2026-08-31). It carries the whole sigrok stack (libsigrok, libsigrokdecode,
sigrok-cli, PulseView 0.5.0) as ordinary files.

| Item | Fork | Upstream sigrok |
|---|---|---|
| Hardware drivers | 84 (82 on Windows): upstream plus `hantek-dso3062l` and `atk-dl16` | 82 |
| Protocol decoders | 137: upstream plus a 100BASE-FX networking chain (`ethernet`, `arp`, `ipv4`, `udp`, …) | 131 |
| Platforms | Windows x86_64, Linux x86_64, Raspberry Pi 4/5 aarch64 | distro packages, varying age |
| Python for decoders | CPython 3.13 embedded in the Windows build | external |

The two first-party drivers, both verified on a bench:
- `hantek-dso3062l`: Hantek DSO-3062L mixed-signal oscilloscope (VDIV and coupling across nine
  ranges, deep capture to 16 Msamples, roll mode, triggers, factory offset calibration).
- `atk-dl16`: ALIENTEK ATK-DL16 16-channel logic analyzer, including its PWM generators.

The driver list also covers many instrument classes the agent can use through the same program:
logic analyzers (`fx2lafw`, `saleae-logic16`, `kingst-la2016`, `dreamsourcelab-dslogic`,
`raspberrypi-pico`, …), oscilloscopes (`rigol-ds`, `siglent-sds`, `hantek-dso`, `gwinstek-gds-800`,
…), multimeters (`scpi-dmm`, `uni-t-dmm`, `fluke-dmm`, …), power supplies (`scpi-pps`,
`korad-kaxxxxp`, `rdtech-dps`, `manson-hcs-3xxx`, `gwinstek-gpd`, …), electronic loads
(`itech-it8500`, `maynuo-m97`, `siglent-sdl10x0`, …), function generators (`rigol-dg`,
`juntek-jds6600`) and USB relays (`dcttech-usbrelay`, `icstation-usbrelay`, `devantech-eth008`).

Licence: the packages are GPL-3.0-or-later; their source is the fork at the named revision. VERA
only downloads and runs the separate `sigrok-cli` program, so the plugin's own files (manifest,
skills) can carry VERA's licence.

## 2. Provisioning

| Platform | Install kind | Artifact | SHA-256 (revision 66540df) | Executable |
|---|---|---|---|---|
| `windows-x64` | `download` (zip) | `pulseview-20260831-66540df-windows-x64.zip` | `aa1bff062e25d09ec5e6c634c0def3b21cd7da90e700886fdbf6fdde361d4688` | `pulseview-windows-x86_64/sigrok-cli.exe` (embedded Python beside it) |
| `linux-x64` | `download` (single file) | `PulseView-x86_64.AppImage` | `d8bc80b138d559253b1dc25c4b02ae2b91d65865598b72adc37911ce73cab3a3` | the AppImage with `prefix: [--cli]` |
| `linux-arm64` | `find` `/usr/bin/sigrok-cli` from the `pulseview-ddp` deb, else `download` | `PulseView-aarch64.AppImage` | `45d12f22b02dac4455038867714f6e52b1b674ca1e0796166146435750e64bd3` | `sigrok-cli`, or the AppImage with `prefix: [--cli]` |

- **Hosting:** the packages are Git LFS files in `07_Delivery/` of a private LAN Gitea, and the
  repository has no release yet. Publish a Gitea release per revision with the five packages and
  `SHA256SUMS`, and pin its asset URLs in the manifest. Plain HTTP on the LAN is acceptable because
  every download is pinned by SHA-256. A public mirror is needed before community users outside the
  LAN can install the plugin.
- **AppImage:** the x86_64 AppImage needs glibc ≥ 2.35 and FUSE 2 to mount itself. Where FUSE is
  missing, run it with `APPIMAGE_EXTRACT_AND_RUN=1` in the program `env`, or extract it once at
  install time. PLG-21 measures both and picks one.
- **Fallback:** if no fork package is wanted, `find` an upstream `sigrok-cli` on `PATH`. The two
  first-party drivers and six decoders are then missing; the skill checks `sigrok-cli -L` and says so.
- **Version probe:** `sigrok-cli --version`; the fork is recognised when `-L` lists `atk-dl16`.

## 3. Device access (user steps, shown as hints)

| Platform | Step |
|---|---|
| Linux / Raspberry Pi | install `60-sigrok-instruments.rules` (Hantek `04b5:3062`, ATK `1a86:ffcc`; group `plugdev`) and the upstream `60-libsigrok.rules` into `/etc/udev/rules.d/`, reload udev, join `plugdev`. The deb installs the rules itself. |
| Windows | bind the Hantek, the ATK-DL16 and fx2lafw-class analyzers to WinUSB with Zadig (libwdi); the fork's libusb carries a WinUSB RAW_IO patch for their 512-byte transfers. Serial instruments need only their COM port. |

## 4. Manifest

```yaml
format: 1
id: sigrok
version: 1.0.0
name: sigrok (DDP fork)
description: Capture and decode logic and analog signals, and read or set bench instruments (multimeters, power supplies, loads, generators, relays) through sigrok-cli. Use for any measurement or protocol-decoding task.
ecosystem: general
platforms: [windows-x64, linux-x64, linux-arm64]
programs:
  sigrok-cli:
    install:
      download:
        windows-x64: { url: "<release>/pulseview-20260831-66540df-windows-x64.zip", sha256: "aa1bff06…", path: "pulseview-windows-x86_64/sigrok-cli.exe" }
        linux-x64:   { url: "<release>/PulseView-x86_64.AppImage", sha256: "d8bc80b1…", prefix: [--cli] }
        linux-arm64: { url: "<release>/PulseView-aarch64.AppImage", sha256: "45d12f22…", prefix: [--cli] }
    version: { args: [--version], match: 'sigrok-cli (\d+\.\d+\.\d+)' }
    timeout: 120
rules:
  - { match: "sigrok-cli {-V,--version,-L,--list-supported,-h,--help}", risk: safe }
  - { match: "sigrok-cli * {-i,--input-file} *", risk: safe, note: Decodes a saved capture file; no hardware. }
  - { match: "sigrok-cli * {--scan,--list-serial,--show,--get} *", risk: device-read }
  - { match: "sigrok-cli * {-d,--driver} * {--samples,--time,--frames,--continuous} *", risk: device-read, note: Captures from the instrument. }
  - { match: "sigrok-cli * --set *", risk: device-write, note: Changes instrument settings. }
  - match: "sigrok-cli * {-d,--driver} {scpi-pps*,korad-*,rdtech-dps*,manson-*,gwinstek-gpd*,gwinstek-psp*,atten-pps*,motech-*,itech-*,maynuo-*,siglent-sdl*,arachnid-labs-*,zketech-*,rigol-dg*,juntek-*,dcttech-usbrelay*,icstation-usbrelay*,devantech-eth*} * --set *"
    risk: irreversible
    note: Drives a physical output (supply, load, generator or relay) connected to the bench.
  - { match: "sigrok-cli * {-d,--driver} atk-dl16* * {-c,--config} pwm* *", risk: irreversible, note: Starts the ATK-DL16 PWM generator output. }
```

- Patterns rely on the matcher splitting `--driver=x` into `--driver x` (architecture §2.2).
- The fork's driver names carry options after a colon (`korad-kaxxxxp:conn=/dev/ttyACM0`); prefix
  tokens such as `korad-*` match them.
- Captures are written with `-o captures/<name>.sr -O srzip`; stdout capture dumps would exceed the
  tool result cap. The fork documents `-O srzip`, not CSV, for triggered captures.
- `--continuous` captures run with `background: true` and end with `program_stop`.

## 5. Skills

| Skill | Covers |
|---|---|
| `sigrok-capture` | `--scan`, choose driver and `conn`, channels, sample rate, trigger (`-t`, `-w`), bounded `--time`/`--samples`, save to `captures/` as srzip, report the file |
| `sigrok-decode` | offline decoding of a saved capture with `-P` stacks and `-A` annotation filters (UART, I2C, SPI, CAN, 1-Wire, the 100BASE-FX chain); summarise, cite the capture file |
| `sigrok-instruments` | read multimeters, supplies and loads (`--get`, short captures); explain every `--set` that drives an output before asking; never ramp outputs in a loop |
| `hantek-dso3062l`, `atk-dl16` | device notes from the fork's `04_HardwareDocu/`: channels, ranges, rates, triggers, PWM, known limits |

## 6. Verification

- Matcher tests: every rule row, including `--driver=` forms, PSU `--set` as `irreversible` and
  offline `-i` decoding as `safe`.
- Offline: decode a recorded `.sr` capture (UART, I2C) on all three platforms without hardware.
- Bench smoke on Windows and Linux: ATK-DL16 capture and decode, a Hantek DSO-3062L frame, one SCPI
  or Korad supply read; one supply `--set` in `ask` with the typed confirmation.

NOTES:
- Open decision: VERA has no `linux-arm64` build. The Raspberry Pi rows work only once VERA ships
  one (Electron and the native modules support arm64), or through a future remote bench node.
- Verify while implementing: the exact `sigrok-cli --version` text of the fork, the AppImage FUSE
  behaviour, and Zadig needs per driver.
- Source facts: the fork's `README.md`, `07_Delivery/README*.txt`, `SHA256SUMS`,
  `00_Planning/Overview.md`, `02_Tools/build/STATUS.md` at revision 66540df.

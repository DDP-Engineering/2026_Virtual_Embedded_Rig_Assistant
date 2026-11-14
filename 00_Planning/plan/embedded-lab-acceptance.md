# Integrated acceptance of the embedded lab plugins (epic #101, LAB-08 L08-H)

PURPOSE: the aggregate acceptance report of the eight embedded/lab plugins: for each of the eight integrated steps of
the LAB-08 ticket, the evidence that exists, the versions and hashes it rests on, the conditions, the verdict and its
limits. It reuses the still-valid evidence of LAB-01...07 (their "as built" sections in
[embedded-lab-plugins.md](embedded-lab-plugins.md)) instead of rerunning it; only the new LAB-08 flows and the
interactions they touch were verified again.
STATE: written 2026-11-14 with LAB-08 (AEGIS TASK-b3344846) on branch `feature/101-embedded-lab`, Windows 11 x64;
Linux x64 runs under WSL2 added the same day (section "Linux x64 under WSL2").

## Rules this report follows

- Three evidence classes (umbrella rules): **offline** (fixtures, stand-ins, recorded protocol), **real tool** (the real
  program or library, no hardware), **hardware** (a real instrument, probe or board with an identified setup). A
  stand-in, a simulator or a hand-written record never ticks a hardware criterion; a compiled-only test is not an
  executed test.
- Verdicts: **met** (the step's criterion holds with the class of evidence it needs), **partial** (the mechanics hold
  offline or with real tools, the class the criterion needs is missing), **blocked** (the evidence needs equipment this
  machine does not have). A blocked step is never ticked.
- Inventory of this machine (read-only, 2026-11-13/14, `Get-PnpDevice`): no SCPI/USBTMC instrument, no vendor VISA,
  no debug probe, no USB-serial board, no Joulescope; COM3/4/7/8 are Bluetooth links. No native Ubuntu x64 machine
  (WSL is not native Ubuntu). Nothing was purchased, no driver installed, nothing put on PATH.

## Versions and hashes the evidence rests on

| Item | Version | Identity | Used by |
|---|---|---|---|
| Branch base | `feature/101-embedded-lab` | LAB-01 41313ca, LAB-02 12059de, LAB-03 8c374f4, LAB-04 b3667c2, LAB-05 dfbf0a8, LAB-06 8c6974d, LAB-07 daee715, LAB-08 35f7adb; Linux test fixes 8c0e09a, 398d2e2, 97bfe22 | all |
| PyVISA / pyvisa-py / pyserial / pyusb | 1.16.2 / 0.8.1 / 3.5 / 1.3.1 | PyPI pins of `scpi_tool.py` | LAB-01 (real library run against local simulated servers) |
| pyjoulescope_driver | 2.5.5 | PyPI pin of `power_profile.py` | LAB-05 (import and enumeration, no meter) |
| xPack arm-none-eabi-gcc (GDB 16.3.90) | 15.2.1-1.1 | zip SHA-256 bae6a3d1...93ea | LAB-04 |
| xPack OpenOCD | 0.12.0-7 | zip SHA-256 6bfd3c97...0052 | LAB-04 |
| Renode | 1.17.0 | renode-1.17.0.windows-portable.zip SHA-256 18bcf145...b9db | LAB-06, LAB-07, LAB-08 |
| Zephyr / Zephyr SDK | v4.4.2 (dccb0959) / 1.0.1 | SDK minimal bundle SHA-256 17a557e7...ea4b, arm toolchain d08df2e8...8aa8d | LAB-07 |
| STM32CubeProgrammer | 2.23.0 | installed by the user (%ProgramFiles%) | LAB-07 |
| PlatformIO Core | 6.2.0 | PyPI `platformio-6.2.0-py3-none-any.whl` (2026-09-05), whole dependency closure pinned | LAB-08 |
| PlatformIO platforms and packages | ststm32 20.0.0, native 1.2.1, toolchain-gccarmnoneeabi 1.70201.0 (GCC 7.2.1), framework-cmsis 2.50501.200527, framework-cmsis-stm32f4 2.6.11, tool-ldscripts-ststm32 0.3.0, tool-scons 4.41101.0, tool-openocd 3.1200.7, Unity 2.6.1 | registry SHA-256 verified by PlatformIO at install (approved 2026-11-14), e.g. ststm32 2a41b41f...da74, toolchain 05e08e99...12a9, Unity d74dc466...d610 | LAB-08 |
| WinLibs GCC (native host tests) | 16.2.0 r2 (UCRT, posix-seh) | zip SHA-256 d5dbafc4...276a, checked before extraction | LAB-08 |
| LAB-08 fixture firmware | `disco` build | firmware.elf SHA-256 1635e706...aaa8; device test ELFs test_lines 9a156f17...a7d6, test_skip ad59ea35...b0b3, test_fail 6763f48c...4411 | LAB-08 |

## The eight steps

### 1. Identify instruments, probe and board; reserve resources; check limits and cleanup

- Evidence: LAB-01 one lease registry (`ResourceLeases`), BUSY across runners and a second VERA process, stop with
  grace, one authorized cleanup run, physical state `confirmed/unchanged/unknown` (offline + real processes,
  `scpi-instruments.test.ts`, `runner-leases.test.ts`); LAB-04 `probe` kind and LAB-05 `power-monitor` kind with BUSY
  against probe-rs `--probe`, HIL holds and second sessions; LAB-08 again: a `platformio-upload` run reserves its
  probe and a second session naming it is BUSY through VERA's real runner (`platformio.test.ts`).
- Verdict: **partial** - lease, BUSY, limits and cleanup hold offline and with real processes; identifying a real
  instrument, probe or board is **blocked** (none attached).

### 2. Real SCPI capture compared with the requirement and the simulated reference

- Evidence: LAB-02 verdict engine with closed-form fixtures, a LAB-01 capture folder produced by the real scpi helper
  on its fake PyVISA, pass/fail/incomplete aggregated by `report`; the real PyVISA/pyvisa-py library path against local
  simulated servers (LAB-01 `VERA_SCPI_UV`).
- Verdict: **blocked** - no SCPI instrument and no real circuit; ngspice is not installed here (L02-F, L01-A/B/E/G
  open).

### 3. HIL plan with flash/verify, reset, UART and measurement; a failed assertion and a mid-plan Stop

- Evidence: LAB-03 core HIL compile/executor with VERA's real runner and the real serial-monitor, scpi, lab-validate
  and hil helpers on their fakes plus the probe-rs replay stand-in: assertion failure, Stop with cleanup, no run left,
  report and final state (`hil-testing.test.ts`). LAB-08: a HIL plan takes a PlatformIO build's copied ELF and SHA-256
  as its firmware unchanged (schema check in `platformio.test.ts`), so HIL needs no second programming path.
- Verdict: **partial** - plan mechanics, Stop and reports offline; a real board, probe-rs/esptool and a measurement
  are **blocked** (L03-C, live L03-H open).

### 4. GDB snapshot of the identified firmware, authorized breakpoint/control, close without servers left

- Evidence: LAB-04 real GDB 16.3.90 against the OpenOCD stand-in's remote-protocol target (snapshot, unwinding
  through the exception frame, breakpoints by function/line/address, a not-hit interrupt, instruction steps, a
  rebuilt-ELF mismatch withholding symbols, zero write packets) and the real OpenOCD 0.12.0-7 stopping at the missing
  adapter with physical `unchanged`; read-only mode refuses control (rules), Stop leaves no server.
- Verdict: **partial** - real tools without hardware; OpenOCD's detach events on a real core and a real board are
  **blocked** (L04-B/C/E/F open).

### 5. Real power capture with sleep/wakeup, energy integration, comparison of two identified builds

- Evidence: LAB-05 closed-form fixtures (uniform, non-uniform, gaps, overflow never zero), A/B classification by
  firmware SHA-256 and ELF build id, battery estimates, lab-validate integrating to the same energy and charge, the real
  pyjoulescope_driver 2.5.5 enumerating no device (`identify`/`capture` blocked `device-missing`, physical
  `unchanged`).
- Verdict: **blocked** - no Joulescope JS220, no reference load, no sleep/wake board (L05-A, live L05-C/H open).

### 6. Renode firmware/profile verified with a virtual test, never presented as analog or hardware evidence

- Evidence: LAB-06 real Renode 1.17.0: board-basics passes twice with equal virtual results, wrong version is an
  assertion, silence a virtual timeout, an unmodeled DAC write `incomplete`, no TCP/UDP endpoint, no hidden download
  (the SVD `ApplySVD @https` block removed). LAB-07: Zephyr ztest pass/skip/fail on the same profile with the declared
  differences (SysTick 72 vs 168 MHz, DBGMCU/SYSCFG_EXTICR1 unmodeled). LAB-08: the real PlatformIO ELF passes all
  four board-basics cases, and the device Unity suites give pass/incomplete/fail (section "LAB-08 real runs").
  Every result carries `evidence: virtual` and the fixed not-covered list (electrical timing, power, EMI, SPICE).
- Verdict: **met on Windows (virtual evidence)**; native Ubuntu open.

### 7. Zephyr and PlatformIO build/test with traceable artifacts on the proper targets; build-only, virtual, host and test-device kept apart

- Evidence: LAB-07 real Zephyr 4.4.2 + SDK 1.0.1 builds in two folders with different HEX hashes, Kconfig/devicetree
  diagnostics, Twister build-only (`not run`, never pass), test-run verdicts only from a Renode run of the same ELF.
  LAB-08: offline, every operation against the PlatformIO stand-in with platformio.ini read by the real PlatformIO
  6.2.0 parser (two MCU environments into separate folders with distinct hashes, versions, input hashes, scrubbed
  environment and closed proxy; host tests per case with fail/skip/error never pass; device tests build-only;
  test-run binding a virtual or HIL record by ELF SHA-256; an execution that did not pass never yields pass); the
  real PlatformIO runs below (two environments, host tests, device tests on Renode).
- Verdict: **met on Windows for build-only, host and virtual** (Zephyr and PlatformIO, distinct and labelled);
  test-device on a real board is **blocked** (no board); native Ubuntu open.

### 8. Aggregate report; closing/Stop leaves no process, no managed resource busy and no physical state falsely safe

- Evidence: this report; Stop through VERA's real runner leaves no process in LAB-01, 03, 05, 06, 07 and 08
  (`platformio.test.ts`: the stand-in's child process is gone after Stop, the other build folder and the sources are
  unchanged, the partial result reads `build-unfinished`); leases are released or recorded `unknown`; an interrupted
  flash/upload reports physical `unknown`, never `unchanged`.
- Verdict: **met** for the software lifecycle (offline + real processes); a physical state on real hardware is
  **blocked** with steps 1-5.

## LAB-08 real runs

Windows 11 x64, 2026-11-14, with the downloads the user approved (relayed by the coordinator) in `D:\Temp\vera-pio\`,
nothing on PATH or in global configuration; opt-in `VERA_PIO_REAL` suite plus a manual run of each operation:

| Criterion | Real evidence | Verdict |
|---|---|---|
| L08-A | prepare-packages (network) then `build` of `disco` and `disco_fast` into separate owned folders, offline behind the closed proxy: distinct ELFs, ststm32 20.0.0 and toolchain 1.70201.0 recorded, input hashes unchanged, no `.pio` in the project; a compile error cites build.log and the source line | met on Windows; native Ubuntu open |
| L08-B | preflight findings on the real parser; Unity's real build script is a `library-script` finding approved by hash | met (offline + real parser) |
| L08-C | host: test_lines pass (4 cases), test_skip incomplete, test_fail fail (WinLibs GCC 16.2.0); device: build-only suites, then Renode runs of each ELF: pass, incomplete, fail (virtual evidence) | met for host and virtual; a device run on a real board blocked |
| L08-D | lease and BUSY through VERA's runner (offline); real PlatformIO upload target: requires all five ststm32 uploaders, refused `packages-missing` before PlatformIO starts (only tool-openocd approved); OpenOCD not reached | partial; a real board blocked |
| L08-E | the only network step is prepare-packages; the real build ran offline; a real install attempt behind the proxy failed (`HTTPClientError`); PlatformIO's cache-based offline install found and closed | met on Windows |
| L08-F | Stop, failed build, clean, invalid paths (offline, real runner); real failed build leaves sources unchanged; upload errors only against the stand-in and the real `packages-missing` refusal | met for build/test/clean; upload errors offline only |
| L08-G | test-run consumes Renode (real) and HIL (record) runs by ELF SHA-256; a HIL plan takes the build's ELF and hash | met for virtual; HIL on a board blocked |
| L08-H | this report | partial: the report is complete, but steps 2 and 5 are blocked and steps 1, 3 and 4 partial (no instrument, probe, board or JS220) |

## Linux x64 under WSL2

Ubuntu 24.04.4 LTS under WSL2 (kernel 6.18.33.2-microsoft-standard-WSL2), Python 3.12.3, Node 24.21.0, clone of
`feature/101-embedded-lab` at `~/vera-lab`. This is real Linux x64 for the software paths (paths, POSIX process
groups and signals, the `linux-x64` provisioning entries, the Linux tool builds). It is **not** native Ubuntu: WSL2
has no `/dev/bus/usb`, no udev and no attached device, so every hardware and USB-access criterion stays as above.
Downloads approved by the user on 2026-11-14, each SHA-256 checked before extraction, all under `~/vera-lab-tools`,
nothing on PATH, no global configuration, no `setup.sh`/hosttools installer run, no sudo:

| Item | Version | Identity |
|---|---|---|
| Renode | 1.17.0 | renode-1.17.0.linux-portable.tar.gz SHA-256 4ba7c68b...5a5f (the manifest's `linux-x64` pin) |
| Zephyr SDK | 1.0.1 | linux-x86_64 minimal ca9bc0ff...a7eb, arm-zephyr-eabi toolchain 21b85981...a634 (GCC 14.3.0) |
| Zephyr workspace | v4.4.2 dccb0959, cmsis_6 30a859f4, hal_stm32 fc11896d | cloned locally from the Windows workspace, no network |
| xPack arm-none-eabi-gcc (GDB 16.3.90) | 15.2.1-1.1 | linux-x64 tar.gz da6a49ad...1ff6 (the binutils `linux-x64` pin) |
| xPack OpenOCD | 0.12.0-7 | linux-x64 tar.gz 94b37909...68d6 |
| PlatformIO packages (Linux) | ststm32 20.0.0, toolchain-gccarmnoneeabi 1.70201.0 linux_x86_64, framework-cmsis(-stm32f4), tool-ldscripts-ststm32, tool-scons, Unity 2.6.1, tool-openocd 3.1200.7 | registry SHA-256 verified by PlatformIO; installed by the helper's prepare-packages |
| PyPI | helper pins of zephyr_tool.py and pio_tool.py; pyjoulescope_driver 2.5.5; pyelftools 0.32 | uv venvs |
| Host GCC (native host tests) | 13.3.0-6ubuntu2~24.04.1 | Ubuntu `build-essential`, installed by the user |

Results (vitest in WSL2, 2026-11-14):

- All 12 LAB test files offline: pass (228 passed; the skipped ones are the opt-in suites run below).
- Opt-in real suites: PyVISA/pyvisa-py over TCPIP SOCKET (LAB-01), uv-provisioned lab-validation (LAB-02), the
  pyelftools oracle and real GDB 16.3.90 + OpenOCD 0.12.0-7 without a probe (LAB-04), the real pyjoulescope_driver
  without a meter (LAB-05; `usb.ok` false with the udev-rule hint, as designed), real Renode 1.17.0 (LAB-06), real
  Zephyr builds, Twister build-only and Renode verdicts (LAB-07), real PlatformIO prepare-packages, offline builds,
  device suites judged on Renode, the upload refusal `packages-missing` and the `native` Unity suites on the host with
  Ubuntu's GCC 13.3.0 (`build-essential`, installed by the user): pass, incomplete and fail stay distinct (LAB-08):
  all pass.
- Not run on Linux: STM32CubeProgrammer (not installed in WSL).
- The Linux runs found five test faults that Windows never reaches, all fixed without changing plugin code: a dangling
  symlink left by a Linux-only check (LAB-02), a fake VISA hang that SIGTERM interrupts on POSIX so the
  kill-after-grace path was never exercised (LAB-01), a USB assumption only true with WinUSB (LAB-05), a hard-coded
  `python` (LAB-07) and a bogus proxy that also reached the real prepare-packages (LAB-08).

Verdict for the `native Ubuntu` halves: the Linux x64 software paths are met under WSL2; native Ubuntu with USB access
and hardware stays open.

## Open items by package

| Package | Open (never ticked here) |
|---|---|
| LAB-01 | L01-A/B/E/G on real instruments; native Ubuntu (REQ-PLAT-fae260c3); the vendor VISA backend |
| LAB-02 | L02-F (real capture vs real simulation); native Ubuntu (REQ-PLAT-72a7e11a); real sigrok-cli bytes |
| LAB-03 | L03-C (real board, probe-rs/esptool); live L03-H on Windows and native Ubuntu (REQ-PLAT-759e6df8) |
| LAB-04 | L04-B/C/E/F on a real board and probe; both profiles `unverified`; native Ubuntu (REQ-PLAT-8c2cdfb0) |
| LAB-05 | L05-A, live L05-C and L05-H (JS220); profile `unverified`; native Ubuntu (REQ-PLAT-cd7e4f2c) |
| LAB-06 | L06-H on native Ubuntu (REQ-PLAT-d03a51af); a firmware other than the fixtures; profile `unverified` |
| LAB-07 | L07-E on a real board; native Ubuntu (REQ-PLAT-85d446fd); prepare-workspace through the helper on the network |
| LAB-08 | L08-D on a real board (and OpenOCD reached through PlatformIO: four more ststm32 uploaders, not approved); test-device on a real board; native Ubuntu (REQ-PLAT-c2031dc3) |

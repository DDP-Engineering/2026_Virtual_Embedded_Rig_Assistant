# Official plugins: lab instruments, validation and HIL

## Routing

Select for `scpi-instruments` (program `scpi`, a PEP 723 PyVISA script that acts on the instruments declared in
`lab/resources.json` only through validated profiles, with the platform's resource leases and supervised cleanup;
skills bench-instruments and instrument-profiles); `lab-validation` (program `lab-validate`, a standard-library PEP
723 script that compares captures, CSV/sigrok exports and SPICE run folders with requirements offline; skills
validation-planning and difference-explanation); `hil-testing` (program `hil` whose `check` and `run` VERA core
compiles and executes as hardware-in-the-loop plans over the other plugins, plus a standard-library report helper;
skill hil-planning); `power-profiler` (programs `power-profile` for Joulescope JS220 captures on pyjoulescope_driver
2.5.5 and `power-analyze` for offline energy, charge, events, A/B and battery analysis; skills power-measurement and
energy-analysis); and `sigrok` (logic, analog and instrument work with five skills).

For scpi-instruments, start at plugins/scpi-instruments/plugin.yaml, scripts/scpi_tool.py and scripts/scpi_support/
(cli.py dispatch, request.py limits, registry.py, profiles.py with profiles/*.json, session.py PyVISA and diagnostics,
classes.py operations per class, waveform.py, lifecycle.py, local.py, report.py) with spec
.agentic/specs/REQ-DATA-b3e2930f.md; tests/plugins/scpi-instruments.test.ts and tests/fixtures/scpi-instruments/ (a
fake PyVISA/pyserial/pyusb - offline evidence only) own its coverage. Its reservation and cleanup are platform
behaviour, see [Plugin bench resources](plugins-bench-resources.md) and spec .agentic/specs/REQ-DATA-f2cbfc23.md.

For lab-validation, start at plugins/lab-validation/plugin.yaml, scripts/lab_validate.py and scripts/lab_validation/
(cli.py operations and pipeline, request.py validation and bind, importers.py importer registry, signals.py and
preprocess.py normalization and preprocessing, series.py windows/gaps/interpolation, metrics.py metric registry,
align.py comparisons, decide.py criteria and verdict, diagnostics.py codes, report.py run folder and report.md,
aggregate.py `report`) with spec .agentic/specs/REQ-DATA-53797d16.md; tests/plugins/lab-validation.test.ts and
tests/fixtures/lab-validation/ (hand-derived solutions in its README, a no-network sitecustomize guard) own its
coverage; it imports real scpi-instruments capture folders written by the scpi helper on its fake PyVISA. Its
workspace.py is a byte-identical copy of the electronics plugins' (ngspice.test.ts checks every copy). New metrics and
importers are registrations in metrics.py and importers.py, never a second engine.

For hil-testing, start at plugins/hil-testing/plugin.yaml (program `hil` with `plan: hil`), the core HIL module
(src/libraries/core/src/plugins/hil/: adapters.ts registry, compile.ts, executor.ts, run.ts) and scripts/hil_report/cli.py
(the report renderer) with spec .agentic/specs/REQ-DATA-5f714098.md; core hil/hil.test.ts (scripted process host) and
tests/plugins/hil-testing.test.ts (real runner and real serial-monitor, scpi, lab-validate and hil helpers on
their fakes, probe-rs replay stand-in) own its coverage. New step kinds are adapter registrations, never a second
executor.

For power-profiler, start at plugins/power-profiler/plugin.yaml (programs `power-profile` with `resources {option:
--meter, kinds: [power-monitor]}` and `power-analyze`), scripts/power_profile.py, scripts/power_analyze.py and
scripts/power_support/ (capture.py the live flows and stream assembler, meter.py the allow-listed driver wrapper,
capfile.py the capture folder, signals.py/measure.py/segment.py the analysis on the copied series.py, compare.py,
battery.py, importer.py, render.py, acquisition.py and profiles.py with profiles/joulescope-js220.json, registry.py,
firmware.py with the copied elf.py, usb.py, result.py, lifecycle.py, workspace.py the shared copy) with spec
.agentic/specs/REQ-DATA-dd3e4fe1.md; tests/plugins/power-profiler.test.ts and tests/fixtures/power-profiler/ (the
pyjoulescope_driver stand-in fake-driver/, closed-form CSV fixtures from make_fixtures.py) own its coverage - offline
evidence, never a real JS220 - plus the opt-in `VERA_POWER_REAL_PYTHON` suite with the real driver and no meter. Its
meter reservation is the platform's `power-monitor` registry kind, see [Plugin bench resources](plugins-bench-resources.md); criteria go through
lab-validation's `integral` metric and `power-capture` importer; HIL steps `power.identify`/`power.capture`.

The conventions shared by all official plugins (package format, catalog source, packs, versions and evidence
levels) and the page of every other plugin are in [Official plugins](official-plugins.md). The platform that
installs, classifies, approves and runs these programs is [Plugins](plugins.md); plugin skill discovery is
[Skills](skills.md).

## Public interface

- `scpi-instruments` 0.2.0, ecosystem `lab` (pack Embedded lab, group Bench instruments (SCPI), default on; activity
  `measurement`), Windows x64/Linux x64. Program `scpi` = `scripts/scpi_tool.py` (PEP 723: PyVISA 1.16.2, pyvisa-py 0.8.1,
  pyserial 3.5, pyusb 1.3.1), env `SCPI_REGISTRY=${workbench}/lab/resources.json`, `resources {option: --instrument,
  kinds: [visa], grace: 10, cleanup: [close], cleanupTimeout: 60}`, timeout 120 s. Operations (first argument only, any
  other first argument or option refused with exit 2): `capabilities (--profile|--alias)`, `discover-configured`,
  `decode --capture` (safe); `discover-configured --list-local` (serial ports via pyserial, USBTMC via pyusb, never VISA's
  resource search), `identify`, `read [--channel]`, `capture --channel`, `status` (device-read); `configure --set
  NAME=VALUE` (1..16), `close` (device-write); `output --channel --voltage --current --hold 1..3500` (irreversible, word
  `output`, rule timeout 3600 s). Every instrument operation checks `*IDN?` (manufacturer, model, firmware pattern,
  declared serial) before anything else, validates channels and values against the profile and the entry's bench
  limits before opening, writes `embedded-lab-results/<run-id>/result.json` (format 1, kind `scpi-result`, status
  pass/fail/incomplete/blocked/error, identity, profile verification, lifecycle with `physical`, values/series with units,
  problems, commands sent, artifacts with SHA-256) and exits 0 pass, 1 fail, 2 refused/blocked before any effect, 3
  incomplete/error. Profiles (all `unverified`): `keysight-34461a`, `rigol-ds1000z`, `rigol-dp800`. A power supply's
  set-points change only with that output off; `output` switches off and reads back at the end, on a stop request and
  after reconnecting; `configure`/`output` are blocked while `VERA_RESOURCE_STATE` marks the alias unknown. Captures keep
  `raw-<CH>.bin` and `preamble-<CH>.json`; `decode` recomputes `waveform-<CH>.csv` identically. Problem codes:
  truncated-transfer, visa-timeout, instrument-absent, driver-missing, connection-lost, reconnected, unexpected-reply,
  identity-mismatch, profile-unknown, registry-changed (the registry differs from `VERA_REGISTRY_SHA256`), state-unknown,
  readback-mismatch, output-on, clipped, stopped, limit, request, internal. `decode` reads only `preamble-<CH>.json` and
  `raw-<CH>.bin` (safe channel names, regular files, at most the profile's maxPoints x width bytes; a capture refuses a
  larger announced block before reading it) and checks them before creating its folder; refusals before the
  checks pass print without a folder; meter and scope `close` confirm only that no output exists to energize. Evidence: offline on
  Windows 11 against a fake PyVISA and with VERA's real runner, and the opt-in `VERA_SCPI_UV` run (real PyVISA
  1.16.2 + pyvisa-py 0.8.1 through the provisioner, TCPIP SOCKET to local simulated servers); no real
  instrument or native Ubuntu run yet.

- `lab-validation` 0.2.0, ecosystem `lab` (pack Embedded lab, group Measurement validation, default on; activity
  `measurement`), Windows x64/Linux x64. Program `lab-validate` = `scripts/lab_validate.py` (PEP 723, standard library,
  Python >= 3.11), timeout 600 s; every operation is `safe`: `inspect --path|--request` (prints, writes nothing),
  `normalize`, `measure`, `align`, `compare --request FILE`, `report --run DIR (1-20)`. A format 1 request (at most
  1 MiB; required `decisionRule` simple|guarded and `missingData` incomplete|exclude) names sources through the
  importer registry - `scpi-capture` (a scpi capture folder: result.json kind scpi-result and waveform-<CH>.csv
  checked against its artifact SHA-256, clipping from the required raw-<CH>.bin codes equal to the preamble's clip
  limits, captured conditions and identity; a decode folder is refused with its capture folder named), `csv` (declared time column or sample rate, channel columns with units, clip limits,
  `uniform`), `sigrok-csv` (`;` comments, `; Samplerate:`), `spice` (ngspice-tool/ltspice-tool transient folders,
  series.csv hash-checked, v(...) V, i(...) A; other analyses refused `domain`) - and signals with explicit sign, scale
  and ordered preprocessing (linear resample, moving average; never inside a gap). Metrics registry: min, max, mean,
  rms (trapezoid), peak-to-peak, ripple, frequency, duty-cycle, rise-time, fall-time, overshoot, settling-time (bound
  when unsettled), delay (same source only, else `clock`). Comparisons align by none/offset/marker (same source per
  side)/cross-correlation within maxLag (N x (2K+1) <= 1e7, the reference evaluated only where a lag needs it) and
  report max-abs, rms, mean, lag and correlation; `reference-short` limits the differences, not the lag.
  Criteria `<=`/`>=`/`==` (tolerance) under simple or guarded rules with the supplied uncertainty; limiting
  diagnostics (gap, clipped, source-incomplete, aliasing-suspect, aliasing-risk, under-sampled, bandwidth-unknown,
  bandwidth-limited, conditions-unknown, conditions-differ, lag-at-limit, reference-short) make a criterion
  incomplete; lag-unjudged and resampled-up are notes. Verdict fail > incomplete > pass. Results in
  `embedded-lab-results/<run-id>/` (exclusive, never in .vera): result.json kind `lab-validation-result`, report.md
  with relative source links, series-<signal>.csv, compare-<id>.csv/.svg; `report` writes report.json kind
  `lab-validation-report` after checking each run's artifacts. Exit 0 pass, 1 fail, 2 refused before any folder,
  3 incomplete/error; printed documents at most 11 000 UTF-16 units. No network, process or language model. Evidence:
  Windows 11 (toolchain CPython 3.12 and 3.11, VERA's real runner, real uv provisioning); no
  real capture of a real circuit and no native Ubuntu run yet.
- `hil-testing` 0.2.0, ecosystem `lab` (pack Embedded lab, group Hardware-in-the-loop tests, default on; activities
  `measurement`, `debug`, `flash`), Windows x64/Linux x64. Program `hil` = `scripts/hil_tool.py` (PEP 723, standard
  library) with `plan: hil`: `hil check <plan>` (safe, compiled by core, nothing started) and `hil run <plan>` (rule
  device-read, raised to the plan's highest operation risk and the firmware effect; one approval; core executes) never
  start the helper; `hil report --run DIR` (safe) writes report.html, report.md and junit.xml once into a finished run
  folder (exit 0, or 2 refused). Plan format 1 (setup with required `firmwareEffect`, firmware path + SHA-256, budget
  <= 3600 s, 1-64 steps, 0-16 cleanup steps) and step kinds probe-rs.list|flash|verify|reset,
  esptool.identify|flash|verify, serial.capture|send, scpi.identify|status|read|capture|configure|output|close,
  lab-validate.compare, await. Results in `embedded-lab-results/<run-id>/` (plan.json, result.json kind
  `hil-test-result`, events.jsonl, steps/). Evidence: Windows 11 offline and with real helper processes;
  no real board, probe or native Ubuntu run yet.

- `power-profiler` 0.2.0, ecosystem `lab` (pack Embedded lab, group Power profiling (Joulescope), default on; activity
  `measurement`), Windows x64/Linux x64. `power-profile` (PEP 723, Python >= 3.12, `pyjoulescope_driver==2.5.5`):
  `tools` (safe; driver version, WinUSB DLL / Joulescope udev rule, nothing changed), `tools --list` (device-read;
  device paths), `identify --meter <alias>` (device-read), `capture --meter <alias> --duration <0.01-3500> --rate
  <profile rate> [--current-range auto|<label>] [--voltage-range <label>] [--markers 0..3] [--firmware] [--board]
  [--condition]... [--label]` (device-write, rule timeout 3600; at most 1 000 000 samples) and the cleanup `release
  --meter` (device-write; signals off, current range auto, read back). `power-analyze` (standard library, all safe):
  `acquisition`, `import`, `inspect`, `measure-energy`, `segment`, `compare`, `battery`, `report`. Profile
  `joulescope-js220` `unverified`. Results in `embedded-lab-results/<run-id>/` (result.json kind `power-result`,
  samples.csv, events.csv, lab-validation-request.json, report.md/html, current-<n>.svg). Exit 0 pass, 2 refused or
  blocked before any setting changed, 3 incomplete, 4 error. Evidence: Windows 11 offline (closed-form fixtures, the
  driver stand-in, VERA's real runner, lab-validate on the written requests) and the real pyjoulescope_driver 2.5.5
  from PyPI without a meter; no JS220, board or native Ubuntu run yet.

- `sigrok` 0.2.0, general, Windows x64/Linux x64/Linux arm64: provision the
  SHA-256-pinned DDP PulseView 66540df asset or use a local sigrok-cli fallback.
  An installed pinned executable takes precedence. AppImage arguments apply
  to managed downloads only and force extraction before CLI launch. The LAN HTTPS
  release is a proposed endpoint. Check the full `-L` log or the driver's
  `--show` output for fork-only drivers before a hardware
  workflow. Skills cover bounded srzip capture, background streaming, offline
  decoding, instrument reads and approved changes, and the Hantek/ATK drivers.

## Invariants

- power-profiler opens the meter with `restore` (never its defaults) and writes only the sample rate, the current
  range mode (`auto` or `manual`, never `off`) and selection, the voltage range mode/selection and the signal controls;
  a meter whose current path is off is blocked before any write; changed settings are restored and read back, and only
  a matching readback reports `confirmed`. A sample-id skip or NaN stays an empty cell and a gap, a sample beyond its
  range limit an overflow flag; energy and charge over either are null (covered values reported), never zero.
  Segmentation trusts only the meter's clock (GPI markers, timestamps on the capture's own clock, the current itself);
  verdicts are lab-validate's.

- The lab-validation 0.3.0 HIL source reader accepts captured host scope/exclusions through input_paths.py; model request fields/options cannot choose it. Standalone calls retain confined input reads, and generated requests/results stay workbench-owned. Real-helper proof is tests/integration/hil-bypass.test.ts.

- Sigrok rules use the `sigrok-cli` option syntax to distinguish flags and values and
  classify output settings regardless of argument order. The CLI applies `--config`
  on reads and captures, so the manifest protects output-driving drivers and PWM
  groups in these forms as well as `--set`. An implicit driver with configuration is
  irreversible. Ask uses the typed approval gate. Exact raw argv is retained for
  the approval and launch.

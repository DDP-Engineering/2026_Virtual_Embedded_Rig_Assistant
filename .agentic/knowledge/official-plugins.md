# Official plugins

## Routing

For electronics-calc, start at plugins/electronics-calc/plugin.yaml, scripts/elec_calc.py and
scripts/elec_support/ with spec .agentic/specs/REQ-DATA-3d15fdfc.md; tests/integration/electronics-calc.test.ts
and tests/fixtures/electronics-calc/ own its numeric, refusal, report, integrity and session coverage.

For kicad, start at plugins/kicad/plugin.yaml, scripts/kicad_tool.py and scripts/kicad_support/ with spec
.agentic/specs/REQ-DATA-c32834e3.md; tests/integration/kicad.test.ts and tests/fixtures/kicad/ (fictional KiCad 10
projects, make_fixtures.py, internals.py) own its refusal, real-KiCad, integrity and provisioner coverage. The path
rules of the electronics plugins live in `workspace.py`, a byte-identical copy in elec_support, kicad_support and
parts_support (a test checks all three).

For parts-search, start at plugins/parts-search/plugin.yaml, scripts/parts_compare.py and scripts/parts_support/
with spec .agentic/specs/REQ-DATA-6b26f2a5.md; tests/integration/parts-search.test.ts and
tests/fixtures/parts-search/ (hand-derived README) own its evidence, identity, pricing, refusal and provisioner
coverage. Its supplier search is VERA's own tool, see [parts search](parts-search.md).

For ngspice, start at plugins/ngspice/plugin.yaml, scripts/ngspice_tool.py and scripts/ngspice_support/ with spec
.agentic/specs/REQ-DATA-29b9a988.md; tests/integration/ngspice.test.ts and tests/fixtures/ngspice/ (analytic
references and tolerances in its README, hostile netlists) own its refusal, real-engine and provisioner coverage.

For ltspice, start at plugins/ltspice/plugin.yaml, scripts/ltspice_tool.py and scripts/ltspice_support/ (netlist.py
for the LTspice dialect checks, raw.py for raw files, engine.py, schematic.py) with spec
.agentic/specs/REQ-DATA-0f9e36a3.md; tests/integration/ltspice.test.ts and tests/fixtures/ltspice/ (references and
tolerances in its README, hostile files, raw files written by LTspice 26.1.1) own its coverage. Its workspace.py,
measure.py and sweep.py are byte-identical copies of ngspice-tool's.

For scpi-instruments, start at plugins/scpi-instruments/plugin.yaml, scripts/scpi_tool.py and scripts/scpi_support/
(cli.py dispatch, request.py limits, registry.py, profiles.py with profiles/*.json, session.py PyVISA and diagnostics,
classes.py operations per class, waveform.py, lifecycle.py, local.py, report.py) with spec
.agentic/specs/REQ-DATA-b3e2930f.md; tests/integration/scpi-instruments.test.ts and tests/fixtures/scpi-instruments/ (a
fake PyVISA/pyserial/pyusb - offline evidence only) own its coverage. Its reservation and cleanup are platform
behaviour, see [Plugins](plugins.md) and spec .agentic/specs/REQ-DATA-f2cbfc23.md.

For lab-validation, start at plugins/lab-validation/plugin.yaml, scripts/lab_validate.py and scripts/lab_validation/
(cli.py operations and pipeline, request.py validation and bind, importers.py importer registry, signals.py and
preprocess.py normalization and preprocessing, series.py windows/gaps/interpolation, metrics.py metric registry,
align.py comparisons, decide.py criteria and verdict, diagnostics.py codes, report.py run folder and report.md,
aggregate.py `report`) with spec .agentic/specs/REQ-DATA-53797d16.md; tests/integration/lab-validation.test.ts and
tests/fixtures/lab-validation/ (hand-derived solutions in its README, a no-network sitecustomize guard) own its
coverage; it imports real scpi-instruments capture folders written by the scpi helper on its fake PyVISA. Its
workspace.py is a byte-identical copy of the electronics plugins' (ngspice.test.ts checks every copy). New metrics and
importers are registrations in metrics.py and importers.py, never a second engine.

For esp32-efuse, start at plugins/esp32-efuse/plugin.yaml and its review skill/README;
tests/integration/esp32-efuse.test.ts and tests/fixtures/esp32-efuse/ own risk coverage
and opt-in real virtual acceptance through the unchanged plugin platform.

Select for the plugin packages VERA maintainers ship in `05_Software/plugins/<id>/`: their `plugin.yaml`
programs and rules, helper scripts, Agent Skills and README; today `serial-monitor` (program `serial`: list
serial ports with board family, capture a console with an optional DTR/RTS reset, send one line; skills
`serial-console` and `esp32-identify`) and `esp32-esptool` (program `esptool`, esptool v5 from PyPI: identify, flash,
verify, erase and read ESP32 chips; skill `esp32-flash`); `esp32-idf` (EIM-activated idf.py, Xtensa/RISC-V addr2line;
skills `esp32-build-fix` and `esp32-panic`); `binutils` (ARM/RISC-V size, nm, readelf, objdump and addr2line, with firmware-size, crash-decode and elf-inspect); probe-rs (local debug probes, flash/memory/RTT with four skills); sigrok (logic, analog and instrument work with five skills); git (workbench version control, three skills and Git option-role classification); wireshark-tshark (capture-file analysis and bounded live capture through the user's TShark, tshark option-role classification, two skills); can-python (program `can`, a PEP 723 python-can script: list, listen-only capture, send, replay; skills can-capture and can-transmit) and can-dbc (pip cantools plus the `can-decode` script; skill can-decode); microchip-pymcuprog (pip pymcuprog with pymcuprog option-role classification; skills microchip-flash and microchip-fuses); stm32-cubeprog (find-only STM32_Programmer_CLI with command-line classification; skills stm32-flash and stm32-option-bytes); electronics-calc (program `elec-calc`, a standard-library PEP 723 script for electrical and thermal calculations; skills electronics-sizing and thermal-analysis); kicad (find `kicad-cli` for the user's KiCad 10 and the `kicad-tool` script that analyses a project on a copy: inspect, ERC, DRC, BOM, netlist, exports, review report; skills schematic-review and pcb-review); parts-search (the `parts-compare` standard-library script that compares candidates on datasheet evidence and writes a comparison and proposed BOM, with VERA's `parts_search` tool for supplier catalogs; skills component-selection and component-families); ngspice (the ngspice engine, found or on Windows the pinned official ngspice-47 7z, and the `ngspice-tool` script that checks netlists before the engine and runs validate, run, sweep, measure, compare and report; skill circuit-simulation); ltspice (Windows only: find-only LTspice 26 or newer and the `ltspice-tool` script that checks netlists and schematics before LTspice runs, with ngspice-tool's request model plus convert; skill ltspice-simulation); scpi-instruments (program `scpi`, a PEP 723
PyVISA script that acts on the instruments declared in `lab/resources.json` only through validated profiles, with the
platform's resource leases and supervised cleanup; skills bench-instruments and instrument-profiles); lab-validation
(program `lab-validate`, a standard-library PEP 723 script that compares captures, CSV/sigrok exports and SPICE run
folders with requirements offline; skills validation-planning and difference-explanation). Start at `05_Software/plugins/<id>/plugin.yaml`, and for
serial-monitor at `scripts/serial_monitor.py`; tests are in `05_Software/tests/integration/serial-monitor.test.ts` and
`esp32-esptool.test.ts` and `esp32-idf.test.ts` with fixtures in `05_Software/tests/fixtures/serial-monitor/`, `esp32-esptool/` and `esp32-idf/`. The platform that installs, classifies, approves and runs these
programs (store, provisioner, rules, gate, runner, serial-port guard, run_program) is [Plugins](plugins.md);
plugin skill discovery is [Skills](skills.md).

## Purpose and boundaries

Each folder is an ordinary plugin package in format 1 that the user installs from the folder (`vera plugin
install --path`, IPC `plugins.install`) or from the catalog, and enables per workbench. The folder is also a catalog
source: `packs.yaml` (ESP32, Firmware analysis, Wireshark, CAN, Microchip, STM32, Electronics design and Embedded lab groups, default on except Security), `catalog.yaml` (all packaged plugins
`official`, reviewed low-risk rules for esp32-efuse and stm32-cubeprog, discovery metadata), `CONTRIBUTING.md` and the hosted repository's CI template `.ci/catalog.yml`; `vera
catalog check --source 05_Software/plugins` finds no issue. `npm run prepare:plugins` builds it into the bundled
catalog release `05_Software/src/bundled-plugins/` (git-ignored), which packaging ships as `<resources>/plugins/` for
an offline first install. Nothing installs them automatically. A package holds content only: a manifest, PEP 723
scripts that the provisioner runs with the bundled uv, and Markdown skills; a pip program such as esptool comes from
PyPI at install time and is not part of the folder. `requires`: esp32-esptool lists `serial-monitor`; `vera catalog check`
reports a `requires` that names no catalog plugin, and catalog installs review required plugins first, while installs
from a folder or zip ignore it. Platform behaviour such as risk
policy, approvals, timeouts and the serial-port guard is not repeated in the packages.

Catalog discovery metadata for the twenty real packages lives in the maintainers' catalog.yaml map,
not plugin manifests. It lists factual activity/keyword classifications. Publication dates remain
absent without catalog release evidence; no commit/build/install timestamps are substituted.
Shared/source tests validate bounds/references; prepare-plugins and focused CLI acceptance prove
that source metadata reaches the deterministic bundled index unchanged.

## Public interface

- `electronics-calc` 1.0.0, ecosystem `electronics` (Electronics design pack, Calculations, default on;
  catalog activity `design`), Windows x64/Linux x64: program `elec-calc` = `scripts/elec_calc.py`, a PEP 723
  script on the standard library only (no dependency), `--version` probe, timeout 120 s.
  `elec-calc <dc|divider|rc|losses|thermal|tolerance|report> (--json TEXT | --input FILE) [--run-id ID]`;
  `report` also takes `--results-dir DIR` (default `electronics-results`). Standard output is one format 1
  JSON document (UTF-8, LF): tool, operation, model, runId, times, status, request origin/path/SHA-256,
  `inputs` (name, given, value, unit, source, conditions, note), assumptions, formulas, `results`
  `{value, unit, text}` in SI (temperatures in °C, 12 significant digits), details, checks
  (pass/fail/unknown/not-evaluated), warnings, limits, artifacts. A refusal has status `error` and `errors`
  `{code, path, message}` with codes json, schema, unit, number, domain, contradiction, insufficient, limit,
  path, output. Exit 0 result, 2 refused request or usage, 3 input/output failure (a report whose input
  changed, whose results directory was swapped for a link or whose files cannot be written; what the run
  created is removed). A printed document is at most 11 000 UTF-16 units: detail tables, then inputs, then
  formulas, assumptions and limits (a summary's result texts) are left out with a warning, an error list
  is cut and every text repeated from the request is bounded, because the runner returns the last 12 000
  characters.
  `elec-calc <operation> --help` lists every model with its fields.
  Models: dc ohm/series/parallel/shunt; divider resistive (`solveFor` vout/rTop/rBottom); rc
  time-constant/filter/waveform; losses linear-regulator/resistor/mosfet/diode/capacitor/inductor/power-budget;
  thermal junction-ambient/junction-case-sink/foster; tolerance (target, outputs, parameters by tolerance or
  min/max, 1..6 outputs, optional `monteCarlo` {samples 100..100000, seed} and limits); report (title,
  notes, 1..32 calculations with at most 1 000 000 Monte Carlo samples in total ->
  `<results-dir>/<run-id>/report.json` and `report.md`, summary with sizes and SHA-256).
  Every documented command is safe, with rule timeouts of 600 s for tolerance and 1800 s for report (the
  largest documented tolerance request took 51 s); anything else keeps the default device-write. Exact names and formulas:
  spec `.agentic/specs/REQ-DATA-3d15fdfc.md`. Verified on Windows with the toolchain Python, a direct
  `uv run --offline --script` and the opt-in `VERA_ELEC_UV` run (provisioner with uv 0.11.25 on a freshly
  downloaded managed CPython 3.13, 2026-11-12); native Ubuntu has not been run.

- `kicad` 1.0.0, ecosystem `electronics` (Electronics design pack, group Schematic and PCB (KiCad), default on;
  activity `design`), Windows x64/Linux x64. Program `kicad-cli`: find `%PATH%` then
  `%ProgramFiles%/KiCad/*/bin/kicad-cli.exe` (Windows), `$PATH` then `/usr/bin/kicad-cli` (Linux), probe
  `kicad-cli version` against `>=10.0,<11`, hint to https://www.kicad.org/download/; only
  `kicad-cli {version,--version,-v,--help,-h} *` is safe and `kicad-cli {sch,pcb,fp,sym,jobset} *` is blocked with a
  note pointing to kicad-tool. Program `kicad-tool` = `scripts/kicad_tool.py` (PEP 723, standard library only),
  `--version` probe, timeout 1800 s, every operation safe with a note on the new run folder:
  `kicad-tool <inspect|erc|drc|bom|netlist|export|review-report> --project FILE [--results-dir DIR] [--run-id ID]`,
  `drc`/`review-report` also `--refill-zones`, `export` `--kind sch-pdf|sch-svg|pcb-pdf|pcb-svg|gerbers|drill|pos`
  with `--layers` exactly for the three board-plot kinds. FILE is a `.kicad_pro`, `.kicad_sch` or `.kicad_pcb` inside
  the working directory. Each run creates `<results-dir>/<run-id>/` (default `electronics-results`) with
  `result.json`, `report.md` and KiCad's files (`erc.json`, `drc.json`, `netlist.net`, `stats.json`, `nets.json`,
  `bom.csv`/`bom.json`, `exports/...`) and prints one format 1 document (tool, version, operation, status, runId,
  started, finished, kicad {executable, version}, project {folder, name, files with role, bytes, SHA-256, format},
  summary, warnings, limits, artifacts, result, truncated) of at most 11 000 UTF-16 units; a refusal or failure
  has status `refused`/`failed` and `errors` {code, path, message} with codes usage, path, project, kicad, layer
  (exit 2) or run, source, output (exit 3). Verified with KiCad 10.0.8 on Windows 11 (2026-11-12), also through the
  opt-in `VERA_KICAD_UV` run (real uv 0.11.25, managed CPython 3.13, ProgramRunner); native Ubuntu has not been run.

- `parts-search` 1.0.0, ecosystem `electronics` (Electronics design pack, group Component selection, default on;
  activity `design`), Windows x64/Linux x64. Program `parts-compare` = `scripts/parts_compare.py` (PEP 723, standard
  library only, no network module imported), timeout 120 s; `parts-compare {--version,--help,-h}` and
  `parts-compare compare *` are safe. `parts-compare compare (--json TEXT | --input FILE) [--run-id ID]
  [--results-dir DIR]` reads a request of hard constraints (with conditions), preferences, quantity, currency,
  an optional replaced part and candidates with datasheet parameters (basis, conditions, source page/table,
  status) and supplier offers; decides each device eligible/unknown/rejected from the constraints alone (only
  confirmed datasheet values with a page or table, under the stated conditions and with a guaranteed basis, are
  evidence), merges candidates of one manufacturer, MPN and package, ranks eligible devices by the preferences
  (price = extended price within one currency), prices offers at the order quantity raised to MOQ and multiple,
  marks offers older than 24 h stale, and writes `comparison.json`, `comparison.md` and a proposed `bom.csv` to
  `<results-dir>/<run-id>/` (default `electronics-results`), all or nothing; exit 0, 2 (refused, every problem
  listed) or 3 (input changed or output failed, run folder removed). Supplier search is not a program: the host
  tool `parts_search` (see [parts search](parts-search.md)). Verified on Windows 11 with the toolchain Python and
  the opt-in `VERA_PARTS_UV` run (real uv, managed CPython 3.13, 2026-11-13); native Ubuntu has not been run.

- `ngspice` 1.0.0, ecosystem `electronics` (Electronics design pack, group Simulation (ngspice), default on; activity
  `design`), Windows x64/Linux x64. Program `ngspice`: find `C:/Spice64/bin/ngspice_con.exe`,
  `%ProgramFiles%/Spice64/...`, `%LOCALAPPDATA%/Programs/Spice64/...` (Windows), `$PATH`, `/usr/bin/ngspice`,
  `/usr/local/bin/ngspice` (Linux); download (windows-x64) the official ngspice-47 `.7z` (SHA-256 5922...8f5a,
  `Spice64/bin/ngspice_con.exe`); probe `-v` `ngspice-(\d+)` range `>=42`; every `ngspice *` command blocked (a
  netlist's control block can run shell commands). Program `ngspice-tool` = `scripts/ngspice_tool.py` (PEP 723,
  standard library), `uses: [ngspice]`, timeout 1800 s, operations validate/run/sweep/measure/compare/report safe.
  It reads the netlist chain itself (allowlisted cards, no `.control`, no `pre_osdi`/`osdi`/`codemodel`/`shell`, no
  line whose first visible character is punctuation followed by `#` - ngspice runs `*#`, `;#` and the like as control
  lines - no XSPICE `A` instances, includes inside the working directory, models, subcircuits and pin counts) and
  refuses before the engine; it replaces the title line (ngspice acts on cards there) and warns about `1M` (milli); runs
  `ngspice -b -n effective.cir` on a copy in `<results-dir>/<run-id>/` with its own control block (`alterparam`,
  `option temp`, the analysis, `wrdata`), sets no solver option, classifies the log (singular, convergence,
  model, vector, engine -> failed, exit 3, criteria not-evaluated), measures in Python (min, max, average, rms,
  peak-to-peak, ripple, overshoot, settling, value-at, final, average-power with its sign convention), writes
  series.csv, plot.svg, result.json, report.md; a noise run without noise generators is `not-applicable`; `report`
  writes report.json; timeout kills the engine (exit 3) and a sweep has a 1700 s budget; any failure after the run
  folder exists removes it. Verified with ngspice-47 on
  Windows 11 (2026-11-13), including the opt-in `VERA_NGSPICE_UV` provisioner install of the 7z; native Ubuntu
  has not been run.

- `ltspice` 1.0.0, ecosystem `electronics` (Electronics design pack, group "Simulation (LTspice, Windows)", default
  off; activity `design`), Windows x64 only, no Wine, no download. Program `ltspice`: find
  `%LOCALAPPDATA%/Programs/ADI/LTspice/LTspice.exe` (per-user) and `%ProgramFiles%/ADI/LTspice/LTspice.exe` (all users);
  hint with the analog.com install and the all-users msiexec command for error 2503; probe `-version` `^(\d+)\.`
  range `>=26`; every `ltspice *` command blocked (a netlist can write files anywhere with `.wave`; without `-b`
  LTspice opens its window). Program `ltspice-tool` = `scripts/ltspice_tool.py` (PEP 723, standard library),
  `uses: [ltspice]`, timeout 1800 s, operations validate/convert/run/sweep/measure/compare/report safe. It takes
  ngspice-tool's request and result model (kind `ltspice-tool-result`): the request's analysis, `.temp`, `.save`
  and `.step` replace the netlist's analysis, `.step`, `.temp`, `.save` and `.meas` cards; parameters rewrite their
  top-level `.param` assignment (LTspice refuses a second `.param`). Before LTspice runs it checks every line of the
  netlist chain on NFKC-normalized, case-folded text and refuses `.wave`, `.savebias`, `.loadbias`, `.savestate`,
  `.loadstate`, outside include cards the substrings `file`, `scopedata`, `tbl`, `.inc`, `include`, `.lib`,
  `loadbias`, `savebias`, `loadstate`, `savestate`, `fastaccess` (LTspice matches them by prefix), files with U+0085/U+2028/U+2029 or invisible formatting characters
  (LTspice reads the first two as line breaks and drops the latter), include names with `%` or not in NFC, netlists, includes and schematics whose path inside the working directory is not in NFC (a folder copied from a Mac may not be), quotes outside include, library and model cards, `@`/`&` elements, `.machine` and unknown cards,
  encrypted and non-UTF-8 workbench files, unreadable include names and an include of the netlist itself (a
  single-name `.lib` is an include except inside a file reached as `.lib FILE SECTION`); includes lie in the working directory (copied, rewritten relative to the
  copy that includes them - LTspice resolves includes against the including file's folder) or in LTspice's library
  `%LOCALAPPDATA%/LTspice/lib/{cmp,sub}` (read in place, recorded by `<LTspice library>/...` name and hash, and named
  in the copies by their quoted absolute path so LTspice reads exactly that file); an unquoted include name is the
  whole rest of the card, `;` included, as LTspice reads it. `A`
  devices are allowed (ADI's special functions; its own libraries use them); missing models and subcircuits are
  reported by LTspice. Schematics: symbols by absolute or escaping path refused in every `.asc` of the folder and every encoding LTspice reads; the schematic folder's .asc/.asy
  copied below `input/`, `LTspice -netlist` on the copy, the netlist checked as if next to the schematic. Runs
  `LTspice.exe -b <run folder>/effective.net` without a console window, with a deadline and a raw-size watchdog
  (twice the profile's points), parses the binary raw file (UTF-16LE header; real float64 axis + float32,
  `double`, complex float64 pairs, stepped with the axis restarting; partial/corrupt reported), names series as
  ngspice-tool (`v-sweep`, `onoise_spectrum`...), classifies the log (model, subckt, include, singular, convergence,
  netlist, engine, partial, corrupt, vector, limit -> failed, exit 3), runs sweeps and Monte Carlo as one `.step`
  run (`vera_point` with `table()` parameters; temperature ascending) and writes no absolute path into results
  (`<LTspice library>`, workbench-relative paths, file names). Verified with LTspice 26.1.1 on Windows 11
  (2026-11-13), including the same requests against ngspice-47.

- `scpi-instruments` 1.0.0, ecosystem `lab` (pack Embedded lab, group Bench instruments (SCPI), default on; activity
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
  checks pass print without a folder; meter and scope `close` confirm only that no output exists to energize. Verified offline on
  Windows 11 against a fake PyVISA and with VERA's real runner, and with the opt-in `VERA_SCPI_UV` run (real PyVISA
  1.16.2 + pyvisa-py 0.8.1 through the provisioner, TCPIP SOCKET to local simulated servers, 2026-11-13); no real
  instrument or native Ubuntu run yet.

- `lab-validation` 1.0.0, ecosystem `lab` (pack Embedded lab, group Measurement validation, default on; activity
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
  3 incomplete/error; printed documents at most 11 000 UTF-16 units. No network, process or language model. Verified
  on Windows 11 (toolchain CPython 3.12 and 3.11, VERA's real runner, real uv 0.11.25 provisioning, 2026-11-13); no
  real capture of a real circuit and no native Ubuntu run yet.

- `analysis-skills`1.0.0, general, Windows x64/Linux x64, is a format1 skills-only package with no
  programs or rules. Its firmware-comparator procedure and seven-section comparison template load
  through source plugin. It compares explicit captured runs with parse_log, documented conditions,
  release notes and criterion evidence, saves a session artifact and never operates hardware/tests.
  Test-planner adds a six-section sourced manual plan with one to five targeted cases and a baseline
  control when available; missing target/setup/criteria blocks readiness. Plugin commands are
  optional future instructions with risk levels, and todo records preparation, not measurements.
  Folder and bundled-catalog zip installation are covered by analysis-skills.test.ts and
  prepare-plugins.test.ts; actual SessionService/npm CLI replay lives in cli.test.ts. Separate
  opt-in real-model rubric/hashes/results live beside each skill under verification/.

- `esp32-efuse` 1.0.0, ESP32, Windows x64/Linux x64: the official Security (irreversible)
  group defaults off. Both espefuse and espsecure use pip esptool>=5,<6 and help-based version
  probes. summary/dump/check-error/get-custom-mac/adc-info are device-read; every burn-* plus
  write/read-protect-efuse and set-flash-voltage are irreversible with the OTP/brick note.
  espsecure file crypto is safe (hardware risk, no file sandbox); HSM flags are blocked.
  Three exact catalog lint exceptions cover program-name efuse/secure tokens at low risk.
  Skill esp32-efuse-review requires a summary, explanation, one explicitly requested operation
  and an artifact_save session plan before any irreversible call; no batch or implicit burns.
  Actual closed-stdin virtual argv includes --chip esp32 --virt --path-efuse-file FILE
  --do-not-confirm burn-efuse JTAG_DISABLE 1. The upstream BURN prompt is separate from VERA's
  burn-efuse confirmation; bypass creates mode decisions. tests/integration/esp32-efuse.test.ts
  optionally provisions real v5 using VERA_EFUSE_UV and records raw process output/exit codes,
  replay events, durable approvals and persistent virtual-state effects. No hardware burn runs.

- `git` 1.0.0 discovers user Git >=2.40 through PATH and standard Windows/Linux paths, without downloads. Fixed prefix/env plus the mandatory no-ext-diff execution guard neutralise fsmonitor, hooks, pager and external diff; an inert no-hooks/README.txt preserves the hooks directory in catalog zips. `optionSyntax: git` keeps option case/arity/boundaries for highest-risk rules, blocking executable aliases, configuration overrides and explicit helpers. Read inspections/listings are safe, mutations/remotes default to device-write, discard/force/delete paths irreversible. Skills git-inspect/git-commit/git-branches bound history, cite hashes, stage reviewed explicit paths, use messages and preserve conflicts. Git bypasses the write queue/Changes panel; run logs and the index watcher retain visibility. Local filters/textconv and other user Git configuration are not sandboxed. tests/integration/git.test.ts exercises actual catalog installation, native Git markers, replay Ask and controlled credential failure; Windows/Linux environment receipts name the actual platform.

- `stm32-cubeprog` 1.0.0, ecosystem `stm32` (STM32 pack, Programming (STM32CubeProgrammer), default on), Windows
  x64/Linux x64: find-only program `stm32_programmer_cli` (program names are lower case; Windows matches the file
  case-insensitively): Windows `%PATH%`, `%ProgramFiles%/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin`,
  `%SystemDrive%/ST/STM32CubeCLT*` and `STM32CubeIDE_*` plugins; Linux `~/STMicroelectronics/...`,
  `/usr/local/STMicroelectronics/...`, `/opt/st/stm32cubeclt*`, `/opt/st` and `~/st` STM32CubeIDE plugins, then
  `$PATH`, which finds only a lower-case stm32_programmer_cli link; hint with the st.com link (ST account required); `--version` probe
  without range; timeout 600 s; `optionSyntax: stm32cubeprog`. The projection folds every command (case-insensitive,
  exact names, measured on 2.23.0) to its canonical short name and adds `displ`/`<write>` for -ob/-otp/-psrss,
  `<write>` for core-register assignments, `debugauth` for any word starting debugauth except debugauth=2 (anywhere
  on the line), whole numbers (-1, -0x10) as arguments, `<list-only>` for
  board-free listings; a dash word the help does not spell exactly (the CLI accepts extra dashes and trims spaces)
  is `<unknown>` plus every command its name or its parts (split at any non-alphanumeric character) could mean; `word=` is allowed only after `-otp displ`. Rules: help/version/modifiers/host-file tools and `<list-only>` safe;
  connect, reads, verify, resets, core control and displays device-read; writes, erases, fill, go, core writes and
  wireless-stack start/delete device-write; option-byte writes, RDP/TZ regression and locks, OTP, keys, SFI/SSFI/SSP,
  IP modules, FUS upgrade, antirollback, security/default OB, product-state and OB-RSS changes, PMIC, debug
  authentication, HSM licenses and probe power irreversible (typed command); `-script` blocked. catalog.yaml reviews
  the `{-ob,-otp,-psrss} displ` rule for the `otp` token. Tests check every command of the recorded 2.23.0 help.

- `microchip-pymcuprog` 1.0.0, ecosystem `microchip` (Microchip pack, Programming (pymcuprog), default on), Windows
  x64/Linux x64: pip `pymcuprog>=3.19,<4` (probe `pymcuprog version (\d+(?:\.\d+)+)`, range `>=3.19,<4`), timeout
  300 s, `optionSyntax: pymcuprog`. The projection mimics pymcuprog 3.19.4.61's argparse (abbreviations, attached
  short values with one leading `=` dropped as argparse 3.12+ does, grouped short options, last-wins repeats, action anywhere, `-l` lists that run to the next option but take only an attached
  value, `--`) and returns the action (or `<none>`) plus `<info>`, `<protect>`, `<high-voltage>`, `<locked>`,
  `<unknown>`. Rules: help/version/release info and makeuf2 safe; ping/read/verify/reset/voltage reads device-read; write, erase,
  reboot-debugger, locked-device switches and unknown arguments device-write; writes to fuses, lockbits,
  config_words or all (the default memory), every hex-file write and protection-memory erases irreversible
  (typed action); setsupplyvoltage and any -H irreversible. Skills cover ping/flash/verify/read-back and
  single fuse changes. Opt-in VERA_MCU_UV provisions real pymcuprog, converts a hex file and fails a ping on a
  missing port; board acceptance is pending hardware.

- `can-python` 1.0.0, ecosystem `can` (CAN pack, Bus capture and transmit, default on), Windows x64/Linux x64:
  program `can` = `scripts/can_bus.py` on `python-can[serial,gs-usb,pcan,multicast]==4.6.1` (imports python-can
  lazily, so `--version` needs no dependency), timeout 300 s. `can list` prints `{configs, drivers}`:
  detected configs for pcan/vector/kvaser/slcan/gs_usb/socketcan and per-backend driver availability
  (ctypes library lookup, pyserial, libusb backend, Linux) with install hints; no bus opens. `capture`
  requires `--duration` or `--max-messages`, writes `.asc`/`.blf`/`.log` through `can.Logger` (text formats
  flushed per frame) or prints candump-style lines, and ends with `[can] N frames ... (mode) ..., stopped by
  duration|max-messages` on stderr. `send` (hex ID/data, extended, FD/BRS, count/period) and `replay`
  (`can.MessageSync` timing, `--ignore-timestamps`, `--max-messages`). Exit 0 done, 2 usage or refused capture
  before any bus opens, 3 open/IO failure with the backend hint. The first argument must be a command (a
  leading `--` would reach a subcommand on CPython 3.12+); every Bus gets `ignore_config=True` and digit-only
  channels are passed as integers (ignore_config skips python-can's casting); pcan, kvaser and gs_usb need --bitrate; the capture output must be new (removed again if the bus never opened); FD payloads use
  canonical lengths and --brs needs --fd; replay stops right after --max-messages. Rules: list/help/version
  safe, capture device-read, capture `--active` device-write, send/replay irreversible (confirm word =
  subcommand), backstop `can * {send,replay} *` irreversible.
- `can-dbc` 1.0.0, ecosystem `can` (DBC decoding, default on): pip `cantools>=45,<46` (version probe range
  `>=45,<46`; dump/list/convert/generate_c_source safe; decode/plot blocked because they read stdin, monitor
  blocked as an interactive view) and `can-decode` = `scripts/can_decode.py` on cantools 45.1.2 + python-can
  4.6.1: `--dbc --input [--id]... [--limit] [--no-choices] [--no-strict]`, one `time id message sig=value unit`
  line per decoded frame and a decoded/errors/unknown-ID summary; exit 2 for unreadable inputs; safe.
  Opt-in VERA_CAN_UV acceptance captures, transmits after typed words and decodes on udp_multicast; real
  adapters and Linux vcan0 remain unverified. Optional can-utils is not shipped.

- `wireshark-tshark` 1.0.0, ecosystem `wireshark` (own Wireshark pack, Capture analysis group, default
  on), Windows x64/Linux x64: find-only `tshark` (Windows `%PATH%` then `%ProgramFiles%/Wireshark/tshark.exe`;
  Linux `$PATH` then `/usr/bin/tshark`), never downloaded; missing shows the Wireshark/distribution hint with
  its download link. `--version` probe without a range (rules measured on 4.6.8), timeout 300 s.
  `optionSyntax: tshark` projects role tokens: `<info>` (-h/-v/-D/--list-sources, -G reports) and `<file>` (-r)
  safe; `<capture>` (-i/--source/-I/-L/--list-time-stamp-types, or neither -r nor info) device-read; `<unknown>`
  (unrecognised or ambiguous) device-write;
  `<execute>` (-X lua_script*) and `<credentials>` (-A) blocked. Skills wireshark-analyze (overview,
  filters, field export, statistics, frame citations) and wireshark-capture (tshark -D, confirmed interface,
  capture filter, -a duration or -c bound, saved .pcapng). Windows replay uses the real TShark and the
  generated sample; the opt-in VERA_TSHARK_LIVE_INTERFACE test captured self-sent loopback datagrams after
  approval on Windows/Npcap. Linux execution remains unverified. `-o extcap.*` credential values are not refused.

- `sigrok` 1.0.0, general, Windows x64/Linux x64/Linux arm64: provision the
  SHA-256-pinned DDP PulseView 66540df asset or use a local sigrok-cli fallback.
  An installed pinned executable takes precedence. AppImage arguments apply
  to managed downloads only and force extraction before CLI launch. The LAN HTTPS
  release is a proposed endpoint. Check the full `-L` log or the driver's
  `--show` output for fork-only drivers before a hardware
  workflow. Skills cover bounded srzip capture, background streaming, offline
  decoding, instrument reads and approved changes, and the Hantek/ATK drivers.

- `probe-rs` 1.0.0, general, Windows x64/Linux x64/Linux arm64: probe-rs exactly 0.32.0,
  PATH then ~/.cargo/bin discovery, explicit user-triggered SHA-256-pinned portable fallback.
  A found unsupported version reports range/unavailable and takes precedence over the download.
  All three official archive hashes/member layouts and Linux host headers are inspected. Four
  skills select probes/chips, flash/verify/reset the exact build ELF with approval hashes, stream
  background RTT and inspect SVD-defined registers/fault addresses. CAP-02 decode_register is used
  only if present; no such built-in tool is currently implemented. README carries CLI/source evidence.
  Hardware acceptance on Nucleo/ST-Link, RP2040/CMSIS-DAP and ESP32-C3/USB-JTAG on both systems and
  real RTT with closed stdin/down channels remains outstanding. Replay is explicitly simulated.

- `binutils` 1.0.0, general, windows-x64/linux-x64/linux-arm64: ten `arm-none-eabi-` and
  `riscv-none-elf-` programs (`size`, `nm`, `readelf`, `objdump`, `addr2line`), all safe. Per-program
  `--version` probes, timeout 60 s. Ordered PATH/ST/PlatformIO/Arduino/Zephyr/xPack discovery;
  only a user action installs a missing tool from SHA-256-pinned xPack ARM 15.2.1-1.1 or RISC-V
  15.2.0-1 archives, five entry points sharing each archive. Zephyr uses explicit alternate names;
  Espressif remains in esp32-idf. Three skills compare sections/symbol deltas, decode exact-build
  PC/LR with inline frames and inspect linker/flash mapping with bounded disassembly.
  Fixture source, linker script, DWARF4 ELFs and reproduction instructions are in tests/fixtures/elf.
  Windows/native Ubuntu x64 acceptance uses real local archives via VERA_BINUTILS_ARCHIVES;
  linux-arm64 archive hashes/members/AArch64 host headers are inspected, not executed.

- `serial-monitor` 1.0.0, ecosystem `general`, platforms `windows-x64`, `linux-x64`, program `serial` with
  `install: { script: scripts/serial_monitor.py }` (pyserial 3.5), probed with `--version`
  (`serial-monitor <version>`).
- Commands (spec `.agentic/specs/REQ-FUNC-42818bb7.md`): `serial list` prints a JSON array of `{port, vid_pid,
  serial_number, family, description, by_id}` sorted by port; `serial capture --port P [--baud 115200]
  [--duration 10] [--until REGEX] [--max-bytes 1048576] [--reset]` streams console bytes to stdout and ends with
  `[serial-monitor] P: N bytes, stopped by duration|until|max-bytes` on stderr; `serial send --port P --text LINE
  [--eol crlf|lf|cr|none] [--duration 1] ...` writes one line, then reads like capture.
- Exit codes: 0 done, 2 invalid arguments (no port opened), 3 port failure (EACCES adds the `dialout`/`uucp`
  instruction, others a list-again hint), 4 `--until` never matched.
- `esp32-esptool` 1.0.0, ecosystem `esp32`, `requires: [serial-monitor]`, program `esptool` with
  `install: { pip: "esptool>=5,<6" }`, resolved to `<runtime>/tools/esp32-esptool/bin/esptool[.exe]`, probed with
  `esptool version` (`v(\d+\.\d+\.\d+)`, range `>=5,<6`; any other version is unavailable with problem `range`),
  program timeout 120 s. Skill `esp32-flash`: port and chip first, offsets and images from `build/flasher_args.json`
  as explicit pairs, stop for encrypted or secure-boot builds, `Hash of data verified.` per file or `verify-flash`,
  boot log with `serial capture --port P --reset`.

## Invariants

- elec-calc sets `sys.dont_write_bytecode` and puts its own folder on `sys.path` before importing
  `elec_support`: a run writes nothing into the installed package, so the integrity hash holds. Requests are
  data only: the models are the fixed table `engine.MODELS` and nothing is evaluated from request text.
- elec-calc quantities need a unit (ratios may be bare numbers), prefixes are case-sensitive, absolute
  temperatures go through kelvin, unknown keys are refused and every problem found in one pass is reported.
  A duty cycle with an RMS or dc current, thetaJA with any case-path resistance and `iq` with
  `neglectIq: true` are `contradiction`; a missing Iq decision, a diode current without an average, switching
  data without a frequency and a Monte Carlo run without seed or distributions are `insufficient`. Core loss
  is never estimated and no datasheet value is scaled.
- `tolerance` always evaluates all 2^n corners (n <= 12) and the three-point `monotonic` check; Monte Carlo
  uses `random.Random(seed)`, draws parameters in sorted key order, Box-Muller normals, untruncated.
- `report` validates and computes every calculation first, refuses `.vera` and anything outside the working
  directory, creates the run folder and both files exclusively and removes every file and folder it created
  on a failure; `--input` is a regular file of at most 1 MiB inside the working directory, hashed again
  after a report.
- elec-calc paths are judged from their text before any file-system call: network and device paths, another
  drive and drive-relative paths are refused there (every command runs unapproved, so no path may make the
  system contact a host; on Windows a device name such as NUL is a device path by its text). A path inside
  the working directory by its text - under the directory's resolved name or the name it was entered by
  (`$PWD`) - is resolved with links followed and judged again; paths are at most 1024 UTF-16 units of valid
  Unicode without control characters, and the resolved relative `--input` or `--results-dir` path a document
  repeats is at most 1024 UTF-16 units as JSON writes it (an artifact path adds only the run id and the file
  name), so the output bound holds for Linux names with quotes or backslashes. On
  Windows a drive letter is compared with the resolved working directory's, so a `subst` or mapped drive
  letter counts as another drive. After the run folder is created it is resolved once more, so a results
  directory swapped for a link discards the report.
- No elec-calc input ends in a traceback or in `Infinity`/`NaN`: arithmetic errors and non-finite results
  are `domain`, values that overflow or vanish with their prefix are `number`, lone surrogates and
  over-long integers are `json`; both `json.dumps` calls forbid non-finite numbers. Detail tables are
  formatted only when a document is written, and tolerance evaluations skip the input record.
- `elec_support` is the single source of the quantity, result and report contracts; another plugin never
  imports it from this plugin's installed folder. Its path rules live in `elec_support/workspace.py`, which the kicad
  plugin carries as a byte-identical `kicad_support/workspace.py` (a test compares the two).
- kicad-tool runs kicad-cli only on a copy of the project in a temporary folder (`kicad-tool-*`) and never in the
  working directory: kicad-cli creates or rewrites `<project>.kicad_prl` in the folder of the file it reads
  (KiCad 10.0.8). The copy holds the bytes that were hashed: `<stem>.kicad_pro`, the root schematic and every sheet
  file reached (Sheetfile relative to the referencing schematic, inside the project folder), `<stem>.kicad_pcb`,
  `<stem>.kicad_dru`, the project's `sym-lib-table`/`fp-lib-table` and their `${KIPRJMOD}/` libraries, and relative
  drawing sheets (at most 2048 files, 512 MiB, 128 MiB per file, 64 MiB per parsed schematic, board or library table, 4096
  sheet instances).
  Every project file is copied at the path the project names for it, so links inside the folder keep working;
  that path and its resolved file must lie inside the project folder (a link out is refused, its "copy" would
  otherwise be the original), a sheet named by an absolute path, starting with `~` or climbing above the folder with `..` is
  refused, a project library or drawing sheet path on a network or device path, or holding `$` or `%`
  other than one leading KIPRJMOD (four spellings) or KiCad KICAD<n>_.../KISYS... token, is refused (an allow-list:
  KiCad expands variables in more spellings than a scanner follows), a Sheetfile holding `$` or `%` is refused, a
  library of any type but `KiCad` is refused (Table, Legacy, importers, HTTP, Database; every `type`/`uri` of an entry
  is checked, KiCad uses the last), a project text variable named KIPRJMOD/KICAD<n>_.../KISYS... or valued with two
  leading slashes, only slashes or a reference to another variable (`$`, `%` before a non-blank), or holding a NUL
  in its name or value (KiCad reads up to it), is refused, ordinary
  values (URLs, text, `1%`) are accepted, erc/review-report refuse a project that turns on ERC's simulation model check
  (only it opens model files, which may include any file; models are never copied), the board is parsed only by
  operations that read it, and a library-table library or a
  drawing sheet outside the folder is not copied, with a warning. Library tables obey the 64 MiB parse limit. After the last kicad-cli call every source is
  hashed again (a change is `source`, exit 3); only then is the run folder created exclusively and written; the
  temporary folder is removed in every case except a killed process.
- kicad-tool refuses before kicad-cli runs: a missing sheet file (KiCad's ERC would report zero violations), a file
  that is no well-formed S-expression (line and column), a KiCad 5 schematic or legacy board, a format version above
  KiCad 10's (schematic 20260306, board 20260206) or below KiCad 8's (20231120, 20240108), an export layer the board
  lacks (kicad-cli would plot the rest with exit 0), a missing or non-10 kicad-cli, a repeated option or flag. A KiCad
  8 or 9 version runs with a warning (converted in memory). The reader follows KiCad 10.0.8's two readers (observed):
  tokens split at space, tab, CR, LF (and NUL in schematics), a quote inside a word staying in it; control or
  Unicode space characters outside strings and escapes above 0x7F are refused; schematics, boards and netlists
  skip `#` comment lines (NUL counts as a blank) and undo KiCad's escapes (hex `\x2f`, octal, a backslash before
  other characters stays), strings ending on their line; library tables have neither. A sheet's file is its first
  `Sheetfile`/`Sheet file` property in ASCII letter case. `\??\` (NT prefix) counts as a device path. Unreadable or unparseable input (deep or huge JSON, NaN, Infinity or a repeated key in the
  project file, unreadable folders) is a `project` refusal, while a number token that is not finite reads as
  absent; any other failure after the copy is a `run` document (exit 3); no
  input ends in a traceback. Every message and warning is cut to 600 UTF-16 units; the fitter drops bulk lists
  before findings and facts and keeps every count, also of a review's ERC and DRC parts.
- kicad-tool builds every kicad-cli command line itself; it never passes `--save-board`, `upgrade`, `jobset`,
  `--define-var`, `--variant`, `--drawing-sheet` or `--exit-code-violations`, so any nonzero kicad-cli exit is a
  failure and violations are results with exit 0. Connectivity comes from KiCad's netlist; an instance is
  `<sheet tstamps><symbol tstamp>`; ERC object references come from KiCad's item descriptions (one pin UUID serves
  every instance of a repeated sheet). `erc` adds `duplicateReferences` and `duplicateCount`, kicad-tool's own check from
  the schematic files' per-instance references (the last `reference` of the symbol's `instances` entry for the
  path, unit else 1; a symbol without one is left out with a warning, as KiCad then uses another entry or its
  Reference field; power symbols, unannotated `R?` and empty instance references, which KiCad shows
  as `R?`, left out), because KiCad 10's ERC and netlist merge symbols that share a
  reference. kicad-tool locates kicad-cli in the manifest's order itself (PATH, then the
  Program Files folder from the known-folder API, newest KiCad folder first), because a script program receives no
  other program's path.

- can capture never opens a physical adapter actively by default: listen-only kwargs (pcan
  `state=PASSIVE`, vector/slcan `listen_only`, kvaser `driver_mode=False`), software buses
  (virtual, udp_multicast, socketcan `vcan*`) or a SocketCAN link that `ip -json -details` reports LISTEN-ONLY;
  everything else needs `--active`. The scripts are not named can.py/cantools.py so they never shadow packages.

- tshark parsing follows TShark: case-sensitive letters with the measured value letters, grouped flags,
  attached or separate values, exact-or-unique long abbreviations (ambiguous is `<unknown>`), and the end of
  options at the first non-option or `--`. Arguments after that end are still read for raising roles
  (capture, execute, credentials), never for `<info>` or `<file>`, so filter text cannot lower risk. Output
  files of safe commands (-w, --export-objects, --log-file) need no approval. The user's Wireshark profile
  Lua/binary plugins still load; argv rules cannot prevent that.

- Sigrok rules use the `sigrok-cli` option syntax to distinguish flags and values and
  classify output settings regardless of argument order. The CLI applies `--config`
  on reads and captures, so the manifest protects output-driving drivers and PWM
  groups in these forms as well as `--set`. An implicit driver with configuration is
  irreversible. Ask uses the typed approval gate. Exact raw argv is retained for
  the approval and launch.

- probe-rs rules use highest-risk-wins, including command tokens after global options. Version/help,
  chip/list safe; info/mi/read/verify/attach/profile/trace/reset device-read; download/run/erase/benchmark
  device-write; itm explicitly device-write for trace configuration; every write irreversible;
  debug/gdb/dap-server/serve/complete and every --host blocked.
  Help does not lower a dangerous match; --host=value is blocked. Unknown commands default device-write.
  Memory widths are b8/b16/b32/b64, read takes word count, write takes values, default hex-table.
  Background run/attach use existing program_output until and program_stop, closed stdin and tree kill.
  The package neither installs drivers/udev rules nor elevates. Xtensa ESP32/S2/S3 is in upstream
  0.32.0; vendor tooling remains for unverified features.

- esp32-idf is format 1, requires serial-monitor and detects user-installed EIM/IDF (`>=5.4,<7`).
  Its idf.py find search locates eim and invokes `run` with `launcherMode: string`. Official EIM 0.20.1
  on Windows and native Ubuntu takes one COMMAND string through PowerShell/Bash; the README records
  the measured platform quoting and its limits. VERA starts the launcher without a shell.
- Xtensa/RISC-V addr2line are local binaries found under IDF_TOOLS_PATH/default EIM roots; selection
  must match the target and exact flashed ELF. VERA never installs the vendor suite or drivers.
- idf.py build/size/configure commands are safe; coredump-info device-read; flash/app-flash/erase
  device-write; efuse-* and secure-* irreversible; monitor/menuconfig/gdb/gdbtui blocked with an
  explanatory note. Mixed flash+monitor is blocked. Skills change sdkconfig.defaults, never sdkconfig directly,
  verify effective generated values and require an agreed project regeneration workflow for already-set values.
- esp32-idf replay repairs a fixture compile error, rebuilds, performs fixture flash, captures Guru
  Meditation via serial-monitor/fake pyserial and decodes fixture addresses. Real ESP-IDF compile,
  flash, panic and source-line acceptance on both systems remains unverified without vendor tools/board.

- Rules: `serial {--version,--help,-h}` and `serial list *` are `safe`, `serial capture *` is `device-read` with a
  reset note, `serial send *` is `device-write` with a firmware note; any other command line keeps the platform's
  unmatched default `device-write`.
- `list` never opens a port. Capture and send open with DTR asserted and RTS released, then release DTR, so the
  lines never pass through the reset state DTR released + RTS asserted (Linux raises both lines on open; POSIX
  also `exclusive=True`); only `capture --reset` asserts RTS (200 ms, DTR re-applied after each RTS change for
  Windows usbser.sys) and clears the input buffer before releasing RTS, so the new boot output is kept.
- Any exception from the port (SerialException; OSError or termios.error on Linux; ValueError for an unsupported
  setting) is exit 3 with
  the bytes already read kept.
- Console bytes reach stdout unchanged and flushed per read, so background runs stream to `program_output`.
- `--until` is searched in each complete line and the current partial line (at most its last 4096 characters),
  decoded as UTF-8 with replacement characters and without a trailing CR.
- esp32-esptool rules (every command esptool 5.6.0 lists matches one; recorded help in
  `tests/fixtures/esp32-esptool/esptool-5.6.0-help.txt`): `esptool {version,--help,-h}` and `merge-bin`, `image-info`,
  `elf2image` safe; `chip-id`, `read-mac`, `flash-id`, `read-mem`, `read-flash-status`, `read-flash-sfdp`,
  `get-security-info`, `read-sdc-chip-info`, `verify-sdc-certificate`, `run`, and with a 1800 s timeout `read-flash`,
  `verify-flash`, `dump-mem` device-read ("Resets the chip into its bootloader."); `write-flash`, `erase-flash`,
  `erase-region` device-write with a 1800 s timeout, `load-ram` device-write; `write-mem`, `write-flash-status` and any
  `--force` irreversible (confirm word: the command, or `--force`). Global options may precede the command; the
  matcher's lowercase and `_`→`-` cover esptool v4 spellings. Other lines keep the default `device-write`.
- Safe esptool commands write host files (`merge-bin -o`, `elf2image -o`) without approval, like other safe programs.
- The script is not named `serial.py`: that name would make `import serial` load the script itself.
- The installed copy must not change after install (integrity hash): tests run installed copies with
  `PYTHONDONTWRITEBYTECODE=1`, and `uv run --script` executes the file as `__main__` without a bytecode cache.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| A calculation model, formula, check or limit | `plugins/electronics-calc/scripts/elec_support/{electrical,losses,thermal}.py`, spec REQ-DATA-3d15fdfc §5 | that model's group in `tests/fixtures/electronics-calc/cases.json`, derived by hand in its README |
| Units, prefixes, the quantity or result contract | `elec_support/quantities.py`, `contract.py` | "quantities" groups and the result-document test of `electronics-calc.test.ts` |
| Corners or Monte Carlo | `elec_support/tolerance.py` | tolerance groups and the Monte Carlo tests |
| Report files, path guards, command line | `elec_support/report.py`, `cli.py` | report tests (links, UNC, devices, exit 3) |
| Document size or layout | `elec_support/contract.py` `fitted`, `dumps` | output-limit test; every run asserts the bound |
| A new field of a model | the model function and `cli.py` `FIELDS` | help test (fixture field names must appear in the help) |
| Monte Carlo algorithm | `elec_support/tolerance.py` and `tests/fixtures/electronics-calc/montecarlo_reference.py` together | reference comparison test |
| elec-calc rules or skills | `plugins/electronics-calc/plugin.yaml`, `skills/` | rule matrix and package test |
| Path rules of the electronics plugins | `elec_support/workspace.py`, then copy it to `kicad_support/workspace.py` | electronics-calc report/path tests, kicad path tests, the byte-equality test |
| A kicad-tool operation or its summary | `plugins/kicad/scripts/kicad_support/operations.py` and the parser it uses (`netlist`, `board`, `checks`, `bom`, `exports`) | the operation's real-KiCad case in `kicad.test.ts` against `tests/fixtures/kicad/README.md` |
| A kicad-cli command line | `kicad_support/kicad.py` builders | "builds every kicad-cli call itself" (recorded calls) |
| Project files, copy, version checks | `kicad_support/project.py`, `sexpr.py` | project and format refusal tests, unchanged-sources and stop tests |
| A new KiCad release | `discovery.py` major, `project.py` newest format versions, the manifest range | regenerate the fixtures (`make_fixtures.py`) and rerun the real cases |
| probe-rs pins, risk rows, device guidance or RTT | `plugins/probe-rs/` | `probe-rs.test.ts`; real archive opt-in plus separately recorded bench acceptance |
| STM32 command map, rules or skills | `plugins/stm32-cubeprog/`, `shared/src/stm32-options.ts` | `stm32-cubeprog.test.ts` (matrix, recorded-help coverage, fake-host find, stub gate, real CLI where installed) |
| A new STM32CubeProgrammer release | re-record `tests/fixtures/stm32/STM32_Programmer_CLI-<v>-help.txt`, then `stm32-options.ts` and the rules | "classifies every command of a line" |
| pymcuprog roles, rules or skills | `plugins/microchip-pymcuprog/`, `shared/src/pymcuprog-options.ts` | `microchip-pymcuprog.test.ts` matrix and stub-resolver gate; `VERA_MCU_UV` real run |
| CAN commands, listen-only map, driver hints | `plugins/can-python/scripts/can_bus.py`, `plugin.yaml` | `can.test.ts` matrix, fake python-can script cases, gate; `VERA_CAN_UV` real udp_multicast acceptance |
| DBC decoding or cantools rules | `plugins/can-dbc/` | `can.test.ts`; fixtures `tests/fixtures/can/` |
| tshark roles, rules, find list or skills | `plugins/wireshark-tshark/`, `shared/src/tshark-options.ts` | `wireshark-tshark.test.ts` (matrix, fake find roots, real-TShark replay; skips without tshark) |
| A new TShark release | re-measure option arity with `tshark -r <file> -<letter>`, then `tshark-options.ts` | "classifies parsed tshark option roles" |
| IDF rules, launcher detection or decoder paths | `plugins/esp32-idf/plugin.yaml` | `esp32-idf.test.ts`, core `provisioning.test.ts` |
| Build repair or panic guidance | `plugins/esp32-idf/skills/` and README | `esp32-idf.test.ts` skill and replay cases |
| Risk rules or notes | `plugins/serial-monitor/plugin.yaml` `rules` | `serial-monitor.test.ts` "risk rules" |
| Family table, list fields, by-id | `serial_monitor.py` `FAMILIES`, `list_command`, `by_id_links` | "list" tests; `fixtures/serial-monitor/by_id.py` |
| Capture/send stop conditions, reset, exit codes | `serial_monitor.py` `read`, `reset`, `main`, `fail` | "capture", "send", "failures" tests |
| Agent guidance | `skills/serial-console/SKILL.md`, `skills/esp32-identify/SKILL.md` | "offers the plugin's skills" test |
| Fake port behaviour for tests | `fixtures/serial-monitor/fake-pyserial/serial/` | the whole file |
| esptool rules, notes, timeouts | `plugins/esp32-esptool/plugin.yaml` `rules` | `esp32-esptool.test.ts` "risk rules" |
| A new esptool release | re-record `fixtures/esp32-esptool/esptool-<v>-help.txt`, then rules and `version.range` | "names only esptool 5.6.0 commands" |
| Flashing guidance | `plugins/esp32-esptool/skills/esp32-flash/SKILL.md` | "offers esp32-flash" test |
| Stub esptool output | `fixtures/esp32-esptool/fake_esptool.py` | "in VERA" tests |

## Key behaviors

- `REQ-FUNC-5ddc54a6` / `REQ-SEC-79d36216` / `REQ-REL-29808598` — electronics-calc installs, every command safe, a run leaves the installed copy unchanged.
- `REQ-FUNC-1ae67789` / `REQ-DATA-ece2d69c` / `REQ-SEC-17f1e8d5` / `REQ-REL-20ece322` — kicad package, catalog and pack, safe kicad-tool and blocked kicad-cli, no bytecode in the installed copy.
- `REQ-DATA-c32834e3` / `REQ-SEC-85467169` / `REQ-SEC-40a76c91` / `REQ-REL-1ab91569` — kicad-tool command line and documents, shared path rules, built kicad-cli calls, 11 000-unit bound.
- `REQ-FUNC-9383047c` / `REQ-REL-24dba971` — KiCad 10 discovery and its refusal.
- `REQ-REL-09628127` / `REQ-REL-da746e30` / `REQ-REL-05743834` — work copy, discarded run on a changed source, KiCad failure apart from violations.
- `REQ-REL-c4b14f26` / `REQ-REL-426ec335` / `REQ-REL-3fe4718a` / `REQ-REL-f1bcbb19` / `REQ-REL-421726b7` — project, format and layer refusals, non-ASCII paths, library issues.
- `REQ-FUNC-57feb0b5` / `REQ-DATA-5ff34212` / `REQ-FUNC-fa7fc405` / `REQ-FUNC-c2f97c86` / `REQ-DATA-1adc8a2b` — hierarchy, instance identity, board facts, netlist, BOM.
- `REQ-FUNC-25b51df0` / `REQ-FUNC-0bf83952` / `REQ-FUNC-3c1c35b7` / `REQ-FUNC-fdd959d4` — ERC, duplicate references, DRC with its limit, zone refill on the copy.
- `REQ-FUNC-bad2229c` / `REQ-FUNC-9cb44e40` / `REQ-FUNC-bb443178` / `REQ-UX-f366d2db` — checked exports, review report, review skills.
- `REQ-TEST-07b48fde` / `REQ-PLAT-c30fa145` / `REQ-PLAT-10747605` — fictional fixtures; VERA run on Windows (opt-in `VERA_KICAD_UV`) and native Ubuntu (manual, pending).
- `REQ-DATA-3d15fdfc` / `REQ-DATA-f4cc4198` — format 1 result document; quantities with units and prefixes.
- `REQ-REL-6c99b9c7` / `REQ-REL-61e234ea` / `REQ-REL-7b943f73` — malformed requests, invalid quantities and out-of-domain values refused with exit 2.
- `REQ-FUNC-a7be6767` / `REQ-FUNC-9897d628` / `REQ-FUNC-fa29ca17` / `REQ-FUNC-49d4ab63` — dc, divider, RC and amplitude models.
- `REQ-FUNC-af6f7e42` / `REQ-REL-c4a6c310` / `REQ-FUNC-8943ed4c` / `REQ-REL-e2517e0e` — regulator loss with the explicit Iq decision; conduction from RMS or pulse, never duty on RMS.
- `REQ-FUNC-d476ec79` / `REQ-FUNC-0e71b135` / `REQ-FUNC-8cbe08aa` / `REQ-FUNC-da9b750b` / `REQ-FUNC-634a2c7e` — MOSFET, diode, resistor derating, ESR/DCR and power budget.
- `REQ-FUNC-29e71501` / `REQ-FUNC-452dd186` / `REQ-REL-003ccb83` / `REQ-FUNC-d1afe1f3` — thetaJA estimate, case path and heatsink sizing, no thetaJA mix, Foster transient.
- `REQ-FUNC-cd05145a` / `REQ-FUNC-4ac67c0d` / `REQ-REL-62a00f96` — corners, seeded Monte Carlo, explicit seed and distributions.
- `REQ-FUNC-a39b04ed` / `REQ-REL-8c73edc4` / `REQ-SEC-6c075f30` / `REQ-REL-fd2fa08d` — report files, all-or-nothing, confined paths, exit 3 with cleanup.
- `REQ-REL-c46a7e47` / `REQ-UX-b186323e` — documents within the runner's output limit; operation help with every field.
- `REQ-UX-e13eef8a` / `REQ-DATA-0f278063` / `REQ-UX-a7a3f2a9` — two skills; official entry in the Electronics design pack; `design` activity.
- `REQ-TEST-f4cf8c66` / `REQ-PLAT-c87a001f` / `REQ-PLAT-7f86133e` — ask-mode run without approval; real-uv Windows run (opt-in, passed 2026-11-12); native Ubuntu (manual, pending).

- `REQ-FUNC-6ea24516` / `REQ-REL-e4731e39` — STM32_Programmer_CLI discovery and install hint.
- `REQ-SEC-967391b8` / `REQ-SEC-08036a89` / `REQ-SEC-248961d6` — STM32 command classes, irreversible protection/security, blocked scripts.
- `REQ-UX-301c8fa4` / `REQ-TEST-6f33cbba` / `REQ-PLAT-b6e64a02` — STM32 skills, tests, Nucleo acceptance (pending).
- `REQ-FUNC-dd9f71eb` / `REQ-SEC-9dbe7de8` / `REQ-SEC-f626bf83` / `REQ-SEC-c2108ca1` — pymcuprog install, roles, protection and physical outputs.
- `REQ-UX-d3193aa3` / `REQ-TEST-9b1ed1aa` / `REQ-PLAT-35de3f5d` — Microchip skills, tests, UPDI board acceptance (pending).
- `REQ-FUNC-ed24ef4a` / `REQ-REL-07f029dd` — can list with driver hints; open failure exit 3 with the hint.
- `REQ-SEC-2eb33af8` / `REQ-SEC-9be4b959` — CAN and cantools risk rules.
- `REQ-FUNC-cd61ecee` / `REQ-REL-35df942b` / `REQ-FUNC-4adc847a` / `REQ-FUNC-835a17ea` — listen-only capture, --active refusal, send, replay.
- `REQ-REL-292d1dd5` / `REQ-REL-5edff0c2` — can usage errors exit 2 before any bus; unreadable can-decode inputs exit 2.
- `REQ-FUNC-7951af72` / `REQ-UX-c9e6cb02` / `REQ-TEST-c20cfbb9` — can-decode, three skills, opt-in multicast acceptance.
- `REQ-PLAT-e0466566` — real adapter and Linux vcan0 acceptance (pending hardware/host).

- `REQ-FUNC-3a49793a` / `REQ-REL-0cc3c9ba` — find-only TShark discovery with version, missing hint and no download.
- `REQ-SEC-3fa7a69c` / `REQ-SEC-4e0621b6` — tshark option-role risk; Lua scripts and -A credentials blocked.
- `REQ-UX-c68ec8b8` / `REQ-TEST-1fbadc3c` — analysis/capture skills; real-TShark replay of the sample capture.
- `REQ-PLAT-0b1587fd` — approved bounded live capture (opt-in loopback test; Windows run, Linux pending).
- `REQ-PLAT-c2323ad5` — capture-file analysis on Linux x64 (manual, pending a Linux host with tshark).

- `REQ-FUNC-19b10001` — exact 0.32.0 official package, ordered discovery and pinned portable fallback.
- `REQ-SEC-19b10002` through `REQ-SEC-19b10006` — all five risk levels and blocked-host escalation.
- `REQ-UX-19b10007` through `REQ-UX-19b1000a` — connect/flash/RTT/register skills.
- `REQ-PLAT-19b1000b` — real three-board workflow on Windows/Linux (pending hardware acceptance).

- `REQ-FUNC-20b10003` / `REQ-SEC-20b10004` — official binutils package, pinned find-first sources and safe analysis.
- `REQ-UX-20b10005` / `REQ-UX-20b10006` / `REQ-UX-20b10007` — size, crash and ELF inspection skills.
- `REQ-TEST-20b10008` — reproducible genuine ARM/RISC-V ELF corpus.

- `REQ-FUNC-10e10007` / `REQ-SEC-10e10008` — ESP-IDF package, vendor hints and risk rules.
- `REQ-UX-10e1000a` / `REQ-UX-10e1000b` — build-fix/panic skills and deterministic replay.
- `REQ-PLAT-10e1000c` — executed EIM transport; `REQ-PLAT-10e1000d` — outstanding real-board workflow.

- `REQ-FUNC-b7ceddbc` — the folder installs without issues; `serial` resolves to `uv run --quiet --offline --script <installed>/scripts/serial_monitor.py`.
- `REQ-FUNC-3e33dbe8` — `--version` prints the manifest version for the probe.
- `REQ-SEC-79b6adad` / `REQ-SEC-22dd5e18` / `REQ-SEC-5fd0ed52` — list/help safe, capture device-read, send device-write.
- `REQ-FUNC-e80e3dd7` / `REQ-FUNC-742426ac` / `REQ-PLAT-19d5189a` — JSON list without opening, family table, Linux by-id.
- `REQ-FUNC-42818bb7` / `REQ-FUNC-3ee59f30` / `REQ-REL-46027e04` — capture stop conditions and summary, RTS reset, exit 4.
- `REQ-FUNC-6f7569e2` — send one line, then read the reply.
- `REQ-PLAT-4013192c` / `REQ-REL-3c25e5c0` / `REQ-FUNC-0a001d5d` — EACCES group instruction, other failures, usage errors.
- `REQ-UX-7dc52524` — skills `serial-console` and `esp32-identify`.
- `REQ-TEST-4041b893` — a replay session lists without approval and captures after approval through the real runner.
- `REQ-PLAT-f215472a` — real ESP32-S3 and ESP32+CP210x boards on Windows 11 and Ubuntu (manual).
- `REQ-FUNC-b0d7c102` / `REQ-FUNC-3b4c7274` / `REQ-REL-a69bbfc4` — esptool installs from pip, its version probe, versions outside 5.x unavailable.
- `REQ-SEC-bfed58fa` / `REQ-SEC-c8cf4a75` / `REQ-SEC-b3fe3c10` / `REQ-SEC-d1d8978f` — esptool safe, device-read, device-write and irreversible rules.
- `REQ-SEC-9c665082` — the rules name only esptool 5.6.0 commands and classify all of them.
- `REQ-FUNC-a3a042ec` — flash transfers may run 1800 s.
- `REQ-UX-6a22c4dc` — skill `esp32-flash`.
- `REQ-TEST-fe972de0` — a replay session identifies, flashes with image hashes on the card and captures the boot log.
- `REQ-PLAT-d2b3fa4a` — real boards on Windows 11 and Ubuntu (manual).
- `REQ-DATA-b4e317de` / `REQ-SEC-f98d4fd3` (Plugins) — write-flash approvals list each image's SHA-256; a rebuilt image fails CONFLICT.
- `REQ-SEC-016c9aad` (Plugins) — a background capture makes another run naming its port BUSY.

## Files

- `05_Software/plugins/electronics-calc/` — manifest, README (interface, limits), `scripts/elec_calc.py` (entry), `scripts/elec_support/` (`quantities`, `contract`, `waveforms`, `electrical`, `losses`, `thermal`, `tolerance`, `report`, `engine`, `cli`), skills electronics-sizing and thermal-analysis.
- `05_Software/plugins/kicad/` — manifest, README, skills schematic-review and pcb-review, `scripts/kicad_tool.py` (entry), `scripts/kicad_support/` (`workspace` shared, `sexpr`, `discovery`, `project`, `kicad`, `netlist`, `board`, `checks`, `bom`, `exports`, `review`, `document`, `operations`, `cli`).
- `05_Software/tests/integration/kicad.test.ts`, `tests/fixtures/kicad/` (`hier`, `erc`, `board` projects, `make_fixtures.py`, README with the design-derived expectations, `internals.py` seams).
- `05_Software/tests/integration/electronics-calc.test.ts`, `tests/fixtures/electronics-calc/` (`cases.json`, README with the hand derivations, `montecarlo_reference.py`, `odd_name.py`, `internals.py`) — package, rules, numeric and refusal cases, output limit, help, Monte Carlo against the independent reference, report, path guards, exit 3, integrity, replay session, opt-in real uv.

- `05_Software/plugins/stm32-cubeprog/` — manifest, README (risk table, parsing, limits), skills stm32-flash and stm32-option-bytes.
- `05_Software/src/libraries/shared/src/stm32-options.ts`, `05_Software/tests/integration/stm32-cubeprog.test.ts`, `tests/fixtures/stm32/` (recorded 2.23.0 help, blink.hex) — projection and tests.
- `05_Software/plugins/microchip-pymcuprog/` — manifest, README (risk table, argument parsing, limits), skills microchip-flash and microchip-fuses.
- `05_Software/src/libraries/shared/src/pymcuprog-options.ts`, `05_Software/tests/integration/microchip-pymcuprog.test.ts`, `tests/fixtures/microchip/app.hex` — projection, matrix, gate, opt-in real run.
- `05_Software/plugins/can-python/` — manifest, README (drivers, listen-only), `scripts/can_bus.py`, skills can-capture and can-transmit.
- `05_Software/plugins/can-dbc/` — manifest, README, `scripts/can_decode.py`, skill can-decode.
- `05_Software/tests/integration/can.test.ts`, `tests/fixtures/can/` — rules, stdlib fake python-can (`fake-python-can/can`, records Bus kwargs and frames), typed gate with a fake uv, fictional DBC and candump log, opt-in real acceptance.

- `05_Software/plugins/wireshark-tshark/` — manifest, README (risk table, capture setup, limits) and two skills.
- `05_Software/src/libraries/shared/src/tshark-options.ts` — tshark role projection for rules only.
- `05_Software/tests/integration/wireshark-tshark.test.ts`, `tests/fixtures/wireshark-tshark/` — risk matrix,
  find/hint with a fake host, generated CoAP/Modbus `sample.pcapng` (`build.py`) and real-TShark replay.

- `05_Software/plugins/probe-rs/` — manifest, four skills and measured upstream evidence/limits.
- `05_Software/tests/integration/probe-rs.test.ts`, `tests/fixtures/probe-rs/replay.mjs` — exhaustive
  risk matrix, discovery/range, installed skills, exact-ELF approval/refusal, real closed-stdin
  fixture RTT and optional real local-archive CLI acceptance.

- `05_Software/plugins/binutils/` — manifest, measured source pins README and three skills.
- `05_Software/tests/integration/binutils.test.ts`, `tests/fixtures/elf/` — genuine cross-architecture corpus, fake-root discovery and real offline archive/replay acceptance.

- `05_Software/plugins/esp32-idf/` — manifest, measured EIM transport README, build-fix and panic skills.
- `05_Software/tests/integration/esp32-idf.test.ts`, `tests/fixtures/esp32-idf/` — deterministic vendor executable/parser and session replay; no hardware or network.

- `05_Software/plugins/serial-monitor/plugin.yaml` — manifest: program `serial`, version probe, rules, docs.
- `05_Software/plugins/serial-monitor/scripts/serial_monitor.py` — PEP 723 script: list, capture, send.
- `05_Software/plugins/serial-monitor/skills/serial-console/SKILL.md` — how to use the program.
- `05_Software/plugins/serial-monitor/skills/esp32-identify/SKILL.md` — identifying ESP32 boards and bridges.
- `05_Software/plugins/serial-monitor/README.md` — catalog description.
- `05_Software/tests/integration/serial-monitor.test.ts` — package, rules, script behaviour, guard, replay session, skills.
- `05_Software/tests/fixtures/serial-monitor/fake-pyserial/` — fake `serial` package driven by `FAKE_SERIAL_SCENARIO`, recording to `FAKE_SERIAL_RECORD`.
- `05_Software/tests/fixtures/serial-monitor/by_id.py` — runs `list` with a test by-id folder.
- `05_Software/tests/fixtures/serial-monitor/esp32s3-boot.log` — sample ESP32-S3 boot log.
- `05_Software/plugins/esp32-esptool/plugin.yaml` — manifest: program `esptool` (pip), version probe, rules, docs.
- `05_Software/plugins/esp32-esptool/skills/esp32-flash/SKILL.md` — identify, flash from flasher_args.json, verify, boot log.
- `05_Software/plugins/esp32-esptool/README.md` — catalog description.
- `05_Software/plugins/packs.yaml`, `catalog.yaml` — packs and the maintainers' file of the catalog source.
- `05_Software/plugins/CONTRIBUTING.md`, `.ci/catalog.yml` — contribution guide and CI template for `vera-plugins`.
- `02_Tools/environment/prepare-plugins.mjs` — builds and checks the bundled catalog release.
- `05_Software/tests/integration/esp32-esptool.test.ts` — package, provisioning, rules, replay session, skill.
- `05_Software/tests/fixtures/esp32-esptool/fake_esptool.py` — stub esptool a fake uv installs as the pip entry point (distlib `.exe` launcher on Windows); records arguments and file hashes.
- `05_Software/tests/fixtures/esp32-esptool/esptool-5.6.0-help.txt` — recorded `esptool --help` of 5.6.0.
- `05_Software/tests/fixtures/esp32-esptool/flasher_args.json` — ESP-IDF esp32s3 hello_world flash layout.

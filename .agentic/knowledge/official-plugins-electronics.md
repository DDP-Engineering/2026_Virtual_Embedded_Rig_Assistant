# Official plugins: electronics calculation, parts and SPICE simulation

## Routing

Select for `electronics-calc` (program `elec-calc`, a standard-library PEP 723 script for electrical and thermal
calculations; skills electronics-sizing and thermal-analysis); `parts-search` (the `parts-compare` standard-library
script that compares candidates on datasheet evidence and writes a comparison and proposed BOM, with VERA's
`parts_search` tool for supplier catalogs; skills component-selection and component-families); `ngspice` (the ngspice
engine, found or on Windows the pinned official ngspice-47 7z, and the `ngspice-tool` script that checks netlists
before the engine and runs validate, run, sweep, measure, compare and report; skill circuit-simulation); and `ltspice`
(Windows only: find-only LTspice 26 or newer and the `ltspice-tool` script that checks netlists and schematics before
LTspice runs, with ngspice-tool's request model plus convert; skill ltspice-simulation).

For electronics-calc, start at plugins/electronics-calc/plugin.yaml, scripts/elec_calc.py and
scripts/elec_support/ with spec .agentic/specs/REQ-DATA-3d15fdfc.md; tests/plugins/electronics-calc.test.ts
and tests/fixtures/electronics-calc/ own its numeric, refusal, report, integrity and session coverage.

For parts-search, start at plugins/parts-search/plugin.yaml, scripts/parts_compare.py and scripts/parts_support/
with spec .agentic/specs/REQ-DATA-6b26f2a5.md; tests/plugins/parts-search.test.ts and
tests/fixtures/parts-search/ (hand-derived README) own its evidence, identity, pricing, refusal and provisioner
coverage. Its supplier search is VERA's own tool, see [parts search](parts-search.md).

For ngspice, start at plugins/ngspice/plugin.yaml, scripts/ngspice_tool.py and scripts/ngspice_support/ with spec
.agentic/specs/REQ-DATA-29b9a988.md; tests/plugins/ngspice.test.ts and tests/fixtures/ngspice/ (analytic
references and tolerances in its README, hostile netlists) own its refusal, real-engine and provisioner coverage.

For ltspice, start at plugins/ltspice/plugin.yaml, scripts/ltspice_tool.py and scripts/ltspice_support/ (netlist.py
for the LTspice dialect checks, raw.py for raw files, engine.py, schematic.py) with spec
.agentic/specs/REQ-DATA-0f9e36a3.md; tests/plugins/ltspice.test.ts and tests/fixtures/ltspice/ (references and
tolerances in its README, hostile files, raw files written by LTspice 26.1.1) own its coverage. Its workspace.py,
measure.py and sweep.py are byte-identical copies of ngspice-tool's.

The conventions shared by all official plugins (package format, catalog source, packs, versions and evidence
levels) and the page of every other plugin are in [Official plugins](official-plugins.md). The platform that
installs, classifies, approves and runs these programs is [Plugins](plugins.md); plugin skill discovery is
[Skills](skills.md).

## Public interface

- `electronics-calc` 0.3.0, ecosystem `electronics` (Electronics design pack, Calculations, default on;
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
  Every documented command is safe, with rule timeouts of 600 s for tolerance and 1800 s for report; anything else keeps the default device-write. Exact names and formulas:
  spec `.agentic/specs/REQ-DATA-3d15fdfc.md`. Evidence: Windows with the toolchain Python, a direct
  `uv run --offline --script` and the opt-in `VERA_ELEC_UV` run (provisioner with a real uv and a managed
  CPython); native Ubuntu has not been run.

- `parts-search` 0.3.0, ecosystem `electronics` (Electronics design pack, group Component selection, default on;
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
  tool `parts_search` (see [parts search](parts-search.md)). Evidence: Windows 11 with the toolchain Python and
  the opt-in `VERA_PARTS_UV` run (real uv, managed CPython); native Ubuntu has not been run.

- `ngspice` 0.3.0, ecosystem `electronics` (Electronics design pack, group Simulation (ngspice), default on; activity
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
  folder exists removes it. Evidence: ngspice-47 on
  Windows 11, including the opt-in `VERA_NGSPICE_UV` provisioner install of the 7z; native Ubuntu
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
  (`<LTspice library>`, workbench-relative paths, file names). Evidence: LTspice 26.1.1 on Windows 11,
  including the same requests against ngspice-47.

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

## Key behaviors

- `REQ-FUNC-5ddc54a6` / `REQ-SEC-79d36216` / `REQ-REL-29808598` — electronics-calc installs, every command safe, a run leaves the installed copy unchanged.
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
- `REQ-TEST-f4cf8c66` / `REQ-PLAT-c87a001f` / `REQ-PLAT-7f86133e` — ask-mode run without approval; real-uv Windows run (opt-in); native Ubuntu (manual, pending).

## Files

- `05_Software/plugins/electronics-calc/` — manifest, README (interface, limits), `scripts/elec_calc.py` (entry), `scripts/elec_support/` (`quantities`, `contract`, `waveforms`, `electrical`, `losses`, `thermal`, `tolerance`, `report`, `engine`, `cli`), skills electronics-sizing and thermal-analysis.
- `05_Software/tests/plugins/electronics-calc.test.ts`, `tests/fixtures/electronics-calc/` (`cases.json`, README with the hand derivations, `montecarlo_reference.py`, `odd_name.py`, `internals.py`) — package, rules, numeric and refusal cases, output limit, help, Monte Carlo against the independent reference, report, path guards, exit 3, integrity, replay session, opt-in real uv.

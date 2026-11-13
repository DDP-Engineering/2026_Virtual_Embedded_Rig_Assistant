# REQ-DATA-29b9a988 — ngspice plugin: engine, ngspice-tool 1.0.0 and the two platform extensions

The official plugin `ngspice` (`05_Software/plugins/ngspice/`) runs reproducible local circuit simulations. Program
`ngspice` is the engine (found, or on Windows the pinned official build); program `ngspice-tool` is a
standard-library PEP 723 script (`scripts/ngspice_tool.py`, support package `scripts/ngspice_support/`) that
validates a netlist and its includes, runs the engine in batch mode on a copy in a new run folder and evaluates the
results. Observations below were made with ngspice-47 on Windows 11 (2026-11-13).

## 1 Platform extensions

- **`.7z` downloads (Windows only).** A `download` entry whose URL path ends in `.7z` has the form `7z`; manifest
  validation accepts it only under `windows-x64`. It is extracted like a tar archive with System32 `tar.exe` (bsdtar,
  libarchive with liblzma) after the SHA-256 check. bsdtar exit 1 is accepted only when its complete output (within the
  first 64 KiB) holds at least one skip notice and consists only of lines `tar.exe: Archive entry has empty or unreadable filename ... skipping` and
  `tar.exe: Error exit delayed from previous errors` - entries whose non-ASCII names Windows cannot represent are left
  out; any other output, exit code or a missing declared `path` is the `archive` problem.
- **`uses`.** A program may declare `uses: [<program>...]` (1..8 names of `find`/`download` programs of the same
  plugin, not itself). When VERA resolves such a program it also resolves each used program; the run receives
  `VERA_PROGRAM_<NAME>` (name upper-cased, `-` and `.` -> `_`; two used names may not share a variable) with the used
  program's absolute executable path. If a used
  program does not resolve, the program does not resolve either ("not installed").

## 2 Programs and rules

- `ngspice`: find on Windows `C:/Spice64/bin/ngspice_con.exe`, `%ProgramFiles%/Spice64/bin/ngspice_con.exe`,
  `%LOCALAPPDATA%/Programs/Spice64/bin/ngspice_con.exe` (a `%PATH%` search looks for `ngspice.exe`, the GUI build);
  on Linux `$PATH` (`ngspice`), `/usr/bin/ngspice`, `/usr/local/bin/ngspice`. Download (Windows
  x64): `https://downloads.sourceforge.net/project/ngspice/ng-spice-rework/47/ngspice-47_64.7z`, SHA-256
  `59225971bd68cdd1199443649aa4615a9e6d684933f205ab49006a3942518f5a`, path `Spice64/bin/ngspice_con.exe`. Version probe
  `-v`, match `ngspice-(\d+)`, range `>=42`. Rule: every `ngspice *` command is blocked (a netlist's control block can
  run shell commands and write files) with a note pointing to ngspice-tool; overlapping rules take the highest risk, so
  version and help are not exempt - ngspice-tool reports the engine version and VERA's probe runs without rules.
- `ngspice-tool` (`uses: [ngspice]`): `ngspice-tool {--version,--help,-h}` and
  `ngspice-tool {validate,run,sweep,measure,compare,report} *` safe; timeout 1800 s.
- Licence (recorded in the README): ngspice is Modified BSD, with LGPLv2 (KLU, numparam, tclspice), MPLv2.0 (OSDI),
  GPLv2+ (XSPICE table) parts and the manual under CC-BY-SA 4.0 (`Spice64/docs/COPYING`). VERA downloads it from the
  official source at the user's action and never redistributes it or any model.

## 3 Command line

```text
ngspice-tool --version | --help | -h
ngspice-tool validate --netlist FILE
ngspice-tool run      (--json TEXT | --input FILE) [--run-id ID] [--results-dir DIR]
ngspice-tool sweep    (--json TEXT | --input FILE) [--run-id ID] [--results-dir DIR]
ngspice-tool measure  --run DIR (--json TEXT | --input FILE) [--run-id ID] [--results-dir DIR]
ngspice-tool compare  --run DIR --run DIR [--run-id ID] [--results-dir DIR]
ngspice-tool report   --run DIR [--run DIR]... [--title TEXT] [--run-id ID] [--results-dir DIR]
```

Path, run-id, input-file, output-size (11 000 UTF-16 units printed) and results-directory rules are those of
`elec-calc` (spec REQ-DATA-3d15fdfc §1, §4, §8) through a byte-identical copy of `workspace.py`; default results
directory `electronics-results`. Exit codes: 0 completed (criteria may fail), 2 refused (arguments, request, netlist,
limits - nothing ran), 3 failed (the engine failed or timed out, an input changed, output could not be written).

## 4 Netlist rules (validate, and before every engine run)

- Text: UTF-8 (a BOM is skipped), at most 4 MiB per file, 16 MiB and 256 files per chain, include depth 16. The first
  line is the title; ngspice acts on some cards even there, so the effective copy replaces it with
  `ngspice-tool effective netlist` and the result keeps the original as `title`. A line whose first visible character
  is not a letter or digit and whose second is `#` (`*#`, `;#`, `$#`, `!#`, ...), anywhere in the chain except the
  replaced title, is refused: ngspice reads `*` and the punctuation it turns into `*` as a comment mark and runs such a
  line as a control command. A logical line joins `+` continuation lines; `*` lines are comments; `;` and `$ ` start inline
  comments. Cards are compared without letter case.
- Allowed dot cards: `.title .include .inc .lib .endl .param .func .subckt .ends .model .global .option .options .opt
  .ic .nodeset .temp .save .csparam .end`. Analysis and output cards (`.op .dc .ac .tran .noise .tf .sens .pz .disto
  .sp .pss .four .meas .measure .print .plot .probe .width`) are dropped from the effective copy with a warning - the
  request's analysis runs. Any other dot card - `.control`, `.endc`, `.exec` and unknown ones - is refused. A line that
  contains `pre_osdi`, `osdi`, `codemodel` or `shell` as a word is refused (`source` is a usual MOSFET node name, and
  control commands only run inside the refused `.control` block).
- Elements: the first letter is one of `R C L K V I E F G H B D Q J M X S W T O U Y N P Z`. `A` (XSPICE code-model
  instances) is refused: `d_process` and `d_cosim` start programs or load libraries and file models read any path.
  A value written with an upper-case `M` suffix (`1M`) gives a warning: SPICE reads it as milli (`MEG` is mega). `D` (2 nodes), `J`,
  `Z` (3), `Q` (3 or 4), `M` (4), `S` (4), `W` (2 nodes and a source) name a model that a `.model` card of the chain
  defines; `X` names a `.subckt` of the chain whose port count equals the instance's node count. Otherwise the netlist
  is refused (`model`, `subckt`, `pins`).
- Includes: `.include PATH`, `.inc PATH`, `.lib PATH SECTION` (quoted or not), relative to the including file's folder;
  each resolves inside the working directory (rules of workspace.py), never a network,
  device or other-drive path. The effective copy rewrites each to the copied file's path in the run folder.
- `validate` prints the title, the files with role, bytes, SHA-256 and the leading comment lines of each file (up to
  five, its stated provenance or licence), the subckts with ports, the models, the dropped cards, the
  `.option` cards as written, and every problem; it never starts the engine.

## 5 Run request (run, and the base of sweep)

```json
{"netlist": "circuits/buck.cir",
 "analysis": {"kind": "tran", "step": "1 us", "stop": "2 ms", "start": "0 s"},
 "temperature": "27 °C", "parameters": {"RLOAD": "10"},
 "vectors": ["v(out)", "i(Vsense)"],
 "measurements": [{"id": "ripple", "kind": "peak-to-peak", "vector": "v(out)", "window": {"from": "1 ms", "to": "2 ms"}},
                  {"id": "loss", "kind": "average-power", "voltage": "v(sw,out)", "current": "i(Vsense)", "window": {"from": "1 ms", "to": "2 ms"}}],
 "criteria": [{"measurement": "ripple", "op": "<=", "value": "50 mV"}],
 "profile": "standard", "timeLimit": "120 s"}
```

- Every failure after the run folder exists (an input that changed or vanished, a write error, any defect) removes
  the folder and exits 3.
- Analyses: `op`; `dc` {source, start, stop above start, step}; `ac` {sweep: dec|oct|lin, points, start, stop}; `tran` {step,
  stop, start?, maxStep?}; `noise` {output, source, sweep, points, start, stop} - noise writes `onoise_spectrum` and
  `inoise_spectrum`; a run whose output noise is zero everywhere (no noise generators) has status `not-applicable`
  (exit 0, measurements as computed).
- Quantities are a number with an optional SI prefix (`p n u µ m k M G`) and unit (`s Hz V A °C K Ω ohm W`), or a bare
  number; the effective netlist receives plain numbers.
- Vectors: 1..32 of `v(n)`, `v(n,m)`, `i(Vname)`, `vdb(n)`, `vm(n)`, `vp(n)`, `vr(n)`, `vi(n)` with node and source
  names of `[A-Za-z0-9_.#:+-]` (1..64).
- `parameters` override `.param` values with `alterparam` and `reset`; `temperature` sets `option temp`.
- Effective control block, appended by the helper only: `set wr_singlescale`, `set wr_vecnames`, `set numdgt=10`,
  the parameter and temperature commands, the analysis, `wrdata series.dat <vectors>`, `quit`. The engine runs as
  `ngspice -b -n effective.cir` (batch, no `.spiceinit`) with the run folder as working directory and its log captured.
- Profiles: `standard` - at most 1 000 000 transient points (stop/step), 100 000 DC or AC points, 32 vectors,
  `timeLimit` default 120 s, at most 600 s; `long` - 5 000 000 points, `timeLimit` at most 1700 s. Beyond a limit the
  request is refused before the engine runs.

## 6 Results

- Engine outcome: `ok` when the exit code is 0, `series.dat` exists with the requested columns and the log has no
  line `Error`, `singular matrix`, `no convergence`, `Timestep too small` or `could not find`; otherwise `failed` with
  problems {kind: convergence | singular | model | vector | engine, line} quoting the log lines. A helper time limit
  kills the engine (it starts no child process: shell, code loading and code models are refused) and gives `timeout`.
  ngspice writes its series only at the end of a run, so a stopped or timed-out run has no partial series: its result
  says `timeout` and keeps the log; a run VERA stops leaves no `result.json`. A failed or timed-out run keeps its log and effective netlist, has no
  measurements or criteria pass (all `not-evaluated`) and exits 3.
- Series: `series.csv` (UTF-8, header from the engine's vector names; AC complex vectors as `<name> re` and
  `<name> im`), `plot.svg` (one polyline panel per vector, linear axes, log frequency axis for AC).
- Measurements: `min`, `max`, `average`, `rms` (time- or frequency-weighted by the trapezoid rule over the window,
  with values interpolated at the window's edges),
  `peak-to-peak`, `ripple` (peak-to-peak within its required window, which the request starts after settling), `overshoot` (percent
  of the step from the window's first to its final value), `settling` (first time after which the vector stays within
  ±band of its final value), `value-at` (linear interpolation at a point), `final`, `average-power` (time average of
  `voltage × current` over the window; positive means the element absorbs power when `current` flows into the node
  that `voltage` names first, which the result states). A window outside the series, fewer than 2 points or a vector
  not in the series gives `unknown` with a reason.
- Units of measurements: `V` for voltages and `vm`/`vr`/`vi`, `dB` for `vdb`, `rad` for `vp`, `A` for currents,
  `V/sqrt(Hz)` for noise spectra, `W` for average power, `%` for overshoot and `s` for settling.
- The log line `Circuit: <name>` echoes the circuit's name and is not classified.
- Criteria: {measurement, op <=|>=|==, value with tolerance?} -> `pass`, `fail` or `unknown` (measurement unknown).
- `result.json`: `format: 1`, `kind: "ngspice-tool-result"`, tool, ngspice {executable, version}, operation, runId,
  times, status, request {origin, sha256, path?}, inputs [{path, role, bytes, sha256}], analysis, temperature,
  parameters, title, droppedCards, options (as written), engine {exit, seconds, problems}, series {file, rows, columns},
  measurements, criteria, warnings, limits, artifacts. `report.md` presents the same. The run folder also holds
  `input/` (the copies), `effective.cir` and `ngspice.log`. All of it is written into a new run folder; a write failure
  or an input that changed during the run removes what the run created.
- `sweep`: the run request plus `sweep` {parameter | "temperature", values 1..100} or `monteCarlo` {seed, runs 1..200,
  tolerances {param: {nominal, percent, distribution: uniform | gaussian}}}; one engine run per point in
  `points/<n>/`; the result lists each point's inputs (seed and drawn values) and measurements, and per measurement min,
  max, mean and the criteria pass count. A whole sweep has 1700 s: each point's time limit is cut to what remains, and
  points that no longer fit are `not-run` with status `timeout`.
- `measure`: applies measurements and criteria to the series of an existing run folder (hash checked) in a new run
  folder; no engine.
- `compare`: two run folders -> the differences of netlist hashes, analysis, temperature, parameters, sweep settings
  (seed) and each point's drawn values, and the measurement deltas (a sweep's per-measurement means).
- `report`: one or more run folders -> `report.md` and `report.json` summarizing their status, measurement values and
  criteria.
- `measure`, `compare` and `report` check every artifact of a source run folder against its SHA-256; `measure` accepts
  the run's own vectors (a complex AC vector by its name, measured as magnitude; noise spectra by name).

## 7 Solver options

The helper adds no `.option` and changes no solver tolerance; the netlist's `.option` cards are reported as written. A
non-converging run is reported, never retried with other settings.

## Acceptance

E04-A (divider, RC filter, half-wave rectifier vs analytic references with tolerances declared in the fixture README),
E04-B (switch circuit: v(t), i(t), average power in a declared window; RC thermal network 1 W, 50 K/W, 40 °C ->
90 °C as elec-calc), E04-C (missing model, pin mismatch, non-convergence, missing vector: no pass), E04-D (seeded
sweep/Monte Carlo reproducible; compare names changes), E04-E (hostile netlists refused before the engine; inputs
unchanged), E04-F (real batch runs, Stop and timeout on Windows; native Ubuntu recorded).

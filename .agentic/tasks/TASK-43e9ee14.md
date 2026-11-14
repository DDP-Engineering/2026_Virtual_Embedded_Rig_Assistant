# TASK-43e9ee14 - ELEC-05 ltspice plugin: LTspice batch simulation on Windows in the common result model (#97)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-0f9e36a3, REQ-FUNC-285b6fcc, REQ-REL-d17ee05f, REQ-FUNC-40bcbc04, REQ-SEC-e5b9df02, REQ-SEC-c2953ca4, REQ-FUNC-0a9592c1, REQ-FUNC-8e093f1b, REQ-FUNC-08dc4fb1, REQ-FUNC-e6f31b12, REQ-DATA-d4d85a22, REQ-REL-97287e21, REQ-FUNC-e90dd7e9, REQ-REL-517e9feb, REQ-REL-f14fbe8e, REQ-REL-d20f53a0, REQ-SEC-91ca52fe, REQ-PLAT-590b1e69, REQ-TEST-99244ca8, REQ-TEST-c6909384, REQ-FUNC-52c19a19, REQ-FUNC-52bb81f2, REQ-FUNC-7785cea9, REQ-FUNC-2aa76757, REQ-FUNC-457a6e05, REQ-FUNC-079e7b77, REQ-REL-223a0738
parent:
branch: feature/93-electronics-calc
base: 6ad9119944a8b9bbf5a3748d2471082a32db542d
opened: 2026-11-13

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [ ] knowledge pages of changed components current with the reviewed code
- [ ] project and environment context reconciled with the candidate
- [ ] requirements re-read: status, prose, verification, paths and links true
- [ ] manual or inspection verification recorded where applicable
- [ ] explicit review approved, when enabled
- [ ] final `check --strict --run` result logged truthfully after the last edit
- [ ] remaining warnings and pre-existing failures explained
- [ ] `report` appended

## Frame

Problem: VERA cannot simulate with LTspice. STATED (ticket ELEC-05, #97): a plugin `ltspice` uses the user's LTspice
installation on Windows x64 - find plus official install instructions, no repackaging, no proprietary libraries in the
catalog - with a helper for validation, `.asc` -> netlist conversion where the engine offers it, batch runs and the
extraction of `.raw`/`.log`/measurements into the common result model of ELEC-04. OBSERVED (2026-11-13): LTspice was not
installed on this machine; the user installs it (RULING-001). OBSERVED (2026-11-13): the official LTspice64.msi (26.1.1.2,
signed by Analog Devices) failed three times as a per-user install (Windows Installer 2503/2502, status 1603: the
service got access denied creating `C:\Windows\Installer\inprogressinstallinfo.ipi`; every user-started install fails
on this machine, only IT-pushed ones succeed); at the user's request it was installed for all users through a UAC
prompt (exit 0): `C:\Program Files\ADI\LTspice\LTspice.exe`, file version 26.1.1.0, `-version` prints `26.1.1` to
stdout and exits 0; the component libraries are unpacked per user in `%LOCALAPPDATA%\LTspice\lib`. The installation also
ships `ltspice-mcp-bridge.exe` (not used: out of scope).

Desired outcome:
- The plugin finds the user's LTspice (per-user `%LOCALAPPDATA%/Programs/ADI/LTspice/LTspice.exe`, system-wide
  `%ProgramFiles%/ADI/LTspice/LTspice.exe`), identifies its version (`-version`) and records the first validated version
  in the support matrix; it is not offered on Linux and installs nothing (no Wine).
- `ltspice-tool` (standard library, `uses: [ltspice]`) validates a netlist or schematic and its includes under the
  ELEC-04 contract adapted to LTspice's dialect, converts `.asc` to a netlist with `-netlist` on a copy, runs `-b` on a
  copy in a new run folder, parses the `.raw` (real, complex AC, stepped, non-uniform time) and `.log` (measurements and
  errors) into the ELEC-04 result shape (series, measurements, criteria, report), and leaves the sources unchanged.
- Missing engine, missing model, non-convergence, timeout and Stop have distinct statuses and leave no process running.

Actors: the user (installs LTspice, enables the plugin), the agent (runs ltspice-tool), VERA's provisioner and runner,
LTspice.

Primary scenario: the user installs LTspice; the agent runs `ltspice-tool run` on `filter.asc` (AC) and `buck.cir`
(transient); the helper converts and runs on copies and reports measurements against criteria, comparable to ngspice.

Examples (STATED, ticket Done criteria):
- E05-A: the installed LTspice version is identified; an `.asc` fixture and a `.cir` fixture give real results from VERA
  on Windows.
- E05-B: the parser reads DC/tran, complex AC and stepped data without losing the axis, units or step identity;
  partial or corrupt files are reported.
- E05-C: simple common circuits match ngspice and the analytic solution within tolerances fixed beforehand; model
  differences are not called engine bugs without analysis.
- E05-D: missing engine, model, convergence and timeout/Stop have distinct statuses and leave no process running.
- E05-E: the package is not offered on Linux and installs no Wine; docs and catalog say Windows only.
- E05-F: sources stay identical, folders with spaces/Unicode work, reports leak no unasked paths or secrets.

Counterexamples: an incompatible model is never replaced by an ideal component; GUI automation is not used.

In scope: STATED - the plugin with find and official install instructions; the helper operations (validate, convert,
run, measure, compare, report on the ELEC-04 model); DC, AC, transient and parametric (.step) analyses; the raw/log
parser; the ELEC-04 validation contract for includes, executable or file-writing directives and destinations, adapted
to LTspice (for example `.wave`, `.savestate`, `.savebias` write files; `file=` options read files); Windows x64 only.
INFERRED - reuse of the ELEC-04 measurement, report and workspace code by verified copy.

Out of scope (STATED, ticket): LTspice GUI automation, perfect dialect compatibility, macOS/Linux support,
redistributing proprietary models.

Constraints: same branch feature/93-electronics-calc; commit when validated, no push, no Claude attribution; do not
overengineer (one current LTspice version, no legacy LTspiceXVII names guessed); stored formats at version 1; standard
library only; the user's LTspice only (no download).

Success signals: E05-A..F with the real LTspice on Windows; lint, typecheck, i18n and both reviews pass.

Evidence: ticket F:\ProjectsDDP\VERA_Electronics_Plugins_Tickets\ELEC-05.md; ADI LTspice reference (GitHub
analogdevicesinc/ltspice-reference ai_ref, read 2026-11-13): install paths, switches `-b`, `-netlist`, `-ascii`,
`-version`, `-Run`, `-ini`, `-sync`, `-alt`, `-norm`, `-FastAccess`, `-encrypt`; `.meas` results in the `.log`; error
texts ("Time step too small", "Iteration limit reached", "Singular matrix", "Failure to find initial operating point");
`.wave`/`.savestate`/`.savebias` write files; `.include` relative to the directive's directory; `.lib` search order
(netlist directory, user library directory, search paths, `%LOCALAPPDATA%/LTspice/lib/cmp` and `.../sub`).

Assumptions: none left open (resolved by the probes below).

Probes (OBSERVED 2026-11-13, LTspice 26.1.1, Windows 11, `D:\Temp\ltspice-probe`):
- `-b deck.cir` waits for the run, prints nothing and writes next to the netlist `deck.raw`, `deck.log` (UTF-8),
  `deck.op.raw` and, when the deck has `.meas`, `deck.db` (SQLite) and with `.step` `deck.log.raw`; exit 0 on success, 1
  on any netlist or simulation error. Spaces and non-ASCII folder names work.
- `.raw`: UTF-16LE header (`Title`, `Date`, `Plotname`, `Flags`, `No. Variables`, `No. Points`, `Offset`, `Command`,
  `Variables:` tab-separated index/name/type) then `Binary:`; real data = axis float64 + values float32 (`Flags: real
  double` with `.options numdgt>6`: all float64); complex = float64 pairs for every variable including the frequency;
  stepped (`Flags: ... stepped`) = steps concatenated, the axis restarting at each step; `.op` = one point per step with
  no axis (a stepped op has the parameter or `temperature` as variable 0). Noise: `frequency`, `gain`, per-device
  contributions, `v(onoise)`, `v(inoise)` in V/sqrt(Hz). No negative time values were seen; waveform compression made no
  difference (RC at 1 ms within 1e-6 of 1 - e^-1). A run killed mid-way leaves a header whose point count does not
  match the data.
- `.log`: version, `Circuit:` (absolute path), solver lines, `.step <name>=<value>` per step, "Total elapsed time",
  "Files loaded:" (absolute paths). Errors are `<path>(<line>): <message>` with the line and a caret ("Undefined model",
  "This sub-circuit name is not defined", "File not found", "Expected device instantiation or directive here", "A
  parameter with this name is already defined elsewhere", "This results in only one step"); singular: "... paralleled
  making an over-defined circuit matrix"; non-convergence: "Time step too small", "Iteration limit reached".
- `-netlist x.asc` writes UTF-8 `x.net` (title `* <absolute path>`, `1u` rewritten `1µ`, `.backanno` added, standard
  parts as `.lib <%LOCALAPPDATA%>\LTspice\lib\cmp\standard.dio`) and exits 0; an unknown symbol gives exit 127 and no file.
- A batch run loads no model implicitly; a bare `.lib LTC.lib` / `.include opamp.sub` resolves in
  `%LOCALAPPDATA%\LTspice\lib\sub`. ADI's own libraries use `A` special-function devices and are Latin-1 text.
- `.param` of an existing name is an error; `.step param` overrides `.param` but needs two distinct values. A fresh
  `-ini` file makes LTspice wait on an interactive prompt (unusable in batch).
- The installed help (read 2026-11-13): first line ignored; `*` comments, `;` inline comments, `+` continuation; case
  folded with Unicode normalization; UTF-16LE, UTF-8 or Latin-1 input; curly braces optional; string parameters with
  `+` concatenation; files read by `.include/.inc/.lib`, `.loadbias`, `.loadstate`, PWL `file=`/`scopedata=`, `wavefile=`,
  `tbl=`, `table(x, .include "f")`, `.ac/.dc/.noise/.step file=`; files written by `.wave` (any absolute path),
  `.savebias`, `.savestate`, `.fra`/`@` (extra raw), `.options fastaccess` (converts the raw); no netlist construct runs
  programs, loads code or uses the network; `A` devices are ADI special functions.

Unknowns: none blocking. Not covered: schematics saved as UTF-16 by other LTspice versions (the examples are 8-bit).

Decision-blocking questions: none (RULING-001 answered how LTspice is installed).

Proposed behaviors (accepted in autopilot, RULING-002): exit codes 0/2/3 as ELEC-01..04; every direct `LTspice`
command blocked, the engine reached only through ltspice-tool; binary raw files (no `-ascii`); the request model of
ELEC-04 (the request's analysis, vectors, parameters and temperature replace the netlist's analysis, `.step`, `.temp`,
`.save` and `.meas` cards, dropped with a warning) so that the same request runs on both engines; series named as in
ELEC-04 (`v(n)`, `i(Vx)`, `vdb(n)`, `onoise_spectrum`...); sweeps and Monte Carlo through one engine run with `.step`;
measurement, criteria and sweep-draw code as byte-identical copies of ELEC-04's; LTspice reports missing models and
subcircuits itself (no pre-check of ADI's libraries).

Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new plugin and helper |
| no new interface or data format | no | requests and results for LTspice, raw/log parsing |
| no new dependency | no | the user's LTspice |
| an existing requirement already covers the behavior | no | none for LTspice |
| no security or data-handling change | no | executing netlists and schematics |

## Requirement coverage

| Behavior | Requirement | New/revised | Frame source |
|---|---|---|---|
| Request, run folder and result contract (spec) | REQ-DATA-0f9e36a3 | new | E05-A, E05-B |
| Plugin finds the user's LTspice, no download, version >= 26, direct commands blocked | REQ-FUNC-285b6fcc | new | E05-A, E05-E |
| Missing LTspice refused as not installed (exit 2) | REQ-REL-d17ee05f | new | E05-D |
| validate lists the chain without the engine | REQ-FUNC-40bcbc04 | new | ticket helper |
| File-reading/writing, unsupported and unchecked constructs refused (exit 2) | REQ-SEC-e5b9df02 | new | E05-F, ticket contract |
| Includes confined to the workbench or the LTspice library | REQ-SEC-c2953ca4 | new | ticket contract |
| Schematic converted on a copy; bad symbol paths refused; conversion failure reported | REQ-FUNC-0a9592c1 | new | E05-A |
| Batch run on a copy in a new run folder | REQ-FUNC-8e093f1b | new | E05-A |
| Parameters override by rewriting top-level assignments; unknown refused | REQ-FUNC-08dc4fb1 | new | ELEC-04 model |
| Analyses mapped; series named as ELEC-04 | REQ-FUNC-e6f31b12 | new | E05-B, E05-C |
| Raw files parsed; partial and corrupt reported | REQ-DATA-d4d85a22 | new | E05-B |
| Engine failures with distinct problem kinds, no pass (exit 3) | REQ-REL-97287e21 | new | E05-D |
| Sweeps and Monte Carlo in one .step run | REQ-FUNC-e90dd7e9 | new | ticket .step |
| Profile limits refused; time and data limits stop the engine | REQ-REL-517e9feb | new | E05-D |
| No LTspice process after Stop, timeout or data limit | REQ-REL-f14fbe8e | new | E05-D |
| Inputs unchanged; failed run's files removed | REQ-REL-d20f53a0 | new | E05-F |
| No absolute paths in results and reports | REQ-SEC-91ca52fe | new | E05-F |
| Windows x64 only, nothing installed | REQ-PLAT-590b1e69 | new | E05-E |
| Analytic and ngspice references within declared tolerances | REQ-TEST-99244ca8 | new | E05-C |
| Real batch runs, errors, Stop and timeout recorded; skip without LTspice | REQ-TEST-c6909384 | new | E05-A, E05-D, E05-F |
| Measurements over windows (shared measure.py) | REQ-FUNC-52c19a19 | revised | E05-C |
| Average power and sign convention (shared) | REQ-FUNC-52bb81f2 | revised | E05-C |
| Criteria pass/fail/unknown (shared) | REQ-FUNC-7785cea9 | revised | E05-C, E05-D |
| compare (ltspice-tool too) | REQ-FUNC-2aa76757 | revised | ticket helper |
| report (ltspice-tool too) | REQ-FUNC-457a6e05 | revised | ticket helper |
| measure an existing run (ltspice-tool too) | REQ-FUNC-079e7b77 | revised | ticket helper |
| No solver option added; options reported as written | REQ-REL-223a0738 | revised | E05-C |

## Design

**Approach.** A plugin with no platform change: the engine `ltspice` is find-only (RULING-001) and the helper
`ltspice-tool` reaches it through the existing `uses` -> `VERA_PROGRAM_LTSPICE` (ELEC-04). The helper keeps
ngspice-tool's shape and request/result model (RULING-002, REQ-DATA-0f9e36a3): it checks the LTspice netlist chain
itself and refuses before the engine (§3), converts a schematic on a copy with `-netlist` (§4), writes an effective
netlist with the request's `.temp`, `.save`, analysis and `.step` cards, runs `LTspice.exe -b` as a child in the run
folder with a deadline and a raw-size watchdog, parses the binary raw file and evaluates measurements with the same
Python code. Rejected: extracting `.meas` from the log or the SQLite `.db` (undocumented formats, duplicates the
helper's measurements); isolating settings with `-ini` (LTspice then waits on a prompt); one engine run per sweep
point (N processes, no stepped data); pre-checking models in ADI's libraries (proprietary, partly encrypted, Latin-1);
`-ascii` raw files (slower; the binary layout is exact).

**Interfaces and data.**
- plugin `05_Software/plugins/ltspice/`: `plugin.yaml` (platforms [windows-x64]; `ltspice` find per-user and
  all-users paths, version `-version` match `^(\d+)\.` range `>=26`, no download; `ltspice-tool` script, `uses:
  [ltspice]`; rule `ltspice *` blocked, helper operations safe), README (Windows only, analog.com install, licence,
  2503 hint), skill `ltspice-simulation`; `catalog.yaml` official + metadata; `packs.yaml` electronics group
  "Simulation (LTspice, Windows)" default false (needs a separately installed program).
- helper `scripts/ltspice_tool.py` + `scripts/ltspice_support/`: byte-identical copies `workspace.py`, `measure.py`,
  `sweep.py` (a test compares bytes with ngspice's); near copies `request.py` (sweep 2..100 distinct values, Monte
  Carlo 2..200 runs, `.asc` netlists), `compare.py` and `report.py` (kind `ltspice-tool-result`, path redaction of
  §9), `cli.py` (+ `convert`); new `netlist.py` (LTspice dialect §3: NFKC + casefold, cards, elements, words, quotes,
  encoding, includes with the LTspice library - names read as LTspice reads them, library includes rewritten to the hashed file -, `.param` assignment splitting), `schematic.py` (§4), `raw.py` (§6:
  header, real/double/complex, stepped split, partial/corrupt), `engine.py` (locate + version, effective netlist,
  child process with CREATE_NO_WINDOW, deadline and size watchdog, kill, log classification §7, series building).
- Errors: exit 2 refusals carry {code, path (file:line), message}; exit 3 failures keep the folder for engine failures and
  timeouts, remove it otherwise (REQ-REL-d20f53a0).

**Files and test seams.** `tests/integration/ltspice.test.ts` with `tests/fixtures/ltspice/`: netlists (divider,
rc, switch, load, noise, thermal-free), `filter.asc`, failures (missing model, subckt, singular, loop), `hostile/`
(one file per refused construct, include variants), small raw files written by LTspice 26.1.1 for the parser
(`raw/`), README with references and tolerances declared before the run, hooks `raw_dump.py` (parser output as JSON),
`change_input.py`, `limit.py` (lower data limit), `write_fail.py`. Offline cases (refusals, parser, byte-identity,
manifest, rules, catalog) always run; real-engine cases need `VERA_TEST_LTSPICE`; the ngspice comparison also
`VERA_TEST_NGSPICE`; Stop by `taskkill /T /F` on the helper, as VERA's runner stops a program. Manifest and rule tests ride on
the existing shared/core plugin tests (official catalog count).

**Risks and open decisions.** Executing user netlists: the refusal set follows the installed help's file constructs;
an undocumented construct could still read a file (mitigated by the review rounds' probes of the real LTspice: quotes refused,
file keywords refused as substrings, line-break and invisible characters refused, include names read as LTspice reads
them and library includes rewritten to the hashed file, NFKC matching). Library includes name the hashed library file, so LTspice searches none of its folders. LTspice is a GUI
program: it must never open a window or prompt in batch (CREATE_NO_WINDOW, no `-ini`). LTspice's conversion of UTF-16 schematics is untested (the symbol check reads every encoding).
The pre-existing cli.test.ts official-plugin count changes again.

**Requirement map.** FUNC-285b6fcc, PLAT-590b1e69: manifest, README, catalog, packs. REL-d17ee05f, FUNC-8e093f1b,
REL-97287e21, REL-517e9feb, REL-f14fbe8e, FUNC-e6f31b12, REL-223a0738: engine.py (+ request.py). FUNC-40bcbc04,
SEC-e5b9df02, SEC-c2953ca4, FUNC-08dc4fb1: netlist.py. FUNC-0a9592c1: schematic.py. DATA-d4d85a22: raw.py.
FUNC-e90dd7e9: engine.py + sweep.py. FUNC-52c19a19, FUNC-52bb81f2, FUNC-7785cea9, FUNC-079e7b77: measure.py (copy).
FUNC-2aa76757, FUNC-457a6e05: compare.py/report.py. REL-d20f53a0, SEC-91ca52fe: cli.py/report.py. DATA-0f9e36a3: whole
helper. TEST-99244ca8, TEST-c6909384: ltspice.test.ts and fixtures.

Diagrams: [diagram_TASK-43e9ee14.md](diagram_TASK-43e9ee14.md)

## Log

- 2026-11-13 frame: journal opened
- 2026-11-13 frame: LTspice is not installed on this machine (no ADI/LTC folder, no LTspice.exe on PATH, 2026-11-13). The ticket (STATED) has the plugin find the user's own installation, never repackage or install it, and E05-A needs a real LTspice run on Windows
- 2026-11-13 frame: LTspice installed at the user's request: per-user msiexec failed (2503/2502, access denied on C:\Windows\Installer\inprogressinstallinfo.ipi); all-users install through UAC succeeded (exit 0): C:\Program Files\ADI\LTspice\LTspice.exe 26.1.1; -version prints 26.1.1 and exits 0
- 2026-11-13 frame: probes done (D:\Temp\ltspice-probe): -b/-netlist outputs, raw layouts (real, double, complex, stepped, op, noise), log formats and error texts, exit codes 0/1/127, library resolution, killed-run leftovers; installed help read by a subagent (file-reading/writing constructs, lexical rules); a fresh -ini blocks on a prompt (process stopped)
- 2026-11-13 frame: completed; next specify
- 2026-11-13 specify: completed; next design
- 2026-11-13 design: completed; next build
- 2026-11-13 build: red: npx vitest run tests/integration/ltspice.test.ts exit 1 - no ltspice plugin, manifest, catalog/pack entries or helper copies (REQ-FUNC-285b6fcc, REQ-PLAT-590b1e69, REQ-FUNC-52c19a19)
- 2026-11-13 build: green: npx vitest run tests/integration/ltspice.test.ts -t 'publishes|byte-identical' exit 0, 2 passed (REQ-FUNC-285b6fcc, REQ-PLAT-590b1e69, REQ-FUNC-52c19a19 copy); the version/help test waits for cli.py
- 2026-11-13 build: red: npx vitest run tests/integration/ltspice.test.ts -t 'raw files' exit 1 - no raw module to read LTspice raw files (REQ-DATA-d4d85a22)
- 2026-11-13 build: green: npx vitest run tests/integration/ltspice.test.ts -t 'raw files' exit 0, 2 passed (REQ-DATA-d4d85a22); raw fixtures written by LTspice 26.1.1 from the circuits beside them; *.raw marked binary in .gitattributes
- 2026-11-13 build: red: VERA_TEST_LTSPICE=<installed 26.1.1> npx vitest run tests/integration/ltspice.test.ts exit 1, 13 failed - no netlist checks, engine, schematic conversion, sweeps or redaction in ltspice-tool yet (REQ-FUNC-40bcbc04, REQ-SEC-e5b9df02, REQ-SEC-c2953ca4, REQ-FUNC-08dc4fb1, REQ-REL-517e9feb, REQ-REL-d17ee05f, REQ-FUNC-8e093f1b, REQ-FUNC-e6f31b12, REQ-DATA-0f9e36a3, REQ-REL-223a0738, REQ-FUNC-0a9592c1, REQ-FUNC-52bb81f2, REQ-FUNC-7785cea9, REQ-REL-97287e21, REQ-SEC-91ca52fe, REQ-REL-f14fbe8e, REQ-TEST-c6909384, REQ-REL-d20f53a0, REQ-FUNC-e90dd7e9, REQ-FUNC-2aa76757, REQ-FUNC-457a6e05, REQ-FUNC-079e7b77)
- 2026-11-13 build: green: VERA_TEST_LTSPICE=<LTspice 26.1.1> VERA_TEST_NGSPICE=<ngspice-47> npx vitest run tests/integration/ltspice.test.ts exit 0, 19 passed 1 skipped (all ELEC-05 requirements incl. REQ-TEST-99244ca8 against ngspice); without LTspice 9 passed 11 skipped
- 2026-11-13 build: observed during build - LTspice writes a raw file with 0 variables when .save names only unknown vectors (now an empty raw, reported as problem vector); a stepped .op prints no .step lines to the log, so steps are identified from the raw file and the requested order (spec §6/§8 corrected); noise spectra are measured through measure on the run folder, as in ngspice-tool
- 2026-11-13 build: check - remaining warnings for this task are secret-in-diff on binary or UTF-16 fixtures (raw/*.raw written by LTspice, hostile/utf16.cir) that the scanner cannot read; they hold fictional circuits and LTspice's own header text, no credentials. Pre-existing failures not caused by ELEC-05: tests/integration/cli.test.ts expects 9 official plugins (now 19), shared plugins-ipc.test.ts expects old catalog defaults
- 2026-11-13 build: completed; next validate
- 2026-11-13 validate: self-review - .inc and .lib written inside an expression (table(x, .inc "f")) were not refused; netlist.py now refuses include, .inc and .lib outside include cards; fixtures hostile/table-inc.cir, table-lib.cir; hostile test passes
- 2026-11-13 validate: review round 1: both changes_required. BLOCKING (both): a single-name .lib in a file holding any .endl (even after .end, commented out in the copy) was skipped as a section start, so .lib <outside file> reached LTspice (confirmed: outside .wav written, outside subckt loaded). BLOCKING (spec): an .asc saved as UTF-16LE without BOM hid its SYMBOL lines (outside symbol used). BLOCKING (quality): an unterminated quoted .lib path passed validate. BLOCKING (spec): verification texts claim assertions the tests lack (result fields, include parameter, step mismatch, edited series, report pass+fail, LTC.lib/absolute library validate, sweep without engine, Stop wording). Notes: include cycle to the main netlist exposes its unchecked title; sub-sheet SYMBOL lines unchecked; schematic files read twice; title/header may hold absolute paths, redaction stops at spaces; raw columns as Python floats; data limit uses the transient cap for every analysis; single-quoted includes; report.md lacks engine.loaded; spec wording (.inc/.lib, absolute -b path, schematic-sheet role); planning doc
- 2026-11-13 validate: returned to build - review round 1 findings: .lib section skip escape, UTF-16 schematic symbol check, unterminated include quote, test gaps and notes
- 2026-11-13 build: red: VERA_TEST_LTSPICE=<LTspice 26.1.1> npx vitest run tests/integration/ltspice.test.ts exit 1 - hostile/lib-endl.cir validates (exit 0): a single-name .lib is skipped as a section start (review round 1; REQ-SEC-c2953ca4, REQ-SEC-e5b9df02); the new verification assertions (result fields, include parameter, LTC.lib/standard.dio library inputs, report pass+failed, edited series) already pass
- 2026-11-13 build: green: VERA_TEST_LTSPICE=<LTspice 26.1.1> VERA_TEST_NGSPICE=<ngspice-47> npx vitest run tests/integration/ltspice.test.ts exit 0, 19 passed 1 skipped; without LTspice 9 passed 11 skipped (round-1 fixes: single-name .lib is an include outside files reached as .lib FILE SECTION; unreadable include names and self-includes refused; every .asc of a schematic folder checked in Latin-1 and UTF-16LE/BE with or without BOM, checked bytes copied; single-quoted includes; title/header paths scrubbed and paths with spaces redacted whole; raw float columns as arrays; data limit by analysis cap; report.md lists loaded files; tests for result fields, include parameter, library inputs, report pass+failed, edited series, sweep without engine)
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: review round 2: both changes_required. BLOCKING (both): include file names were parsed as path + section at the first blank with ';' stripped, while LTspice reads an unquoted include's whole remainder (';' included) as the file name and searches library names itself - '.lib standard.dio ..\..\..\outside\evil.lib' and '.inc standard.dio;..' validated as library includes and loaded an outside file (confirmed: .wave written outside, v(a)=42 from an outside .param). BLOCKING (spec): verification texts overstate tests (REQ-DATA-0f9e36a3 all-tests result.json, REQ-SEC-c2953ca4 run/another drive, REQ-FUNC-8e093f1b .temp, REQ-REL-d20f53a0 library hashes). Notes: sections.cir used the unquoted section form LTspice cannot run; refusal messages echo absolute include paths; raw real files still build row tuples; user library search paths before lib/cmp; smaller verification overstatements; design note error fields and UTF-16 wording
- 2026-11-13 validate: returned to build - review round 2: include names parsed unlike LTspice (unquoted remainder, ';'), library includes left for LTspice to search; verification texts
- 2026-11-13 build: red: VERA_TEST_LTSPICE=<LTspice 26.1.1> npx vitest run tests/integration/ltspice.test.ts exit 1 - hostile/lib-space.cir validates (unquoted include name split at the blank) and the library include is not rewritten to the hashed file (review round 2; REQ-SEC-c2953ca4, REQ-SEC-e5b9df02)
- 2026-11-13 build: green: VERA_TEST_LTSPICE + VERA_TEST_NGSPICE npx vitest run tests/integration/ltspice.test.ts exit 0, 19 passed 1 skipped; without LTspice 9 passed 11 skipped; lint and typecheck exit 0 (round-2 fixes: include names read from the physical lines as LTspice reads them - unquoted whole rest with ';', quoted name plus at most one .lib section word -; library includes rewritten to the quoted absolute path of the hashed file; refusal messages scrubbed, URLs kept; raw float32 columns copied by stride; section fixtures quoted; test regex for absolute paths corrected after a shell heredoc had altered it; assertions for .temp, library hash, filter.net lines, kept partial raw, effective.net in problems, result.json options, compare point inputs, refusal output)
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: review round 3: both changes_required. BLOCKING (both): LTspice 26.1.1 also ends a line at U+0085 (NEL) and U+2028 (line separator), the helper only at CR/LF - text after one inside a comment, after ';' or after an element (only the first word is a card) became a live card: .wave wrote outside the working directory, .inc loaded an outside file (also through an include and through an .asc TEXT directive). BLOCKING (spec): verification texts REQ-PLAT-590b1e69 (catalog test), REQ-FUNC-0a9592c1 (problem convert assertion always true), REQ-FUNC-457a6e05 (report values). Notes: '%' in a path crashes LTspice (0xC0000005); scrub misses //server/share and root-relative \Users\... paths; smaller verification overstatements; spec §3 ';' after quoted names, §7 extra texts, §6 sweep series shape, exit 127 wording, README sweeps heading, skill quoted section names
- 2026-11-13 validate: returned to build - review round 3: Unicode line breaks U+0085/U+2028 split lines for LTspice only; verification texts
- 2026-11-13 build: red: VERA_TEST_LTSPICE=<LTspice 26.1.1> npx vitest run tests/integration/ltspice.test.ts exit 1 - hostile/ls-comment.cir (U+2028) validates and schematics/nel/nel-text.asc (0x85 in a TEXT directive) converts (review round 3; REQ-SEC-e5b9df02, REQ-FUNC-0a9592c1)
- 2026-11-13 build: green: VERA_TEST_LTSPICE + VERA_TEST_NGSPICE npx vitest run tests/integration/ltspice.test.ts exit 0, 19 passed 1 skipped; without LTspice 9 passed 11 skipped; lint and typecheck exit 0 (round-3 fixes: files holding U+0085/U+2028/U+2029 refused as encoding - LTspice ends a line at NEL and U+2028 -, also converted netlists; include names with '%' or a line break refused; an LTspice access violation names the '%' cause; scrub covers //server/share and root-relative \... paths; tests for the convert problem kind, report values and criteria, library hash, Time step too small, temp step order, same-seed results, every Monte Carlo point in compare; texts narrowed)
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: review round 4: spec approved (round-3 escapes refused in 24 variants; notes: U+2029 wording, verification overstatements, refusal lists in README/skill/knowledge/plan, scrub stops at ', options unscrubbed, 'nothing ran' wording for convert, BOM schematics). quality changes_required, BLOCKING: LTspice matches file keywords by prefix and without '=' (PWL file x, scopedata x, fileD:\..., .incl/.includ, .incD:\... read outside files) and drops Unicode default-ignorable characters (soft hyphen, zero-width, inner BOM: fi<SHY>le=, .<ZWSP>inc) - the helper needed '=' and word boundaries and kept those characters
- 2026-11-13 validate: returned to build - review round 4 (quality): keyword prefix matching and default-ignorable characters
- 2026-11-13 build: red: npx vitest run tests/integration/ltspice.test.ts -t hostile exit 1 - hostile/file-noeq.cir (PWL file x without '=') validates (review round 4; REQ-SEC-e5b9df02)
- 2026-11-13 build: green: VERA_TEST_LTSPICE + VERA_TEST_NGSPICE npx vitest run tests/integration/ltspice.test.ts exit 0, 19 passed 1 skipped; without LTspice 9 passed 11 skipped; lint and typecheck exit 0 (round-4 fixes: outside include cards the substrings file, scopedata, tbl, .inc, include, .lib, loadbias, savebias, loadstate, savestate, fastaccess are refused, also with continuation lines joined without a blank; files holding Unicode Cf or default-ignorable characters refused as encoding; result.json options scrubbed; records list every refusal; .option caught by the no-option test)
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: review round 5: both approved (spec: all round-4 escapes and variants refused, 47 hostile rows and 16 benign fixtures as expected, no absolute paths; quality: systematic search - abbreviations, Unicode folds, quotes, line breaks/joins, comments, encoding, effective copy, schematics - found no escape). Non-blocking notes taken into a last small delta, reviewed in round 6: records list 7 of 11 refused substrings, --help epilog describes the old word rule, validate prints options unscrubbed, include names not in NFC (LTspice applies NFC to them), Design risks and State wording
- 2026-11-13 validate: returned to build - round-5 non-blocking notes: records and --help list every refused substring, validate options scrubbed, non-NFC include names refused
- 2026-11-13 build: red: npx vitest run tests/integration/ltspice.test.ts -t 'hostile|lists the chain' exit 1 - validate prints options-path.cir's .options with an absolute path, and hostile/nfd-include.cir (decomposed include name, file present) validates (round-5 notes; REQ-SEC-91ca52fe, REQ-SEC-c2953ca4)
- 2026-11-13 build: green: VERA_TEST_LTSPICE + VERA_TEST_NGSPICE npx vitest run tests/integration/ltspice.test.ts exit 0, 19 passed 1 skipped; without LTspice 9 passed 11 skipped; lint and typecheck exit 0 (round-5 notes: non-NFC include names refused, validate options scrubbed, --help and records list every refusal)
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: review round 6 (last of 1 + 5 fix cycles): spec approved (NFC rule confirmed by disabling it; notes: options 'as written' wording, SKILL NFC, fixtures README companion file, epilog completeness, REQ-SEC-c2953ca4 prose). quality changes_required, BLOCKING (confirmed wrong result, not an escape, pre-existing): a netlist in a folder whose name is decomposed (NFD, e.g. copied from a Mac) gets copies whose include lines carry the decomposed folder name; LTspice composes include text to NFC, so it reads another copy (a precomposed twin folder) or reports File not found. Simplest fix: refuse chain files whose workbench path is not NFC (also the as_if path of converted schematics)
- 2026-11-13 validate: returned to build
- 2026-11-13 build: green: VERA_TEST_LTSPICE + VERA_TEST_NGSPICE npx vitest run tests/integration/ltspice.test.ts exit 0, 19 passed 1 skipped; without LTspice 9 passed 11 skipped; lint and typecheck exit 0 (round-6 finding: chain files and schematics at workbench paths not in NFC refused; probe: LTspice 26.1.1 keeps a decomposed command-line folder and composes only include text)
- 2026-11-13 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-13 validate: DEVIATION validate: round 7 is logged as lines and its verdicts are stored under the CLI's round 6, because 'aegis verdict' accepts rounds 1-6 only (as in TASK-7c2a9322) - the verdicts stay traceable in the Log
- 2026-11-13 validate: Review round 7 (RULING-003): spec approved, quality approved, no blocking findings (verdicts stored under round 6, see the DEVIATION). Probes with LTspice 26.1.1 confirmed the NFC rel refusal, also through junctions and 8.3 short names; a decomposed working directory and --results-dir run correctly; precomposed non-ASCII subfolders (n-ae, x2 superscript, fullwidth parentheses) still run; LTspice applies only NFC to include text (not NFKC or case folding).
- 2026-11-13 validate: Known limitations accepted (non-blocking review notes, no candidate edit after the verdicts): REQ-SEC-c2953ca4 affected_paths omits schematic.py; a decomposed %LOCALAPPDATA% profile path would give library includes that LTspice composes (environment, not workbench content); the include branch of the rel check (reached only via junctions or 8.3 names), a run through precomposed non-ASCII subfolders and a run in a decomposed working directory are probed but not tested; a decomposed main netlist or schematic file name in an NFC folder is refused although harmless (one simple rule).
- 2026-11-13 validate: final: python .agentic/aegis.py check --task TASK-43e9ee14 --strict --run exit 0 (errors 0, warnings 157, notes 27; lint, typecheck, i18n ok; test not in [check] run) after both round-7 approvals; the test proof is the focused ltspice.test.ts run of this round (19 passed, 1 skipped with LTspice 26.1.1 and ngspice-47; 9 passed, 11 skipped without). Warnings: 103 uncovered-source are ltspice test fixtures (covered through ltspice.test.ts, not by requirement paths); 6 secret-in-diff are binary .raw files written by LTspice and the UTF-16 fixture, not content-scanned; the rest (journal-header, stale-paths, no-linked-tests, ticket-ref, manual-verification) belong to older tasks and requirements. Pre-existing failures outside this task: tests/integration/cli.test.ts (expects 9 official plugins), shared plugins-ipc.test.ts (old catalog defaults). No candidate edit after the proof.
- 2026-11-13 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-13 | decision=the user installs LTspice from the official source; the plugin only finds it (find install, no download) | reason=user chose 'I install it' (2026-11-13); the ticket asks for the user's own installation and no repackaging | source=user | supersedes=none
- RULING-002 | date=2026-11-13 | decision=ltspice-tool follows the ELEC-04 request model: the request's analysis, vectors, parameters and temperature replace the netlist's analysis/.step/.temp/.save/.meas cards; series named as ELEC-04; sweeps and Monte Carlo in one engine run with .step; measure.py and sweep.py byte-identical copies; LTspice itself reports missing models; binary raw only | reason=the same request then runs on ngspice and LTspice (E05-C, common result model); .step gives real stepped data (E05-B); ADI libraries are proprietary, partly encrypted Latin-1 files the helper should not parse; autopilot per the epic go-ahead | source=technical | supersedes=none
- RULING-003 | date=2026-11-13 | decision=one more fix cycle and explicit review round (7) beyond the bound of 6, for the round-6 NFD folder-name finding | reason=the user chose 'Yes, fix and review' over closing ELEC-05 with a known issue | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: commit ELEC-05 on feature/93-electronics-calc, then ELEC-06
must_read: .agentic/tasks/TASK-43e9ee14.md
changed: round-6 finding: netlists, includes and schematics whose workbench path is not in Unicode NFC are refused before LTspice runs
evidence: python .agentic/aegis.py check --task TASK-43e9ee14 --strict --run exit 0; ltspice.test.ts 19 passed, 1 skipped with LTspice 26.1.1 and ngspice-47
issues: known limits (non-blocking review notes): REQ-SEC-c2953ca4 affected_paths omits schematic.py; a decomposed %LOCALAPPDATA% profile path is not checked; three probed cases untested; pre-existing failures cli.test.ts and plugins-ipc.test.ts outside this task
spec_compliance: approved
implementation_quality: approved
review_round: 6

## Delivery report (2026-11-13)

- stage: validate; type: feature; path: full; branch: feature/93-electronics-calc
- requirements:
  - REQ-DATA-0f9e36a3 - Define the ltspice-tool request, run folder and result contract
  - REQ-FUNC-285b6fcc - Package the ltspice plugin around the user's own LTspice on Windows x64
  - REQ-REL-d17ee05f - Report a missing LTspice as not installed before any run
  - REQ-FUNC-40bcbc04 - Validate an LTspice netlist and its include chain without running the engine
  - REQ-SEC-e5b9df02 - Refuse LTspice constructs that read or write files or that the helper cannot check
  - REQ-SEC-c2953ca4 - Confine LTspice includes to the working directory or the LTspice library
  - REQ-FUNC-0a9592c1 - Convert an LTspice schematic to a netlist on a copy
  - REQ-FUNC-8e093f1b - Run an LTspice simulation in batch mode on a copy in a new run folder
  - REQ-FUNC-08dc4fb1 - Override netlist parameters by rewriting their top-level assignment in the effective copy
  - REQ-FUNC-e6f31b12 - Map operating point, DC, AC, transient and noise analyses to LTspice with ELEC-04 series names
  - REQ-DATA-d4d85a22 - Parse LTspice raw files and report partial or corrupt data
  - REQ-REL-97287e21 - Report LTspice failures with a distinct problem kind and without passing any criterion
  - REQ-FUNC-e90dd7e9 - Sweep a parameter, the temperature or seeded Monte Carlo draws in one LTspice run
  - REQ-REL-517e9feb - Refuse requests beyond the run profile limits and stop LTspice beyond its time or data size
  - REQ-REL-f14fbe8e - Leave no LTspice process running after Stop or timeout
  - REQ-REL-d20f53a0 - Keep LTspice inputs unchanged and remove a failed run's files
  - REQ-SEC-91ca52fe - Keep absolute paths out of ltspice-tool results and reports
  - REQ-PLAT-590b1e69 - Offer the ltspice plugin only on Windows x64 and install nothing
  - REQ-TEST-99244ca8 - Match ngspice and analytic references on common circuits within declared tolerances
  - REQ-TEST-c6909384 - Record real LTspice batch runs with errors, Stop and timeout on Windows
  - REQ-FUNC-52c19a19 - Measure series over declared windows
  - REQ-FUNC-52bb81f2 - Compute average power from voltage and current with a stated sign convention
  - REQ-FUNC-7785cea9 - Evaluate declared criteria as pass, fail or unknown
  - REQ-FUNC-2aa76757 - Compare two runs and name what changed
  - REQ-FUNC-457a6e05 - Combine runs into one report
  - REQ-FUNC-079e7b77 - Measure an existing run without running the engine again
  - REQ-REL-223a0738 - Never change solver options behind the user's netlist
- deviations: 1 recorded
  - validate: round 7 is logged as lines and its verdicts are stored under the CLI's round 6, because 'aegis verdict' accepts rounds 1-6 only (as in TASK-7c2a9322) - the verdicts stay traceable in the Log
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=6
- diff vs task base 6ad9119: 163 file(s) changed, 6061 line(s) added; 10 file(s) not content-scanned
- checks: errors=0 warnings=157 notes=27
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

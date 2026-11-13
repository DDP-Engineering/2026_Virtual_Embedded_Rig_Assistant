# REQ-DATA-0f9e36a3 — ltspice plugin: the user's LTspice and ltspice-tool 1.0.0

The official plugin `ltspice` (`05_Software/plugins/ltspice/`) runs reproducible LTspice batch simulations on Windows
x64 with the user's own LTspice. Program `ltspice` is the engine (found, never downloaded - RULING-001); program
`ltspice-tool` is a standard-library PEP 723 script (`scripts/ltspice_tool.py`, support package
`scripts/ltspice_support/`) that validates a netlist or schematic and its includes, runs the engine in batch mode on a
copy in a new run folder and evaluates the results with the request and result model of `ngspice-tool` (spec
REQ-DATA-29b9a988), so that one request runs on both engines. Observations below were made with LTspice 26.1.1 on
Windows 11 (2026-11-13, journal TASK-43e9ee14 Frame).

## 1 Programs and rules

- `ltspice` (platform `windows-x64` only): find `%LOCALAPPDATA%/Programs/ADI/LTspice/LTspice.exe` (per-user install)
  and `%ProgramFiles%/ADI/LTspice/LTspice.exe` (all users). No download. Hint: install LTspice from
  `https://www.analog.com/ltspice` (LTspice64.msi, Windows 10/11 x64); if the per-user install fails with error 2503,
  install for all users from an administrator prompt. Version probe `-version` (prints `26.1.1`), the major version
  must be 26 or newer. Timeout 60 s.
- `ltspice-tool` (`uses: [ltspice]`, timeout 1800 s): `ltspice-tool {--version,--help,-h}` and
  `ltspice-tool {validate,convert,run,sweep,measure,compare,report} *` safe.
- Every direct `ltspice *` command is blocked: a netlist can write files anywhere (`.wave`) and LTspice's GUI starts
  without `-b`. Overlapping rules take the highest risk, so version and help are not exempt; ltspice-tool reports the
  engine version and VERA's probe runs without rules.
- Licence: LTspice is Analog Devices freeware under its own licence (`License.txt` in the installation folder). VERA
  never downloads, bundles or redistributes LTspice or its component libraries, and run folders never copy library
  files.

## 2 Command line

```text
ltspice-tool --version | --help | -h
ltspice-tool validate --netlist FILE
ltspice-tool convert  --schematic FILE [--run-id ID] [--results-dir DIR]
ltspice-tool run      (--json TEXT | --input FILE) [--run-id ID] [--results-dir DIR]
ltspice-tool sweep    (--json TEXT | --input FILE) [--run-id ID] [--results-dir DIR]
ltspice-tool measure  --run DIR (--json TEXT | --input FILE) [--run-id ID] [--results-dir DIR]
ltspice-tool compare  --run DIR --run DIR [--run-id ID] [--results-dir DIR]
ltspice-tool report   --run DIR [--run DIR]... [--title TEXT] [--run-id ID] [--results-dir DIR]
```

Path, run-id, input-file, output-size and results-directory rules are those of `ngspice-tool` through a byte-identical
copy of `workspace.py`; default results directory `electronics-results`. Exit codes: 0 completed (criteria may fail),
2 refused (arguments, request, netlist, schematic, limits, engine not installed - nothing was simulated; a schematic
may have been converted), 3 failed (the engine
failed, was stopped by a limit or timed out, an input changed, output could not be written).

The engine is the executable named by `VERA_PROGRAM_LTSPICE`, else the first of the two find paths that exists; its
`-version` output must start with a major version of 26 or more. Otherwise the request is refused with exit 2 and the
problem `engine` ("LTspice is not installed", with the hint of §1) before anything is written.

## 3 Netlist rules (validate, and before every engine run)

Files and text:
- The netlist (`.cir`, `.net`, `.sp`, `.spi`, `.txt` or any other name; an `.asc` goes through §4) and every workbench
  include are UTF-8 (a BOM is skipped), at most 4 MiB per file, 16 MiB and 256 files per chain, include depth 16. A file
  that is not valid UTF-8, starts with a UTF-16 BOM or holds a NUL byte is refused (`encoding`): LTspice would read it
  as UTF-16 or Latin-1. So is a file holding U+0085 (NEL), U+2028 or U+2029: LTspice 26.1.1 ends a line at NEL and
  U+2028 too, so text after one would be a line the helper never checked. A file whose first line is `* LTspice Encrypted File` is refused (`encrypted`): it cannot be
  checked.
- Every line of every file is checked, also after a `.end`. A logical line joins `+` continuation lines; leading blanks
  are ignored; a line whose first visible character is `*` is a comment; `;` starts a comment to the end of the line.
  Before matching, each logical line is NFKC-normalized and case-folded (LTspice folds case with Unicode
  normalization). The first line of the main netlist is the title: LTspice ignores it and the effective copy replaces it
  with `* ltspice-tool effective netlist`; the result keeps the original as `title`.

Cards (first visible character `.`):
- Kept: `.param .func .subckt .ends .model .global .options .option .ic .nodeset .include .inc .lib .endl .backanno
  .keepnode .end`.
- Dropped from the effective copy with a warning (the request controls them): `.op .dc .ac .tran .noise .tf .fra .four
  .net .meas .measure .step .temp .save`.
- Refused (`file`): `.wave .savebias .loadbias .savestate .loadstate` - they write or read files.
- Refused (`card`): `.machine .mach .endmachine .endmach .state .rule .output` (not supported) and every other dot card.

Elements: the first character is one of `A B C D E F G H I J K L M O Q R S T U V W X Z`. `A` devices are LTspice's
built-in special functions (ADI's own libraries use them). `@` and `&` (frequency-response elements, which write extra
raw files) and any other first character are refused (`element`).

Words, in the non-comment part of every logical line other than an include card (`.include`, `.inc`, `.lib`), checked
on the normalized text and again with continuation lines joined without a blank:
- `file`, `scopedata`, `tbl`, `.inc`, `include`, `.lib`, `loadbias`, `savebias`, `loadstate`, `savestate` or
  `fastaccess` as a plain substring - refused (`file`): LTspice matches these by prefix, also without `=` and glued to a
  path (`PWL file x`, `fileC:\x`, `table(1, .incl x)` read files), so a name such as `profile` is refused too.
- A double quote outside `.include`, `.inc`, `.lib` and `.model` cards - refused (`string`): string values and
  string parameters can name files.
- A file holding an invisible formatting character - Unicode category Cf or another assigned default-ignorable code point (soft
  hyphen, zero-width characters, a BOM inside the text, variation selectors) - is refused (`encoding`): LTspice drops
  them before reading a word (`fi<U+00AD>le=` reads a file).

A value written with an upper-case `M` suffix (`1M`) gives a warning: SPICE reads it as milli (`MEG` is mega).
Missing models and subcircuits and wrong pin counts are not checked before the run: LTspice reports them itself (§7).

Includes: `.include NAME`, `.inc NAME`, `.lib NAME` and `.lib "NAME" SECTION`, read from the physical lines as LTspice
reads them: an unquoted name is the whole rest of the card, blanks and `;` included (LTspice takes `.lib a.lib TT` as
the file `a.lib TT`, and `;` is no comment there); a name quoted with `"` or `'` may be followed, for `.lib`, by one
section word, and a `;` comment may follow. A card whose file name cannot be read (none, an unterminated quote, more
words after a quoted name), or whose name holds `%` (LTspice 26.1.1 crashes on it) or a line break, or is not in Unicode NFC (LTspice composes
it and would read another file), is refused (`include`). A netlist, include or schematic whose path inside the working
directory is not in NFC (a folder copied from a Mac) is refused too (`path` for the netlist or schematic, `include`
for an include): the copies' include lines name that path. The working directory's own name may be decomposed: LTspice
26.1.1 keeps the netlist path it is given and composes only include text (probed). A single-name `.lib NAME` is an include, except
inside a file reached only through `.lib FILE SECTION`, where a plain name that is no file starts a section (as LTspice
reads it); a file that is also included whole has such names refused. An include of the netlist itself is refused
(its title line, which LTspice ignores only as a title, would be read as a card). Resolution, in order:
1. A relative path resolves against the including file's folder; inside the working directory (workspace.py rules,
   never a network, device or other-drive path) it is a workbench file: copied into `input/`, checked by these rules,
   and rewritten in the effective copy to the copy's path.
2. A bare file name (no folder part) that is not a workbench file resolves in the LTspice library,
   `%LOCALAPPDATA%\LTspice\lib\cmp` then `...\lib\sub` (LTspice's own order); an absolute path inside
   `%LOCALAPPDATA%\LTspice\lib` (the form `-netlist` writes for standard parts) is a library file too. A library file is
   neither copied nor parsed; it is recorded as an input with role `library`, its name relative to the library
   (`<LTspice library>/sub/LTC.lib`), bytes and SHA-256, and the copy's card names that file by its quoted absolute
   path, so LTspice reads exactly the hashed file and searches none of its folders.
3. Anything else - missing, outside the working directory, `..` escaping it, another drive, a network or device path -
   is refused (`include`).

`validate` prints the title, the files with role, bytes, SHA-256 and the leading comment lines of each workbench file
(up to five: its stated provenance or licence), the subckts with ports and the models of the workbench files, the
dropped cards, the `.options` cards as written, and every problem; it never starts the engine and refuses an `.asc`
(use `convert`).

## 4 Schematics

`convert --schematic FILE.asc`, and `run`/`sweep` whose `netlist` ends in `.asc`:
- The schematic (at most 4 MiB) and the `.asc`/`.asy` files of its folder (not subfolders; at most 64 files and 16
  MiB) are read once. In every `.asc` of the folder (LTspice reads hierarchical sheets from there), read as Latin-1 and
  as UTF-16LE and UTF-16BE with or without a BOM (LTspice also reads UTF-16 without a BOM), each `SYMBOL <name> ...`
  line must name a relative symbol (no drive, no leading `\` or `/`, no `..` part), else the schematic is refused
  (`symbol`, exit 2).
- The bytes that were checked are written below `input/` of a new run folder (keeping the workbench path);
  `LTspice -netlist input/<path>.asc` runs there (working directory the run folder, 60 s).
  The written `input/<name>.net` is the netlist: it is checked by §3 as if it lay next to the original schematic
  (relative includes resolve against the schematic's folder in the workbench). LTspice writes `.lib` cards for standard
  parts with the library's absolute path (§3 include rule 2).
- No `.net` or a non-zero exit (an unknown symbol gives a non-zero exit and no file) is `failed`, problem `convert`,
  exit 3.
- `convert` keeps the run folder with `input/`, `<name>.net` copied to the run folder root, `result.json` (inputs,
  the validation listing of §3) and `report.md`; it never simulates.

## 5 Run request (run, and the base of sweep)

The request is ngspice-tool's (spec REQ-DATA-29b9a988 §5): `netlist`, `analysis`, `temperature`, `parameters`,
`vectors`, `measurements`, `criteria`, `profile`, `timeLimit`, with the same quantity, vector and profile rules.

- Every failure after the run folder exists removes the folder and exits 3, except an engine failure or timeout, whose
  folder is kept (§6).
- Analyses map to cards: `op` -> `.op`; `dc` -> `.dc SRC start stop step`; `ac` -> `.ac dec|oct|lin N fstart fstop`;
  `tran` -> `.tran step stop [start [maxStep]]`; `noise` -> `.noise V(out[,ref]) SRC dec|oct|lin N fstart fstop`.
- `parameters`: each name must be assigned in a top-level `.param` card (outside `.subckt`) of the netlist or a
  workbench include; the effective copy rewrites that assignment's value to the plain number (an assignment
  `name=value`, `name = value`, value a word, a parenthesized or braced expression). A name assigned nowhere, or in a
  card the helper cannot split into assignments, is refused (`parameter`). LTspice refuses a second `.param` of a name,
  so the value is never appended.
- `temperature` -> `.temp T` (LTspice's default is 27 °C).
- Effective copy `effective.net` in the run folder: the title replaced; the main netlist without dropped cards and
  without the lines after its `.end`; includes rewritten (§3); then `.temp`, `.save` of the raw vectors the requested
  vectors need (§6; none for noise), the analysis card, the sweep's `.step` and table parameters (§8), and `.end`. The
  helper adds no `.options`.
- The engine runs as `LTspice.exe -b <run folder>\effective.net` (the absolute path, so the run folder shows on its
  command line) with the run folder as working directory, without a console window; it writes `effective.raw`,
  `effective.log` and `effective.op.raw` there.

## 6 Results

- Raw file: a UTF-16LE header up to `Binary:` - `Title`, `Date`, `Plotname`, `Flags`, `No. Variables`, `No. Points`,
  `Offset`, `Command`, `Variables:` lines `\t<index>\t<name>\t<type>`. Data: `real` - per point the first variable as
  float64 and the others as float32, or all float64 with the flag `double`; `complex` - float64 pairs for every
  variable. `stepped`: the steps follow each other, the first variable restarting below its previous value at each step
  (an operating point has one point per step and no axis). The file is `partial` when the data length is not
  `points x record` or the header is incomplete, `corrupt` when the header cannot be read, a declared count is not a
  number, or a non-stepped axis decreases; a stepped run whose raw file holds another number of steps than the
  request asked for is `corrupt` too (a stepped operating point prints no `.step` lines to the log, so steps are
  identified from the raw file). A raw file with no variables (LTspice saved nothing because every `.save` vector is
  unknown to it) is read as empty, and the missing vector is reported (§7).
- Series, named as ngspice-tool names them: the axis `time`, `frequency`, `v-sweep` or `i-sweep` (by the swept source's
  letter; an operating point has no axis); `v(n)` from `V(n)`; `v(n,m)` = `V(n) - V(m)` (`0` is ground); `i(X)` from
  `I(X)`; complex vectors as `<name> re` and `<name> im`; `vdb`, `vm`, `vp`, `vr`, `vi` from the complex or real `V(n)`;
  noise `onoise_spectrum` and `inoise_spectrum` from `V(onoise)` and `V(inoise)`. Raw names match without letter case.
  `series.csv` and `plot.svg` as ngspice-tool's (a column name with a comma, such as `v(in,out)`, is quoted). As in
  ngspice-tool, noise spectra are measured with `measure` on the run folder (a request's vectors are `v(...)`/`i(...)`).
- Engine outcome `ok` when the exit code is 0, the log has `Total elapsed time`, the raw file is complete with every
  requested vector and the step count matches; otherwise `failed` with problems {kind, line} (§7).
- Measurements, criteria, units and the average-power convention: byte-identical `measure.py` of ngspice-tool. A failed
  or timed-out run has every measurement and criterion `not-evaluated` and exits 3; a noise run whose output noise is
  zero everywhere is `not-applicable` (exit 0).
- `result.json`: `format: 1`, `kind: "ltspice-tool-result"`, tool, ltspice {version, install: `per-user` | `all-users`
  | `other`}, operation, runId, times, status, request {origin, sha256, path?}, inputs [{path or library name, role
  (netlist | schematic | schematic-sheet | symbol | include | library | converted), bytes, sha256}], analysis, temperature, parameters,
  title, droppedCards, options (as written), engine {exit, seconds, problems, loaded}, series {file, rows, columns,
  steps}, measurements, criteria, warnings, limits, artifacts. `engine.loaded` lists the log's "Files loaded" in the
  form of §9. `report.md` presents the same, the loaded files included. The run folder also holds `input/`, `effective.net`, `effective.log`,
  `effective.raw` and `effective.op.raw` (the raw file opens in LTspice's waveform viewer).

## 7 Engine failures

Problems quote the log lines in the form of §9:
- `model` - `Undefined model`; `subckt` - `sub-circuit name is not defined`, `unknown subcircuit`; `include` -
  `File not found`;
- `singular` - `paralleled making an over-defined circuit matrix` or `Singular matrix`;
- `convergence` - `Time step too small`, `Iteration limit reached`, `failed to find operating point`, `Convergence
  failure`, `Simulation failed`;
- `netlist` - any other `<file>(<line>): <message>`; `engine` - a non-zero exit with none of these (an access
  violation, exit 0xC0000005, names the known cause: a `%` in a folder or file name);
- `partial`, `corrupt` - the raw file (§6); `vector` - a requested vector the raw file lacks; `limit` - stopped by the
  data limit (§10).
A failed run is never retried with other settings.

## 8 Sweeps

`sweep` takes the run request plus `sweep` {parameter | "temperature", values 2..100, distinct} or `monteCarlo` {seed,
runs 2..200, tolerances} with ngspice-tool's draws (byte-identical `sweep.py`). One engine run computes every point:
- temperature: `.step temp list <values ascending>` (LTspice runs the first dimension in ascending order); step k is
  the k-th smallest value, and the result lists the points in the request's order;
- a parameter or Monte Carlo: `.step param vera_point list 1 2 ... N`, and every varied parameter's top-level
  assignment rewritten (§5) to `table(vera_point, 1, v1, 2, v2, ..., N, vN)`; step k is point k.
Each point's series is written to `points/<n>/series.csv` and `plot.svg` and measured (result.json `series`:
{files, steps, columns, axis}); the result lists each point's
inputs (seed and drawn values) and measurements, and per measurement min, max, mean and the criteria pass count. The
sweep's time limit is the request's `timeLimit` for the whole engine run; a failed or timed-out engine run fails every
point.

`measure`, `compare` and `report` are ngspice-tool's on `ltspice-tool-result` folders (hash checks, deltas, summaries);
`compare` names the differences of netlist hashes, analysis, temperature, parameters, seed and drawn values.

## 9 Paths in results and reports

`result.json`, `report.md`, `report.json` and the printed output (refusals included: an include written as an
absolute path is shown by its file name) name a file by its path relative to the working directory (absolute
forms: `C:\...`, `C:/...`, `\\server\...`, `//server/...` and root-relative `\...`); a library file as `<LTspice library>/<sub|cmp>/<name>`; any other absolute path that appears in an engine
line (the run folder, the netlist's folder, a library) is replaced by the same forms, and a path outside them by its
file name (a path runs to the end of the line, to a `(line):` mark or to a character no Windows path holds, so a
path with spaces goes whole). The title and the leading comment lines of a file are shown the same way (an
LTspice-written `.net` starts with `* <absolute path>`). The LTspice executable's path is never written (only
`version` and `install`). The engine's own `effective.log` is kept as LTspice wrote it.

## 10 Limits

The profiles of ngspice-tool (standard: 1 000 000 transient points as stop/step, 100 000 DC or AC points, 32 vectors,
`timeLimit` default 120 s, at most 600 s; long: 5 000 000 points, at most 1700 s), counted over all sweep points. In
addition the raw file may hold at most twice the profile's point limit of the analysis (transient, or DC/AC/noise) in
rows over all steps: the helper watches the
file's size during the run and stops the engine beyond `header + rows x record` (record from the saved vectors),
status `failed`, problem `limit`. A time limit stops the engine: status `timeout`, the log, effective netlist and
partial raw file kept, exit 3. The helper starts LTspice without a console window and kills it on timeout, on a data
limit and when it is itself stopped; no LTspice process outlives the helper.

## Acceptance

E05-A (version identified; an `.asc` and a `.cir` fixture give real results on Windows), E05-B (op, DC, transient,
complex AC, noise and stepped raw files parsed with axis, units and step identity; partial and corrupt files
reported), E05-C (divider, RC transient and AC, noise against analytic references and against ngspice-tool on the same
request within tolerances declared in the fixture README), E05-D (not installed, missing model, non-convergence,
timeout and Stop have distinct statuses; no process left), E05-E (catalog entry Windows x64 only, no Wine, no
download), E05-F (inputs unchanged, a folder with spaces and non-ASCII characters, reports free of absolute paths).

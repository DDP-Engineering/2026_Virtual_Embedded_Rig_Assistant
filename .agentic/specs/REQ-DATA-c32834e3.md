# REQ-DATA-c32834e3 — kicad-tool 1.0.0: command line, work copy, result documents and operations

Programs of the official plugin `kicad` (`05_Software/plugins/kicad/`): `kicad-cli`, a find for the
user's KiCad, and `kicad-tool`, a standard-library PEP 723 script (`scripts/kicad_tool.py` with the
support package `scripts/kicad_support/`) that runs KiCad's command-line interface on a copy of a
project and returns structured results. Every requirement of the plugin refers to this file for exact
names. KiCad 10 is the supported version; the observations below were made with KiCad 10.0.8.

## 1 Programs and KiCad discovery

- `kicad-cli` (manifest find): Windows `%PATH%`, then `%ProgramFiles%/KiCad/*/bin/kicad-cli.exe`;
  Linux `$PATH`, then `/usr/bin/kicad-cli`. Version probe `kicad-cli version`, match
  `^(\d+\.\d+\.\d+)`, range `>=10.0,<11`; the hint names https://www.kicad.org/download/.
  Rules: `kicad-cli {version,--version,-v,--help,-h} *` is `safe`; `kicad-cli {sch,pcb,fp,sym,jobset} *` (every
  other subcommand kicad-cli 10 has) is `blocked` with a note that `kicad-tool` runs KiCad on a copy of the
  project; any other text keeps VERA's default `device-write`.
- `kicad-tool` locates kicad-cli itself in the same order (a script program receives no other
  program's path): each absolute PATH entry in order (a relative entry would name a workbench folder) (`kicad-cli.exe` on Windows; on Linux an executable
  `kicad-cli`), then on Windows `<Program Files>\KiCad\<folder>\bin\kicad-cli.exe` for the folders in
  descending numeric-aware name order (`<Program Files>` from the known-folder API, because the
  program environment carries no `ProgramFiles`), on Linux `/usr/bin/kicad-cli`. The first file found
  is used. It runs `kicad-cli version` (30 s); the first line that starts with `<major>.<minor>.<patch>` gives
  the version, and the major must be 10. Otherwise the run is refused (`kicad`, §7) naming what was searched or
  the version found.

## 2 Command line

```text
kicad-tool --version                     prints "kicad-tool <version>"
kicad-tool --help | -h
kicad-tool <operation> --help
kicad-tool <operation> --project FILE [--results-dir DIR] [--run-id ID] [operation options]
```

- `<operation>`: `inspect`, `erc`, `drc`, `bom`, `netlist`, `export`, `review-report`, the first
  argument; option abbreviations are not accepted; an option or flag given twice is a usage error.
- `--project FILE`: a `.kicad_pro`, `.kicad_sch` or `.kicad_pcb` file. Its path follows the rules of
  `elec-calc --input` (spec REQ-DATA-3d15fdfc §1): at most 1024 UTF-16 units of valid Unicode
  without control characters, judged from its text before any file-system access, inside the working
  directory, links resolved and still inside, a regular file. The project folder is the file's
  folder and its name the file's stem.
- `--results-dir DIR`, `--run-id ID`: as for `elec-calc report` (default `electronics-results`, run id
  `<UTC yyyymmddThhmmssZ>-<8 random hex>`, never inside `.vera`, never a link out, created
  exclusively, never overwritten).
- `drc` and `review-report`: `--refill-zones` (default off).
- `export`: `--kind KIND` (required) with KIND one of `sch-pdf`, `sch-svg`, `pcb-pdf`, `pcb-svg`,
  `gerbers`, `drill`, `pos`; `--layers L1,L2,...` is required for `pcb-pdf`, `pcb-svg` and `gerbers`
  and refused for the others. Layer names are KiCad's canonical names (`F.Cu`, `In1.Cu`, `B.Mask`,
  `Edge.Cuts`, ...) and must exist in the board's layer table; at most 64 distinct names.
- No option passes text to kicad-cli: the helper builds every kicad-cli argument itself, never uses
  `--save-board`, `upgrade`, `jobset`, `--define-var`, `--variant`, `--drawing-sheet` or a theme, and
  writes outputs only into the run folder or the work copy.

## 3 Project files and the work copy

The project consists of the files below. The named file must exist; the others are used when present.

| Role | File |
|---|---|
| `project` | `<stem>.kicad_pro` |
| `schematic` | the named `.kicad_sch`, else `<stem>.kicad_sch` |
| `sheet` | every sheet file reached from the root schematic |
| `board` | the named `.kicad_pcb`, else `<stem>.kicad_pcb` |
| `rules` | `<stem>.kicad_dru` |
| `library-table` | `sym-lib-table`, `fp-lib-table` in the project folder |
| `library` | each library of those tables whose `uri` starts with KIPRJMOD (any of its four spellings) (a `.kicad_sym` file, or the `.kicad_mod`/`.kicad_sym` files of a folder: a `.pretty` footprint library or a KiCad 10 symbol folder) |
| `drawing-sheet` | a `.kicad_wks` named by the `.kicad_pro` with a relative or KIPRJMOD path |

- Every project file is copied to the path the project names for it (links not resolved), relative to the
  project folder, so the copies name each other as the originals do; that path and the file it resolves to
  (links followed) must both lie inside the project folder, else the file is a `project` refusal. A library
  of a library table or a drawing sheet that lies outside is not copied, with a warning (KiCad then reports
  the library missing, or uses its default frame, in that run). A sheet file named by an absolute path, one
  starting with `~`, or one whose `..` climbs above the project folder at any point (even to come back in by
  the folder's name, which the copy does not keep) is a `project` refusal; a library or drawing sheet whose
  name climbs so is treated as outside. A library table entry or drawing sheet on a network or device path
  (two leading slashes or backslashes, or Windows' NT prefix `\??\` with any slashes) is a `project` refusal: KiCad
  must not open another host's files or a device. KiCad
  fills in variables in such paths in more spellings than a scanner can follow and lets the project's
  `text_variables` override its own, so kicad-tool uses an allow-list: a project library path or drawing sheet
  may hold `$` or `%` only as one leading token followed by `/` or `\` - `${KIPRJMOD}`,
  `$(KIPRJMOD)`, `$KIPRJMOD` or `%KIPRJMOD%` (the project folder: copied) or `${NAME}`/`$(NAME)` for KiCad's own
  `KICAD<n>_...` or `KISYS...` variables (read in place) - else it is a `project` refusal; a sheet file name holding
  `$` or `%` is refused. A project text variable named `KIPRJMOD`, `KICAD<n>_...` or `KISYS...` (any letter case),
  or whose value could make a path of the user's global library table a network or device path - it starts with
  two slashes or backslashes, is made of slashes only (`${V}/x` gives `//x`), or refers to another variable (`$`,
  or `%` before a non-blank; KiCad expands variables inside values) - is a `project` refusal, as is a NUL
  character in a variable's name or value (KiCad reads only up to it, so `KIPRJMOD\0x` would be KIPRJMOD);
  other values (URLs, text, `1%`) are accepted. A library entry of any type other than `KiCad` is refused: a nested `Table` names files
  kicad-tool would not check, `Legacy` and imported formats are not KiCad 8+ files, `HTTP` and `Database` contact
  a server. KiCad uses the last `type` and `uri` of an entry (observed), so every one is checked.
- Simulation models: only ERC's simulation model check opens the model files symbols name (`Sim.Library`), and a
  model file can include any other file. KiCad 10.0.8 runs that check unless the project's
  `erc.rule_severities.simulation_model_issue` is absent or exactly `ignore` (observed; netlist, BOM and exports
  open no model), so `erc` and `review-report` refuse a project that turns it on; model paths are neither copied
  nor checked.
- The board is parsed (format, layers) only by the operations that read it (`inspect`, `drc`, `review-report`, the
  board exports); the others copy it unparsed.
- Sheet walk: a sheet's file is its first property named `Sheetfile` or `Sheet file` in any ASCII letter case
  (KiCad 10.0.8 takes the first and ignores look-alikes such as `ſheetfile`, observed), relative to the folder of the schematic that contains the sheet. Every sheet file must exist, parse (§4) and resolve inside the project
  folder; a sheet file reached twice (a repeated sheet) is one file with several instances; at most 4096
  sheet instances.
- Every file is read once into memory (at most 2048 files and 512 MiB together); its SHA-256 is
  computed from those bytes and the same bytes are written to the work copy, a new folder created
  with `tempfile.mkdtemp(prefix="kicad-tool-")` that keeps the files' paths relative to the project
  folder. kicad-cli runs only on the work copy (it creates or rewrites `<stem>.kicad_prl` in the
  folder of the file it reads, observed with KiCad 10.0.8). The work copy is removed when the run
  ends, also after a refusal or failure; only a stop that kills the process leaves it behind.
- After the last kicad-cli call every source file is hashed again; a changed or missing source ends
  the run with `source` (exit 3).
- Libraries outside the project folder, global library tables and KiCad's own configuration are read
  by kicad-cli in place; the helper never writes to them.

## 4 Native files and the S-expression parser

- Tokens: `(`, `)`, double-quoted strings and atoms, split as KiCad 10.0.8 splits them (observed): at space, tab,
  CR and LF (schematics, boards and netlists also at NUL); an atom starts with any other character but a quote
  and runs to the next split or parenthesis, quotes included (`x"` is one atom). A control or Unicode space
  character outside a quoted string (`\v`, `\f`, NBSP, ...) is a `project` problem, as KiCad's readers may split
  there differently. In schematics, boards and netlists a line whose first character after blanks (NUL included)
  is `#` is a comment, a string ends on its own line, and strings undo the escapes `\\`, `\"`, `\a`, `\b`, `\f`, `\n`, `\r`, `\t`, `\v`, `\x` with one or
  two hex digits (a lone `\x` reads `x`) and one to three octal digits (low 8 bits), a backslash before anything
  else staying; an escape of a byte above 0x7F is a `project` problem (KiCad decodes such bytes as UTF-8 and
  never writes them escaped); library tables have no comments and no escapes, a string running to the next `"`. A file is one
  top-level list. At most 64 MiB per parsed file - schematic,
  board or library table (copied files: 128 MiB) and a nesting depth of 256. A number token that is not finite reads as absent. An unterminated string, an unbalanced parenthesis or trailing content is a
  `project` problem naming the file and the 1-based line and column.
- Format version: the top-level `(version N)` of a schematic or board. A file whose first bytes are
  not `(kicad_sch` or `(kicad_pcb` respectively, such as the KiCad 5 formats, is refused with a
  message that KiCad 10 must open and save it first. A version above the newest written by KiCad 10
  (schematic 20260306, board 20260206) is refused as saved by a newer KiCad, and one below KiCad 8's
  (schematic 20231120, board 20240108) as saved by an older KiCad (open and save it in KiCad 10). A KiCad 8 or 9
  version is accepted with a warning that KiCad 10 converts it in memory for this run and the source stays
  unchanged. The project file is JSON; invalid JSON, NaN, Infinity, a number too large to be finite or a key
  repeated in one object (KiCad might read another value than kicad-tool) is a `project` problem.
- Fields read from native files: schematic `version`, `generator_version`, `uuid`, sheets
  (`Sheetname`, `Sheetfile`, `uuid`); board `version`, `layers` (ordinal, canonical name, type, user
  name), `setup/stackup`, footprints (reference, value, library id, layer, position, rotation,
  `attr` flags), segments and arcs (width, layer, net, length), vias (size, drill, layers, net),
  zones (net, layers); project `net_settings` (classes and patterns). Connectivity comes from KiCad's
  netlist (§6.2), never from geometry in the files.

## 5 Result document and run folder

Each operation creates `<results-dir>/<run-id>/` exclusively, writes there the KiCad outputs it
asked for, `result.json` (the complete document, UTF-8, indented) and `report.md`, and prints one
JSON document of at most 11 000 UTF-16 units:

```text
format 1, tool "kicad-tool", version, operation, status "completed", runId, started, finished,
kicad {executable, version}, project {folder, name, files: [{path, role, bytes, sha256, format?}]},
summary {...operation, §6...}, warnings [text], limits [text],
artifacts [{path, kind, bytes, sha256}], result "<run folder>/result.json", truncated
```

Paths are relative to the working directory with `/`. Each message and warning is cut to 600 UTF-16 units.
When the full document exceeds the bound, the printed one drops list entries from the end - bulk first
(instances, nets, board lists, hierarchy, rows, files), then findings (violations, unconnected items,
parity, also inside a review's `erc`/`drc`; duplicate references), then the review facts, then artifacts, project files and
warnings - keeps
every count (also of a review's parts, and every `...Count` field) and sets `truncated: true`; `result.json` keeps everything and lists
every artifact but itself. Coordinates are in mm
as KiCad reports them.

## 6 Operations

### 6.1 inspect

Needs a schematic or a board. Calls kicad-cli `sch export netlist --format kicadsexpr` (schematic)
and `pcb export stats --format json` (board). Summary and result:

- `hierarchy`: one entry per sheet instance - `path` (names, e.g. `/ch1/`), `uuidPath`, `file`,
  `sheetName`.
- `instances`: one entry per placed symbol unit instance - `uuidPath` (`<sheet uuidPath><symbol
  uuid>`, the identity), `reference`, `value`, `footprint`, `libId`, `sheetPath`, `fields` (name →
  value), `mpn` (the first non-empty field named `MPN`, `Manufacturer Part Number`,
  `Manufacturer_Part_Number`, `MFR PN` or `Mfr. No`, compared case-insensitively; else null), `dnp`,
  `excludeFromBom`, `excludeFromBoard` (from the netlist's `dnp`, `exclude_from_bom`,
  `exclude_from_board` properties). A reference alone never identifies an instance.
- `nets`: count, and in `result.json` every net with code, name, class and nodes (reference, pin,
  pin function, pin type).
- `board`: layers, stackup (`available: false` without one), dimensions and counts from KiCad's
  statistics, footprints, per-net track count/length/widths, via sizes, zones, net classes and
  patterns from the project file; `unconnected` is `not-evaluated` (only `drc` evaluates it).

### 6.2 netlist

Needs a schematic. Writes KiCad's `netlist.net` (kicadsexpr) and `nets.json` (nets as in 6.1 and
components by reference with their instances).

### 6.3 bom

Needs a schematic. From the netlist's components: `bom.json` (every instance as in 6.1, plus groups)
and `bom.csv` (UTF-8, header `Quantity,References,Value,Footprint,MPN,DNP`). Instances excluded from
the BOM are listed in `bom.json` under `excluded` and appear in no group. A group is the set of
instances with equal value, footprint, MPN and DNP flag; references are sorted naturally (`R2` before
`R10`).

### 6.4 erc

Needs a schematic. Calls `sch erc --format json --severity-all --units mm`; keeps KiCad's file as
`erc.json`. Summary: counts by severity (`error`, `warning`, `exclusion`) and by type; violations
(type, severity, description, sheet path and uuid path, items with description, uuid, x, y and the
instance's reference when the item is a symbol); `ignoredChecks`; `libraryIssues` (the violations of
type `lib_symbol_issues`); `duplicateReferences`, kicad-tool's own check, which KiCad 10's ERC lacks: each
reference that two placed symbol instances carry for the same unit, with unit, count, sheet paths and UUID
paths, and `duplicateCount`. A reference is the last `reference` (and the unit the last `unit`, else 1) of the
last entry for the instance's path in the symbol's `instances` block, which KiCad 8 and later write for every
placed symbol (KiCad reads them so, observed). A symbol without such an entry (an edited or merged file) gets
another entry's reference or its Reference field from KiCad (observed), so it is left out of the check and a
warning gives their number. Power symbols (`#...`) and unannotated symbols
(`R?`, or an empty instance reference, which KiCad shows as `R?`; KiCad's ERC reports them itself) are not counted. `report.md` lists them. Violations are results: the run is `completed` with exit 0.

### 6.5 drc

Needs a board. Calls `pcb drc --format json --severity-all --units mm`, with `--schematic-parity`
when the project has a schematic and `--refill-zones` when asked (on the work copy; never
`--save-board`); keeps `drc.json`. Summary: `counts` (violations by severity, unconnected and parity as
totals) and `types` over all three, the entries as for ERC, `ignoredChecks`, `zonesRefilled`, `parityChecked`. `limits`
always states that DRC compares the board with its rules and that zero violations does not validate
function, current capacity, impedance or return paths.

### 6.6 export

| Kind | kicad-cli | Output in the run folder | Format check |
|---|---|---|---|
| `sch-pdf` | `sch export pdf` | `exports/<stem>.pdf` | starts `%PDF-`, ends with `%%EOF` |
| `sch-svg` | `sch export svg` | `exports/sch-svg/*.svg` | XML whose root is `svg`, one per sheet file instance KiCad plots |
| `pcb-pdf` | `pcb export pdf --mode-multipage` | `exports/<stem>-pcb.pdf` | as `sch-pdf` |
| `pcb-svg` | `pcb export svg --mode-multi` | `exports/pcb-svg/*.svg` | as `sch-svg`, one per layer |
| `gerbers` | `pcb export gerbers` (X2, netlist attributes, precision 6) | `exports/gerbers/` | one file per requested layer with `%TF.FileFunction`, ending `M02*`; the job file |
| `drill` | `pcb export drill --format excellon --excellon-units mm --excellon-separate-th --generate-report` | `exports/drill/` | `M48` header, `M30` end, tool table and hole count per file |
| `pos` | `pcb export pos --format csv --units mm --side both` | `exports/<stem>-pos.csv` | header `Ref,Val,Package,PosX,PosY,Rot,Side`, one row per footprint |

The summary lists the options used, each file with its check (`pass` or `fail` with the reason) and
checks: for `sch-svg` the file count against the sheet instances, for `pcb-svg` against the layers; for
`gerbers` each layer's `%TF.FileFunction` against the layer (copper Top/Bot/Inr, mask, paste, legend,
profile) and a missing job file is a failed entry; for `drill` and `pos` the counts compared with the board (holes; footprints not marked
`exclude_from_pos_files`). A failed check is reported, not hidden; the run still completes.

### 6.7 review-report

Runs `inspect`, then `erc` when there is a schematic and `drc` when there is a board, in one run
folder. The summary holds `counts`, `erc` and `drc` (the summaries of 6.4 and 6.5, or null), `facts`,
`hierarchy`, `instances`, `nets` and `board`. `report.md` has the sections Project, KiCad checks (ERC, DRC), Facts for review (power nets:
nets with a `power_in` or `power_out` pin; nets with a single node; instances without footprint; DNP
instances) and Limits (DRC limit of 6.5; the facts are not a functional review; a net is not sized
without its electrical requirements).

## 7 Problems and exit codes

| Exit | Status | When |
|---|---|---|
| 0 | `completed` | the operation ran; violations and failed export checks are results |
| 2 | `refused` | `usage`, `path` (also an existing run folder), `project`, `kicad` (missing or unsupported), `layer` - before any kicad-cli run of the operation; nothing is left in the results directory |
| 3 | `failed` | `run` (kicad-cli could not start, exited with a nonzero code, timed out after 1500 s or produced no expected output - the message quotes the last 2000 characters of its output - or any other unexpected error after the copy), `source` (a source changed during the run), `output` (the temporary work folder or the run folder could not be created or written); the run folder is removed |

A refusal or failure prints `{format, tool, version, operation, status, runId?, errors: [{code,
path, message}]}`.

## Acceptance

The fixtures under `05_Software/tests/fixtures/kicad/` (fictional projects made for these tests)
give: a hierarchical schematic with a sheet used twice whose instances keep distinct `uuidPath`s and
references; planted ERC defects reported with their types, severities and objects; a board with a
short, a clearance violation and an unrouted net reported by DRC; exports whose checks pass; source
hashes equal before and after every operation, after a refusal, after a failure and after a stopped
run; the refusals of §7 with their messages.

## Assumptions

- KiCad 10.0.8 is the observed version; the format versions of §4 are those it writes. With it, the netlist
  marks DNP and exclusions with the properties `dnp`, `exclude_from_bom` and `exclude_from_board`, a sheet file
  resolves from the folder of the referencing schematic, `sch export svg` writes one file per sheet instance,
  and kicad-cli started detached on Windows prints nothing.
- The path rules of `elec-calc` live in `workspace.py`, a byte-identical copy in `elec_support` and
  `kicad_support`.

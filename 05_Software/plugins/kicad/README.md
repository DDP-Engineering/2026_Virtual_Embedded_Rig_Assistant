# kicad

Analyse KiCad 10 projects in VERA without changing them: the sheet hierarchy, symbol instances, nets, board
layers and net classes; KiCad's ERC and DRC with their objects and positions; a BOM, KiCad's netlist and
inspection or fabrication exports, each checked. The exact interface is the specification
`.agentic/specs/REQ-DATA-c32834e3.md` of the VERA repository and `kicad-tool <operation> --help`.

## Programs

- `kicad-cli` finds your KiCad: PATH first, then `%ProgramFiles%\KiCad\<newest>\bin\kicad-cli.exe` on Windows,
  `/usr/bin/kicad-cli` on Linux. VERA checks that it reports KiCad 10 (`kicad-cli version`) and never installs
  KiCad; install it from https://www.kicad.org/download/. Only `version` and `--help` may run directly: every
  other kicad-cli command is blocked, because kicad-cli writes into the folder of the files it reads (it
  creates or rewrites `<project>.kicad_prl`) and can save or upgrade a project.
- `kicad-tool` (a Python script on the standard library, run by VERA's uv offline) locates the same kicad-cli in
  the same order, reads the project, copies the files KiCad needs into a temporary folder and runs kicad-cli
  only there.

## Operations

```text
kicad-tool inspect       --project FILE   hierarchy, instances, nets, board facts
kicad-tool erc           --project FILE   electrical rules check, every severity
kicad-tool drc           --project FILE [--refill-zones]   design rules check, unconnected items, parity
kicad-tool bom           --project FILE   bom.csv and bom.json grouped by value, footprint, MPN and DNP
kicad-tool netlist       --project FILE   KiCad's netlist and nets.json
kicad-tool export        --project FILE --kind KIND [--layers F.Cu,B.Cu,...]
kicad-tool review-report --project FILE [--refill-zones]   inspect, ERC and DRC with report.md
```

`FILE` is the `.kicad_pro`, `.kicad_sch` or `.kicad_pcb` of the project, inside the working directory. Every
operation also takes `--results-dir DIR` (default `electronics-results`) and `--run-id ID`. Export kinds:
`sch-pdf`, `sch-svg`, `pcb-pdf`, `pcb-svg`, `gerbers` (these three need `--layers`), `drill`, `pos`.

Each run creates `<results-dir>/<run-id>/` with `result.json` (everything), `report.md` and KiCad's own files
(`erc.json`, `drc.json`, `netlist.net`, `stats.json`, `exports/...`), and prints one JSON document of at most
11 000 characters with the project files and their SHA-256, the summary, warnings, limits and artifacts. When
a summary is longer, list entries are left out of the printed document (`truncated: true`); `result.json` has
them all.

## What it guarantees

- The project is never changed. The files are read once and hashed; kicad-cli works on a copy of those bytes;
  after the last call the sources are hashed again and a run whose sources changed is discarded (exit 3).
  `--refill-zones` refills the zones of the copy only; nothing is ever saved.
- A symbol instance is identified by its sheet's UUID path and the symbol UUID: in a sheet used twice the
  reference alone is not an identity. Nets come from KiCad's netlist, never from drawing geometry.
- ERC and DRC violations are results (exit 0) with every severity, the sheet, objects, positions and the
  checks KiCad ignored. `erc` also lists duplicate references, which KiCad 10's ERC does not report (a symbol
  without a reference entry for its sheet path, as only an edited file has, is left out with a warning)
  (power symbols and unannotated `R?` excluded). DRC always carries the limit that zero violations does not validate function, current
  capacity, impedance or return paths.
- Refused before KiCad runs (exit 2, nothing written): a path outside the working directory, a missing sheet
  file (KiCad itself would report no violation), a malformed file (with line and column), a file saved by a KiCad
  older than 8 or newer than 10 (never converted; open it in KiCad 10 and save it), an unknown export layer
  (kicad-cli would plot the others silently), a missing or non-10 KiCad. A file from KiCad 8 or 9 runs with a
  warning: KiCad converts it in memory only. The board is checked only by the operations that read it (inspect,
  drc, review-report and board exports); erc, bom, netlist and schematic exports copy it unread.
- `erc` and `review-report` refuse a project that turns on ERC's simulation model check
  (`simulation_model_issue` other than `ignore`): that check opens every model file a symbol names and the files
  those include. Set the check to `ignore` for kicad-tool; models are a simulation plugin's work.
- Exports are checked: PDF and SVG structure, one Gerber with `%TF.FileFunction` per requested layer, drill and
  position counts against the board. A failed check is reported, not hidden.

## Paths and limits

Paths follow the rules of `elec-calc` (shared module `workspace.py`): at most 1024 UTF-16 units, no control
characters, no network or device path, no other drive, links resolved and kept inside the working directory,
run folders never inside `.vera` and never overwritten. Every project file must lie inside the project folder
once links are resolved; a file linked from elsewhere is refused (a library linked from elsewhere is not copied,
with a warning; a drawing sheet linked from elsewhere also only warns). Sheet files whose `..` climbs above the
project folder, that start with `~` or hold `$` or `%`; project libraries and drawing sheets on network paths or
using any variable other than a leading KIPRJMOD or KiCad's own KICAD.../KISYS... (so a project table cannot use
your own path variables such as `${MY_LIBS}`); libraries of any type other than `KiCad` (nested tables, KiCad 5
`Legacy` libraries, imported formats, HTTP and Database); and text variables that redefine KiCad's own or whose
value starts with two slashes, is only slashes or refers to another variable (`$`, or `%` before a non-blank), or
whose name or value holds a NUL character (KiCad reads only up to it), are
refused, as are paths starting with Windows' NT prefix `\??\`. Files are read as KiCad 10 reads them: tokens
split at KiCad's blanks only (a quote inside a word stays in it), schematic and board strings with KiCad's
escapes and `#` comment lines, library tables without escapes, a sheet's first `Sheetfile`/`Sheet file`
property (ASCII letter case), every `type` and `uri` of a library entry, and symbol libraries given as folders.
Where KiCad's readers could disagree - a control or Unicode space character outside a quoted string, an escape
of a byte above 0x7F - the file is refused. At
most 2048 project files and 512 MiB are copied; one file is at most 128 MiB, a parsed
schematic, board or library table at most 64 MiB, a hierarchy at most 4096 sheet instances. Sheet files named by
an absolute path are refused; links inside the project folder are copied as links name them. Libraries outside the project folder and KiCad's global library tables are read in
place by kicad-cli. A run stopped by killing it leaves its temporary copy behind; the project stays unchanged.

## What it does not do

It changes no schematic or board, reconstructs no connectivity from pictures, runs no OCR, judges no circuit
by itself (the skills guide that review), exports no 3D model and runs no jobset or upgrade. Verified with
KiCad 10.0.8 on Windows 11, also through VERA's provisioner and runner with a real uv; the native Ubuntu x64 run
is pending.

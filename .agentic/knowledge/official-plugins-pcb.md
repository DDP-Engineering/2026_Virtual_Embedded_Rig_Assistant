# Official plugins: KiCad review, PCB layout and autorouting

## Routing

Select for `kicad` (find `kicad-cli` for the user's KiCad 10 and the `kicad-tool` script that analyses a project on a
copy: inspect, ERC, DRC, BOM, netlist, exports, review report; skills schematic-review and pcb-review);
`kicad-layout`; and `freerouting`.

For kicad, start at plugins/kicad/plugin.yaml, scripts/kicad_tool.py and scripts/kicad_support/ with spec
.agentic/specs/REQ-DATA-c32834e3.md; tests/plugins/kicad.test.ts and tests/fixtures/kicad/ (fictional KiCad 10
projects, make_fixtures.py, internals.py) own its refusal, real-KiCad, integrity and provisioner coverage. The path
rules of the electronics plugins live in `workspace.py`, a byte-identical copy in elec_support, kicad_support and
parts_support (a test checks all three).

For kicad-layout, start at plugins/kicad-layout/plugin.yaml, scripts/kicad_layout_tool.py and
scripts/kicad_layout_support/ (cli.py for open/edit/close, kicad.py for the editor process, API session and binding,
operations.py for the checks and the commit, drc.py, report.py, state.py, candidate.py) with spec
.agentic/specs/REQ-DATA-891d5b5d.md; tests/plugins/kicad-layout.test.ts and tests/fixtures/kicad-layout/ (board
generator, hooks) own its coverage, the PCB editor tests only under VERA_TEST_KICAD_GUI. Applying a candidate is
core's apply_candidate ([File tools](file-tools.md)). Its workspace.py is a byte-identical copy of kicad-tool's.

For freerouting, start at plugins/freerouting/plugin.yaml, scripts/freerouting_tool.py,
scripts/freerouting_support/{cli,ses}.py and scripts/export_dsn.py (run by KiCad's Python) with spec
.agentic/specs/REQ-FUNC-2a80da7f.md; tests/plugins/freerouting.test.ts owns its coverage (real router under
VERA_TEST_FREEROUTING_JAR + VERA_TEST_JAVA, the golden path through kicad-layout under VERA_TEST_KICAD_GUI).

The conventions shared by all official plugins (package format, catalog source, packs, versions and evidence
levels) and the page of every other plugin are in [Official plugins](official-plugins.md). The platform that
installs, classifies, approves and runs these programs is [Plugins](plugins.md); plugin skill discovery is
[Skills](skills.md).

## Public interface

- `kicad` 0.3.0, ecosystem `electronics` (Electronics design pack, group Schematic and PCB (KiCad), default on;
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
  (exit 2) or run, source, output (exit 3). Evidence: KiCad 10.0.8 on Windows 11, also through the
  opt-in `VERA_KICAD_UV` run (real uv, managed CPython, ProgramRunner); native Ubuntu has not been run.

- `kicad-layout` 0.3.0, ecosystem `electronics` (Electronics design pack, group "PCB placement and local routing
  (KiCad)", default off; activity `design`), Windows x64 and Linux x64. Program `kicad-cli`: found as the kicad
  plugin finds it, range `>=10.0,<11`, every `kicad-cli {sch,pcb,fp,sym,jobset}` command blocked. Program
  `kicad-layout-tool` = `scripts/kicad_layout_tool.py` (PEP 723: kicad-python 0.8.0, protobuf 5.29.6, pynng 0.9.0),
  `uses: [kicad-cli]`, `gui: true` (its runs get the desktop's display variables for the PCB editor), operations
  open/edit/close safe (they change only a run folder and the editor window the helper started). The PCB editor is `pcbnew` next to that kicad-cli. `open` refuses (`binding`) while any KiCad API
  answers, copies the board, `<stem>.kicad_pro`, `.kicad_dru`, `fp-lib-table` and the folder's `.kicad_sch` files
  into `<results>/<run-id>/candidate/`, starts the editor on the copy (DEVNULL handles, PID in state.json), binds
  when the API's open documents name the copy (project folder + file name), saves through KiCad, reloads (revert)
  and records the in-memory text hash, writes board.json/board-open.json (footprints with pads, nets, copper
  layers, outline, routing), drc-before.json and before previews; any failure stops the editor and removes the
  folder. `edit` checks the request statically (format 1, units mm, place/align/keepout/track/via, limits, one
  move per footprint), then the candidate hashes and kicad-cli, connects, binds, compares the in-memory hash
  (unsaved edits -> `changed`), resolves the items itself (unknown or ambiguous footprint, uuid, net, non-copper
  layer, locked footprint - the API protects none of these), runs everything in one commit, then checks that every
  created track and via kept its net (KiCad gives new copper the net it touches: `net`), KiCad's bounding boxes
  against the outline and that no other item changed, by UUID and by count (revert and `net`/`outline`/`kicad`
  otherwise), binds again and saves. Right after the save state.json records the new hashes, the edit and
  objectives `none` (with requests/NNN.json and created.json); then `kicad-cli pcb drc --severity-all
  --refill-zones` (parity with a schematic) sets objectives pass/fail (new error-severity violations or more
  unconnected items than after open); a kicad-cli failure there exits 3 saying the edit was saved. result.json
  carries inputs, warnings and artifacts with SHA-256. `close` stops only the
  recorded PCB editor process when the candidate has no unsaved edits and removes KiCad's lock files. Evidence:
  KiCad 10.0.8 on Windows 11; native Ubuntu has not been run. Requests hold at most 1024
  operations (a routed request from freerouting).

- `freerouting` 0.3.0, ecosystem `electronics` (group "PCB autorouting (Freerouting)", default off; activity
  `design`), Windows x64 and Linux x64, requires kicad-layout.
  - Programs: `java` (Eclipse Temurin 25.0.5+8 JRE download, `java *` blocked); `freerouting` (the 2.5.0 jar, a
    `file` program: verified, never run, version from its file name, `freerouting *` blocked); `kicad-cli` (find);
    and `freerouting-tool route --run <kicad-layout run>` (safe), `uses: [java, freerouting, kicad-cli]`.
  - Route: copies the saved candidate's board, project and rules files; exports a DSN with KiCad's Python; marks the
    existing wiring `(type protect)`; runs `-cp jar app.freerouting.cli.FreeroutingCli` with a hosts file holding
    only localhost (no version check or analytics traffic) and user.home in `freerouting/NNN/home`; converts the
    SES's new wires and vias (0.1 µm units, Y negated) into a kicad-layout request (request.json).
  - The agent applies the request with `kicad-layout-tool edit --request`. Custom `.kicad_dru` rules are refused
    (`rules`) unless `--allow-custom-rules`.
  - Evidence: Freerouting 2.5.0, Temurin 25.0.5 and KiCad 10.0.8 on Windows 11 (the fixture routes
    to 0 unconnected, objectives pass). Native Ubuntu has not been run.

## Invariants

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

- kicad-layout: KiCad 10 serves its IPC API only from the first KiCad process on Windows, only with a GUI
  window, and lets clients move locked items and use unknown net names; it duplicates a footprint that one commit
  updates twice and gives a created track the net of the copper it touches. The helper therefore binds by the open
  document, refuses while another window holds the API, allows one move per footprint per request and checks
  locked items, nets (before and after the commit) and layers itself. The source board is never written by the
  plugin; only apply_candidate writes it, under the write policy.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| A kicad-tool operation or its summary | `plugins/kicad/scripts/kicad_support/operations.py` and the parser it uses (`netlist`, `board`, `checks`, `bom`, `exports`) | the operation's real-KiCad case in `kicad.test.ts` against `tests/fixtures/kicad/README.md` |
| A kicad-cli command line | `kicad_support/kicad.py` builders | "builds every kicad-cli call itself" (recorded calls) |
| Project files, copy, version checks | `kicad_support/project.py`, `sexpr.py` | project and format refusal tests, unchanged-sources and stop tests |
| A new KiCad release | `discovery.py` major, `project.py` newest format versions, the manifest range | regenerate the fixtures (`make_fixtures.py`) and rerun the real cases |
| A kicad-layout operation, check or report field | `plugins/kicad-layout/scripts/kicad_layout_support/{operations,cli,report}.py`, spec REQ-DATA-891d5b5d | `kicad-layout.test.ts` offline cases; the PCB editor cases with VERA_TEST_KICAD_GUI |
| kicad-layout's KiCad connection or binding | `kicad_layout_support/kicad.py` | binding, unsaved-edit, Stop and lost-connection cases (VERA_TEST_KICAD_GUI) |
| A new kicad-python release | the PEP 723 pins in `kicad_layout_tool.py` and `tests/fixtures/kicad-layout/hooks/nudge.py` | the whole kicad-layout suite with VERA_TEST_KICAD_GUI |

## Key behaviors

- `REQ-FUNC-1ae67789` / `REQ-DATA-ece2d69c` / `REQ-SEC-17f1e8d5` / `REQ-REL-20ece322` — kicad package, catalog and pack, safe kicad-tool and blocked kicad-cli, no bytecode in the installed copy.
- `REQ-DATA-c32834e3` / `REQ-SEC-85467169` / `REQ-SEC-40a76c91` / `REQ-REL-1ab91569` — kicad-tool command line and documents, shared path rules, built kicad-cli calls, 11 000-unit bound.
- `REQ-FUNC-9383047c` / `REQ-REL-24dba971` — KiCad 10 discovery and its refusal.
- `REQ-REL-09628127` / `REQ-REL-da746e30` / `REQ-REL-05743834` — work copy, discarded run on a changed source, KiCad failure apart from violations.
- `REQ-REL-c4b14f26` / `REQ-REL-426ec335` / `REQ-REL-3fe4718a` / `REQ-REL-f1bcbb19` / `REQ-REL-421726b7` — project, format and layer refusals, non-ASCII paths, library issues.
- `REQ-FUNC-57feb0b5` / `REQ-DATA-5ff34212` / `REQ-FUNC-fa7fc405` / `REQ-FUNC-c2f97c86` / `REQ-DATA-1adc8a2b` — hierarchy, instance identity, board facts, netlist, BOM.
- `REQ-FUNC-25b51df0` / `REQ-FUNC-0bf83952` / `REQ-FUNC-3c1c35b7` / `REQ-FUNC-fdd959d4` — ERC, duplicate references, DRC with its limit, zone refill on the copy.
- `REQ-FUNC-bad2229c` / `REQ-FUNC-9cb44e40` / `REQ-FUNC-bb443178` / `REQ-UX-f366d2db` — checked exports, review report, review skills.
- `REQ-TEST-07b48fde` / `REQ-PLAT-c30fa145` / `REQ-PLAT-10747605` — fictional fixtures; VERA run on Windows (opt-in `VERA_KICAD_UV`) and native Ubuntu (manual, pending).

- `REQ-DATA-891d5b5d` / `REQ-PLAT-3957eafc` / `REQ-FUNC-32022bcd` / `REQ-FUNC-f92446a1` / `REQ-FUNC-cd7d1b3f` / `REQ-FUNC-9c4d809c` / `REQ-FUNC-350e262a` / `REQ-FUNC-b0cbbb04` — kicad-layout formats, package, open, edit, unchanged check, objectives, report, close.
- `REQ-REL-19ac705f` / `REQ-SEC-6bb41c34` / `REQ-REL-d2fd6d58` / `REQ-REL-2a3f09b8` / `REQ-REL-e30bf69f` / `REQ-SEC-438b7bbf` / `REQ-SEC-a6a6482e` / `REQ-SEC-f986d80d` / `REQ-SEC-f7a0b1fe` / `REQ-REL-233d6e0f` / `REQ-REL-1dd5113a` / `REQ-REL-ea280836` — kicad-layout refusals and failures; `REQ-UX-5367fe76` skill; `REQ-TEST-63c70d58` test gating.

## Files

- `05_Software/plugins/kicad/` — manifest, README, skills schematic-review and pcb-review, `scripts/kicad_tool.py` (entry), `scripts/kicad_support/` (`workspace` shared, `sexpr`, `discovery`, `project`, `kicad`, `netlist`, `board`, `checks`, `bom`, `exports`, `review`, `document`, `operations`, `cli`).
- `05_Software/tests/plugins/kicad.test.ts`, `tests/fixtures/kicad/` (`hier`, `erc`, `board` projects, `make_fixtures.py`, README with the design-derived expectations, `internals.py` seams).
- `05_Software/plugins/kicad-layout/` — manifest, README, skill kicad-layout, `scripts/kicad_layout_tool.py` (entry, PEP 723 pins), `scripts/kicad_layout_support/` (`cli`, `request`, `state`, `candidate`, `kicad`, `operations`, `drc`, `report`, `workspace` shared).
- `05_Software/tests/plugins/kicad-layout.test.ts`, `tests/fixtures/kicad-layout/` (`make_fixtures.py` reusing the kicad fixture writers, `board/`, `hooks/` with the in-process hook, the second API client `nudge.py` and the editor stub).

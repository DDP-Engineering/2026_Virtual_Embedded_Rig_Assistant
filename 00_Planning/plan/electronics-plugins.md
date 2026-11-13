# ELEC-01...ELEC-07 Electronics engineering plugins

PURPOSE: the order and state of the seven plugins that let VERA support an electronics design flow -
reproducible calculations, schematic and PCB analysis, component selection, simulation and controlled
layout changes.
SPEC: Gitea epic [#92](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/92) and its children #93...#99 hold the specification of each work
package (deliverables, functions, Done criteria E01...E07). This page records only order, state and what
was built, so the two never diverge; the process notes inside the tickets (no AEGIS, `master` only, hand
back without commit) were set aside by the user on 2026-11-12: each package is implemented with AEGIS on
its own branch, and where a ticket is wrong the code decides.
STATE: ELEC-01 implemented 2026-11-12 on branch `feature/93-electronics-calc` from `origin/master`
97662d5 (AEGIS TASK-72227ab6, commit 19dd919); ELEC-02 implemented 2026-11-12 on the same branch at the user's
request (AEGIS TASK-7c2a9322, commit e9fa5d2); ELEC-03 implemented 2026-11-13 on the same branch (AEGIS
TASK-2c5054ba, commit 680c273); ELEC-04 implemented 2026-11-13 on the same branch (AEGIS TASK-80043c39, commit 6ad9119);
ELEC-05 implemented 2026-11-13 on the same branch (AEGIS TASK-43e9ee14, commit 0764e8f); ELEC-06 implemented
2026-11-13 on the same branch (AEGIS TASK-6101faa4); ELEC-07 planned.

## Order

| Order | Package | Issue | Plugin | Result | State |
|---|---|---|---|---|---|
| 1 | ELEC-01 | [#93](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/93) | `electronics-calc` | electrical and thermal calculations with explicit units and assumptions | implemented |
| 2 | ELEC-02 | [#94](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/94) | `kicad` | native schematic and PCB analysis, ERC/DRC, BOM and exports | implemented |
| 3 | ELEC-03 | [#95](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/95) | `parts-search` | documented component selection and controlled catalog access | implemented |
| 4 | ELEC-04 | [#96](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/96) | `ngspice` | electrical and electrothermal simulation on Windows and Linux | implemented |
| 5 | ELEC-05 | [#97](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/97) | `ltspice` | LTspice batch simulation on Windows in the same result model | implemented |
| 6 | ELEC-06 | [#98](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/98) | `kicad-layout` | placement and local routing on a candidate, checked and applied under the write policy | implemented |
| 7 | ELEC-07 | [#99](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/99) | `freerouting` | local autorouting, DSN/SES exchange and the integrated acceptance | planned |

The order is the execution order of the initiative, not a runtime dependency chain: `kicad-layout`
uses `kicad`, `freerouting` uses `kicad` and the candidate/apply adapter of `kicad-layout`, the
simulators reuse the result contracts of ELEC-01. ELEC-03 needs a first-party catalog capability
(secrets stay in the host) and ELEC-06 an apply path under the existing write policy; both are part of
those packages, not hidden manifest changes.

## Rules shared by the packages

- Finite operations with validated JSON, real paths and no generic shell, expression evaluation or MCP
  extension system; helper scripts wrap the real executables.
- A result is a document of its own (`format: 1`): operation, tool version, run id, start and end,
  inputs with hash, assumptions, results with units, warnings and artifact paths. Unknown values stay
  unknown; a check is `pass`, `fail`, `unknown` or `not-evaluated`; an incomplete run is not a success.
- Reports go to a results folder in the workbench (default `electronics-results/<run-id>/`), created
  exclusively, never inside `.vera`, never over a source file.
- No permission is relaxed for automation: a `safe` report never authorizes changing a PCB source.
- Evidence comes in three classes - deterministic offline tests, runs with the real tools on fixtures,
  live probes with suppliers or parts - and a mock never proves a commercial integration.
  Verification follows `02_Tools/verification-policy.md`.

## ELEC-01 as built

- Package `05_Software/plugins/electronics-calc/`: program `elec-calc` (`scripts/elec_calc.py`, a PEP
  723 script on the standard library, so it runs offline without any package) and the support package
  `scripts/elec_support/`, the single source of the quantity, result and report contracts. Skills
  `electronics-sizing` and `thermal-analysis`. Every command is `safe`.
- Operations: `dc` (Ohm's law, series, parallel, shunt), `divider` (loaded divider, resistor sizing),
  `rc` (time constant, first-order filter, peak/RMS/average), `losses` (linear regulator with an
  explicit Iq decision, resistor with derating, MOSFET conduction/switching/gate drive, diode, capacitor
  ESR, inductor DCR, power budget), `thermal` (thetaJA estimate, junction-case-sink path and heatsink
  sizing, supplied Foster network), `tolerance` (all corners, three-point monotonic check, seeded Monte
  Carlo), `report` (JSON and Markdown in a new run folder). Exact interface: spec
  `.agentic/specs/REQ-DATA-3d15fdfc.md`, the plugin README and `elec-calc <operation> --help`.
- Robustness, from the first review round: no input ends in a traceback or a non-finite number; a
  printed document stays within 11 000 UTF-16 units (the runner returns the last 12 000) and leaves its
  tables to `report.json`; paths are judged from their text before any file-system access; a failed
  report removes what it created and exits 3; `tolerance` has a 600 s and `report` an 1800 s rule
  timeout.
- Catalog: `official`, pack `electronics` (Electronics design), group Calculations. The catalog
  activity vocabulary gained `design` (library filter label in en/ro/de), because none of the nine
  earlier activities describes design work and every bundled plugin carries one.
- Departures from the ticket: tests run through Vitest on the toolchain Python against hand-derived
  fixtures instead of a separate Python test runner; Cauer networks and repetitive-pulse superposition
  are outside this version; a later plugin receives `elec_support` as a verified copy (the mechanism
  is decided by its first consumer).
- Criteria: E01-A...E01-F are covered by `05_Software/tests/integration/electronics-calc.test.ts` on
  Windows, including the opt-in run through VERA's provisioner and a real uv on its managed CPython 3.13
  (`VERA_ELEC_UV`, passed 2026-11-12). Open: native Ubuntu x64 (requirement `REQ-PLAT-7f86133e`).
- Questions left to the user: a current derating for diodes (ticket function 5 names "diodes and
  resistors"; only the resistor has one), CSV files for series such as the Foster response, and whether
  `report.md` should repeat the detail tables of `report.json`.

## ELEC-02 as built

- Package `05_Software/plugins/kicad/`: program `kicad-cli` (find for the user's KiCad 10: PATH, then
  `%ProgramFiles%/KiCad/*/bin` or `/usr/bin`, probed with `kicad-cli version` against `>=10.0,<11`; only version
  and help may run, every `sch`/`pcb`/`fp`/`sym`/`jobset` command is blocked) and program `kicad-tool`
  (`scripts/kicad_tool.py`, PEP 723 on the standard library, support package `scripts/kicad_support/`). Skills
  `schematic-review` and `pcb-review`. Catalog `official`, activity `design`, pack `electronics`, group
  Schematic and PCB (KiCad). Exact interface: spec `.agentic/specs/REQ-DATA-c32834e3.md`.
- Operations `inspect`, `erc`, `drc`, `bom`, `netlist`, `export` (`sch-pdf`, `sch-svg`, `pcb-pdf`, `pcb-svg`,
  `gerbers`, `drill`, `pos`) and `review-report`, each writing a new run folder with `result.json`, `report.md`
  and KiCad's files.
- Observed with KiCad 10.0.8 and decisive for the design: kicad-cli creates or rewrites `<project>.kicad_prl`
  in the folder of the file it reads, so it runs only on a hashed copy in a temporary folder and the run folder is
  written last, after a second hash of the sources; kicad-cli's ERC reports zero violations for a missing sheet
  file and plots the remaining layers with exit 0 for an unknown one, so the helper refuses both itself; started
  detached on Windows kicad-cli prints nothing, so VERA's provisioner now starts its probes and uv calls attached
  on Windows, like program runs (REQ-REL-380ee422).
- The path rules of `elec-calc` moved into `workspace.py`, a byte-identical copy in `elec_support` and
  `kicad_support` checked by a test: this is the "verified copy" mechanism decided by the first consumer.
- Departures from the ticket: one branch for ELEC-01 and ELEC-02 at the user's request; the review skills do the
  functional review, the helper only gathers facts; KiCad's own BOM export is not used (the normalized BOM comes
  from KiCad's netlist); duplicate references, which kicad-cli 10's ERC does not report, come from kicad-tool's own check; 3D exports, jobsets, variants and library commands stay out.
- Scope set by the user during review (2026-11-13, "do not overengineer: set a minimum version for kicad"): files
  are read from KiCad 8 on (schematic 20231120, board 20240108), older ones refused with "open it in KiCad 10 and
  save it". The helper reads files as KiCad 10.0.8 does (observed) and refuses where KiCad's readers could disagree;
  project library tables accept only type `KiCad`; `erc` and `review-report` refuse a project that turns on ERC's
  simulation model check, the only check that opens model files.
- Criteria: E02-A...E02-E are covered by `05_Software/tests/integration/kicad.test.ts` with the real KiCad 10.0.8
  on Windows against fictional projects in `tests/fixtures/kicad/` (expected values derived in its README).
  E02-D "opens in KiCad/viewer" is checked structurally (PDF, SVG, Gerber X2, Excellon, CSV). The opt-in
  `VERA_KICAD_UV` run through VERA's provisioner and runner passed on 2026-11-12. Open: native Ubuntu x64
  (`REQ-PLAT-10747605`).

## ELEC-03 as built

- Two parts. The host capability (VERA itself, because plugin programs get no secrets): read tool `parts_search`
  over five supplier catalogs - Mouser Search API v2, DigiKey Product Information v4, TME API v2 and Farnell/element14
  (both added by the user), Rutronik Shop API (manual v1.3, the user chose "Include Rutronik now"). Offered only while
  Web access is on, the official-tier `parts-search` plugin is enabled for the workbench and a supplier is enabled;
  rechecked at call time. Credentials in the credential store (`parts:<id>`), entered in Settings > Parts search
  (en/ro/de) or CLI environment variables; never in results, errors, logs, settings or the snapshot. Fixed endpoints,
  no redirects, 30 s and 4 MiB per request, one bounded retry after 429, statuses ok/partial/failed/key-required/
  auth/rate-limited/timeout/unavailable, shared DigiKey/TME tokens refreshed once, revocation on every settings or
  Web access change, result fitted under the 32 000-character tool cap. Exact contract: spec
  `.agentic/specs/REQ-DATA-9fd50acb.md`; knowledge `.agentic/knowledge/parts-search.md`.
- The plugin `05_Software/plugins/parts-search/`: program `parts-compare` (standard library, offline) and skills
  `component-selection` and `component-families` (MOSFET, regulator, op-amp, resistor, capacitor, diode, inductor).
  Hard constraints decide eligible/unknown/rejected; only confirmed datasheet values with a page or table, under the
  stated conditions and with a guaranteed basis, are evidence (VGS(th) never proves RDS(on)); SKUs of one MPN and
  package are one device; prices compare by the cost of the order quantity within one currency; offers older than
  24 h are stale; comparison.json/.md and a proposed bom.csv in a new run folder. Spec
  `.agentic/specs/REQ-DATA-6b26f2a5.md`.
- Departures from the ticket: no supplier cache at all - Farnell's terms forbid caching, TME's forbid duplicating
  API content and DigiKey's bar building a database (RULING-002), so the "offline run on a labelled cache" of E03-F
  is parts-compare on a labelled snapshot; RS Components stays out (no public API documentation).
- Criteria: E03-A...E and G covered by `src/libraries/core/src/parts/parts.test.ts`, desktop and renderer
  `parts-access.test.ts`, `src/apps/cli/src/parts-env.test.ts` and `tests/integration/parts-search.test.ts` (fixtures
  in `tests/fixtures/parts-search/`, derived in its README); the opt-in `VERA_PARTS_UV` run passed on 2026-11-13.
  Open: E03-F live probes - no supplier credential has been provided, so all five suppliers are not verified live;
  native Ubuntu x64 (`REQ-PLAT-cad89d58`).

## ELEC-04 as built

- Two platform extensions (RULING-002): plugin downloads accept a Windows-only `.7z`, extracted by System32 bsdtar,
  whose exit 1 is accepted only for its notices of skipped entries with non-ASCII names (the official ngspice build
  has 20 such example files); and a program field `uses` gives a script program the resolved path of a sibling program
  as `VERA_PROGRAM_<NAME>` - the way a helper reaches a VERA-installed engine. ELEC-05...07 can reuse both.
- Package `05_Software/plugins/ngspice/`: program `ngspice` (the user's ngspice 42 or newer, or on Windows the pinned
  official ngspice-47 `.7z`, SHA-256 recorded, licence Modified BSD with LGPL/MPL/GPL parts; on Ubuntu `apt install
  ngspice`); every direct engine command is blocked. Program `ngspice-tool` (standard library): validate, run, sweep,
  measure, compare, report. Skill `circuit-simulation`. Spec `.agentic/specs/REQ-DATA-29b9a988.md`.
- Security boundary (hardened through three review rounds): the helper reads the netlist chain itself and refuses
  before the engine runs - control blocks, unknown cards, any line whose first visible character is punctuation
  followed by `#` (ngspice runs `*#`, `;#` and the like as control lines), XSPICE `A` instances (code models can start
  programs or read files), code loading, includes outside the workbench, undefined models, subcircuits and pin
  mismatches; it replaces the title line (ngspice acts on cards there) and runs `ngspice -b -n` on a copy with its own
  control block, adding no solver option.
- Results: run folders with the log, effective netlist, input hashes and header lines, series CSV, SVG plot,
  result.json and report.md; measurements in Python (min, max, average, rms, peak-to-peak, ripple with its window,
  overshoot, settling, value-at, final, average power with its sign convention), criteria pass/fail/unknown, engine
  failures without any pass, timeout and a 1700 s sweep budget, seeded Monte Carlo, comparison of runs.
- Decisions (RULING-003): no partial series (ngspice writes at the end); the ticket's "SPICE units checked" is the `M`
  (milli) warning plus units on requests; "model licence and dialect recorded" is each file's leading comment lines
  plus the engine version.
- Criteria: E04-A...E and the Windows part of E04-F are covered by `tests/integration/ngspice.test.ts` with the real
  ngspice-47 (fixtures and references in `tests/fixtures/ngspice/`), including the opt-in real provisioner install of
  the 7z. Open: native Ubuntu x64 (`REQ-PLAT-0887e4d4`, `REQ-TEST-66a3c460`).

## ELEC-05 as built

- Package `05_Software/plugins/ltspice/` (Windows x64 only, no Wine, nothing downloaded - the user installs LTspice
  from analog.com, RULING-001): program `ltspice` finds `%LOCALAPPDATA%/Programs/ADI/LTspice/LTspice.exe` or
  `%ProgramFiles%/ADI/LTspice/LTspice.exe`, version 26 or newer; every direct `ltspice` command is blocked. Program
  `ltspice-tool` (standard library, `uses: [ltspice]`): validate, convert, run, sweep, measure, compare, report.
  Skill `ltspice-simulation`. Spec `.agentic/specs/REQ-DATA-0f9e36a3.md`. Pack group "Simulation (LTspice, Windows)",
  off by default.
- Same request and result model as ngspice-tool (RULING-002): the request's analysis, `.temp`, `.save` and `.step`
  replace the netlist's own analysis, `.step`, `.temp`, `.save` and `.meas` cards; parameters rewrite their top-level
  `.param` assignment (LTspice refuses a second `.param`); series carry ngspice-tool's names; `measure.py`,
  `sweep.py` and `workspace.py` are byte-identical copies. Sweeps and Monte Carlo run as one `.step` run.
- Security boundary (hardened through the explicit review rounds, each confirmed against the real LTspice): the
  helper checks every line of the netlist chain on NFKC-normalized, case-folded text and refuses what LTspice reads or
  writes files with (`.wave`, `.savebias`, `.loadbias`, `.savestate`, `.loadstate`; outside include cards the
  substrings `file`, `scopedata`, `tbl`, `.inc`, `include`, `.lib`, `loadbias`, `savebias`, `loadstate`, `savestate`,
  `fastaccess`, which LTspice matches by prefix),
  files holding U+0085/U+2028/U+2029 (LTspice line breaks) or invisible formatting characters (LTspice drops them),
  include names with `%` or not in NFC, netlists, includes and schematics whose path inside the working directory is not in NFC (a folder copied from a Mac may not be), include names read exactly as LTspice reads them (an unquoted name is the whole rest of the
  card) with library includes rewritten to the hashed file, quotes outside include, library and model cards, `@`/`&` elements,
  `.machine`, unknown cards, encrypted and non-UTF-8 files, unreadable include names and self-includes; includes lie
  in the working directory or LTspice's own library (read in place, never copied); a single-name `.lib` is an include
  except inside a file reached as `.lib FILE SECTION`. Schematics: symbols by absolute or escaping path refused in
  every sheet of the folder and every encoding LTspice reads; conversion with `-netlist` on a copy.
- Engine facts (LTspice 26.1.1): `-b` is synchronous, exit 1 on any error with `<file>(<line>): <message>` in the
  UTF-8 log; the raw file has a UTF-16LE header and binary data (axis float64 + float32, `double`, complex pairs,
  stepped with the axis restarting); a fresh `-ini` makes LTspice wait on a prompt; per-user msiexec installs fail on
  managed machines with Windows Installer 2503/2502 - the README gives the all-users command.
- Criteria: E05-A...F are covered by `tests/integration/ltspice.test.ts` with the real LTspice 26.1.1, including
  the same requests against ngspice-47 (divider, RC transient and AC, noise within the README's tolerances). Open:
  none on Windows; LTspice is Windows-only by scope.

## ELEC-06 as built

- Route (RULING-001, user): KiCad's official IPC API through kicad-python 0.8.0 (pinned with protobuf 5.29.6 and
  pynng 0.9.0 in the helper's PEP 723 block), not the deprecated SWIG pcbnew and not S-expression editing. The
  user's KiCad 10 API is enabled in kicad_common.json (RULING-002, user).
- Package `05_Software/plugins/kicad-layout/` (Windows x64 and Linux x64): program `kicad-cli` (KiCad 10, direct
  commands blocked), program `kicad-layout-tool` (`uses: [kicad-cli]`, `gui: true`): open, edit, close; the PCB
  editor is the `pcbnew` next to kicad-cli. `gui: true` is a new manifest field (RULING-004, user): VERA's runner
  passes the display variables (DISPLAY, WAYLAND_DISPLAY, XAUTHORITY, XDG_RUNTIME_DIR) only to such programs. Skill `kicad-layout`. Spec `.agentic/specs/REQ-DATA-891d5b5d.md`. Pack group "PCB
  placement and local routing (KiCad)", off by default.
- Capability gate (probed with KiCad 10.0.8): the API identifies the open board, moves and rotates footprints,
  creates tracks, vias and rule areas in one commit, saves, saves a copy and reverts; it needs a GUI window
  (no headless mode in 10), serves only the first KiCad process on Windows, and protects neither locked items nor
  nets - the helper binds by the open document, refuses while another window holds the API and checks locked
  items, nets, layers and the outline itself. KiCad's in-memory text never equals the file: unsaved edits are
  detected by its hash after a save and reload.
- Apply: VERA's first-party tool `apply_candidate` (core) writes a candidate whose objectives passed over the
  source board through the write flow's shared `commitChange` (approval in ask mode, conflict on a changed source
  or candidate, refused in read-only mode and while KiCad's lock file exists). The plugin never writes the source.
- Criteria: E06-B, C, F and G are covered by `tests/integration/kicad-layout.test.ts` with the real KiCad 10.0.8 on
  Windows (VERA_TEST_KICAD_GUI), run as VERA's runner runs the helper; E06-D and E06-E by core's apply-candidate
  tests (the real-KiCad part of E06-G: the applied candidate reopens with the reported board, and KiCad's lock file
  appears beside an open board). Open: native Ubuntu x64 for E06-A.
- Found while validating: KiCad gives a track created through the API the net of the copper it touches (a GND
  track across a VOUT track is saved as VOUT), and duplicates a footprint updated twice in one commit; the helper
  refuses both (`net`, `request`).

## Later, separate

`lab-validation` (simulation against sigrok/PyVISA measurements), OCR/vision for scanned schematics,
firmware simulation through Renode and 3D electromagnetic/thermal analysis need their own plans; they
are not hidden dependencies of the seven packages.

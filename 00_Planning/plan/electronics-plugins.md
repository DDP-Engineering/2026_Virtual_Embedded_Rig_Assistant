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
request (AEGIS TASK-7c2a9322); ELEC-03...ELEC-07 planned.

## Order

| Order | Package | Issue | Plugin | Result | State |
|---|---|---|---|---|---|
| 1 | ELEC-01 | [#93](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/93) | `electronics-calc` | electrical and thermal calculations with explicit units and assumptions | implemented |
| 2 | ELEC-02 | [#94](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/94) | `kicad` | native schematic and PCB analysis, ERC/DRC, BOM and exports | implemented |
| 3 | ELEC-03 | [#95](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/95) | `parts-search` | documented component selection and controlled catalog access | planned |
| 4 | ELEC-04 | [#96](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/96) | `ngspice` | electrical and electrothermal simulation on Windows and Linux | planned |
| 5 | ELEC-05 | [#97](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/97) | `ltspice` | LTspice batch simulation on Windows in the same result model | planned |
| 6 | ELEC-06 | [#98](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/98) | `kicad-layout` | placement and local routing on a candidate, checked and applied under the write policy | planned |
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

## Later, separate

`lab-validation` (simulation against sigrok/PyVISA measurements), OCR/vision for scanned schematics,
firmware simulation through Renode and 3D electromagnetic/thermal analysis need their own plans; they
are not hidden dependencies of the seven packages.

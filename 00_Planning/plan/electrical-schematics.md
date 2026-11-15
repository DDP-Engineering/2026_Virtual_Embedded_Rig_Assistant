# CAD-01...CAD-04 (#133...#136) Electrical schematics and panels - QElectroTech, panel engineering, documentation and EPLAN

PURPOSE: the order and state of the four packages that connect the common electrical project model to
schematic and panel work: QElectroTech schematics, panel engineering (BOM, terminals, 24 V budget,
2D layout, dissipation), consistent electrical documentation, and an EPLAN adapter.
SPEC: Gitea epic [#123](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/123) and its children #133...#136 hold the specification of each work
package (deliverables, Done criteria CAD-0x-A...D); the local copies are
`F:\ProjectsDDP\VERA_Electrical_Automation_Plugins_Plan.md` and
`F:\ProjectsDDP\VERA_Electrical_Automation_Plugins_Tickets\` (the tickets say `D:\ProjectsDDP`; the
files are on `F:`). This page records only order, state and what was built, so the two never diverge.
Where a ticket is wrong about the code, the code decides. The model, catalog, network, protection and
motor pieces these packages build on are described in [electrical-power.md](electrical-power.md) and
in `.agentic/knowledge/electrical-model.md`.
PROCESS: at the user's request (2026-11-15) every child is implemented with AEGIS, in order, on one
branch `feature/123-electrical-schematics`, cut from `master` and brought up to `master` 0d843f05 (PWR
epic merged as PR #273) before CAD-01 started, in the sibling worktree
`F:\2026_Virtual_Embedded_Rig_Assistant_cad`. The implementer hands the candidate back without a
commit; the coordinator checks the evidence and makes one local commit per ticket. Nothing is pushed.
Each ticket runs only its focused tests; the complete suite runs once after CAD-04.
STATE: not started.

## Order

| Order | Package | Issue | Result | Depends on | State |
|---|---|---|---|---|---|
| 1 | CAD-01 | [#133](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/133) | `qelectrotech`: read native `.qet` XML into the model, DOL / reversing / star-delta schematic candidates, numbering and cross-references | PWR-00 | planned |
| 2 | CAD-02 | [#134](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/134) | `panel-engineering`: BOM, terminals, wiring, 24 V budget, 2D rail layout, dissipation and thermal check, assembly verification report | CAD-01, PWR-03, PWR-04 | planned |
| 3 | CAD-03 | [#135](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/135) | `electrical-documentation`: material, connection, cable, terminal, label and I/O lists, change report, CSV/XLSX/PDF exports | CAD-02 | planned |
| 4 | CAD-04 | [#136](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/136) | `eplan`: Windows adapter through the official EPLAN API: inspect, export, map, import approved data, save candidate | CAD-01, CAD-03 | planned |

## Decisions for this epic (user, 2026-11-15)

- Base: the branch waited for the PWR epic and starts from `master` with it merged. There is one
  project model (PWR-00) and one catalog store (PWR-01); CAD children map onto them and never add a
  second representation.
- QElectroTech: the official Windows build and the Ubuntu apt package (in WSL2) may be installed for
  the real-application checks; the tested versions are recorded. WSL2 does not replace native Ubuntu.
- EPLAN: no licence is available. CAD-04 is built against the official API documentation with unit
  tests; its real-application criteria (CAD-04-A, C, D) stay open, and #136 is not closed.
- Reference data, as for PWR: small fixtures typed from public sources with source and page; no
  copyrighted standards tables or vendor catalogs. A criterion that needs licensed data stays open.
- Every stored format stays at version 1, with no migrations.

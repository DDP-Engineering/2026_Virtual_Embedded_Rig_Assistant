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
STATE: CAD-01 committed (5a4c7a77, #133 closed); the visual check of the candidates in QElectroTech (screen access
declined), QElectroTech-saved fixtures and native Ubuntu are open. CAD-02 implemented 2026-11-16 (AEGIS TASK-00631c13),
uncommitted hand-over; native Ubuntu and cited data for LAD9V2, fuse holders and a star-delta timer are open.

## Order

| Order | Package | Issue | Result | Depends on | State |
|---|---|---|---|---|---|
| 1 | CAD-01 | [#133](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/133) | `qelectrotech`: read native `.qet` XML into the model, DOL / reversing / star-delta schematic candidates, numbering and cross-references | PWR-00 | implemented |
| 2 | CAD-02 | [#134](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/134) | `panel-engineering`: BOM, terminals, wiring, 24 V budget, 2D rail layout, dissipation and thermal check, assembly verification report | CAD-01, PWR-03, PWR-04 | implemented |
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

## CAD-01 #133 - QElectroTech schematics

- Product code in core next to the PWR engines (spec `.agentic/specs/REQ-DATA-963cbdf6.md`): strict span-keeping XML
  reader `electrical/xml-strict.ts` (no DTD, no entities beyond the five predefined, no PIs, UTF-8 only, depth 64,
  500 000 elements, 16 MiB; XXE refused before anything is opened), project reader `qet.ts` (folios, embedded
  definitions, elements, conductors by element+terminal UUID or legacy numeric id, potentials joined by conductors and
  folio reports, master/slave devices, problems instead of drops), self-authored symbols `qet-symbols.ts`, templates
  `qet-templates.ts`, checks and reconcile `qet-check.ts`, tools `qet-tool.ts`. Plugin `qelectrotech` (ecosystem
  electrical, no program, skill `qelectrotech-schematics`, help en/ro/de/fr), new pack Electrical schematics and panels.
- Tools, gated on plugin `qelectrotech`: `qelectrotech` (read: project, devices, potentials, reconcile with the
  model's refs and `attributes.qetUuid`, returning `electrical_model_change` operations it never applies);
  `qelectrotech_change` (write: `candidate` - a new .qet for one motor of a CURRENT motor_drives assembly, dol,
  reversing or star-delta, read back and checked before preview; `edit` - splices of element information and the title
  with the base sha256, every other byte and UUID kept); `qelectrotech_check` (write: one result with labels,
  conductor numbering, cross-references, device list and the candidate checks, sources `qet:<path>@sha256:<hex>`).
- Candidate checks: each power connection per phase on its own potential, `F1:5,3,1` / `motor:W1,V1,U1` phase lists,
  star point on KM3 1-3-5, coil circuits X1 L -> A1, A2 -> N, electrical interlocks as graph cuts (every control path to
  the coil passes the other device's NC), F1 95-96 on every coil path, the star-delta sequence through the timer's
  delayed contacts, contact links; the mechanical interlock is copied from motor_drives, never from the drawing.
- Fix in PWR-04: a reversing starter with an overload relay recorded `KM2 -> F1` without the phase swap; it is now
  `KM2 -> F1:5,3,1`.
- QElectroTech: Windows portable 0.100.0+git8590 (download.qelectrotech.org tags/20260125, 7z SHA-256
  552402198011f37633ffcff4f9ce561a9abaf22dc14f9cc09ddc231245b16445) and WSL2 Ubuntu 24.04 apt 1:0.9-2build2 (0.90). Both
  command lines offer only --help, -v/--version, --license and directory options (qetarguments.cpp): no headless export,
  so VERA starts no QET program. Both opened the three candidates without a load error (0.90 headless, offscreen).
- Fixtures: `tests/fixtures/qelectrotech/<method>.generated.qet`, rendered with deterministic UUIDs and compared byte for
  byte; symbols self-authored (QET's collection is CC-BY 3.0 outside a diagram, ELEMENTS.LICENSE).
- Open: the visual check in the real application with screenshots (screen access to QET was declined), candidates saved
  by QElectroTech as read-back fixtures, conductor numbering checked on a real numbered project, native Ubuntu (WSL2
  only); softstarter and VFD templates are outside this delivery.

## CAD-02 #134 - Panel engineering

- Product code in core next to the PWR and QET engines (spec `.agentic/specs/REQ-DATA-a8bf1713.md`): panel file format 1
  `electrical-automation-panels/<id>.json` (shared `panel.ts`, strict reading `panel-file.ts`: unique tags, references,
  units), the pure engine `panel.ts` and the tools `panel-tool.ts`; result section `panel` (BOM with a sha256 per line,
  rails, zones, ducts, placements, verification report) in the shared result schema. Plugin `panel-engineering` (ecosystem
  electrical, no program, skill `panel-engineering`, help en/ro/de/fr) in the pack Electrical schematics and panels.
- Tools, gated on plugin `panel-engineering`: `panel_engineering_check` (write: one new result from the panel file, its
  catalogs, a CURRENT motor_drives result, the network result it chains to and optional `.qet` schematics) and
  `panel_engineering` (read: `draft` equipment from assemblies with the accessories the catalog lists, `impact` of a
  changed device, panel or model on a stored result, `export` BOM CSV / layout SVG).
- Checks: BOM reconciled with the motors' assemblies (same catalog item), the board's fed motors/loads (or declared
  exclusions), its contained devices and each schematic's labels per motor; accessories and the mounting plate only when
  the host item lists them; terminal strips against motor terminals and connected schematic terminals, declared spare;
  first-fit placement on rails in zones accepting the class, collisions, ducts, keep-out areas, zone, depth, documented
  segregation distance, missing dimensions unknown and unplaced, rail reserve; dissipation per scenario at rated losses
  (unknown never zero); enclosure heat balance Ti = Te + P / (K S + V / 3.1) after the Schneider Electric enclosure
  catalogue pp. 8/110-8/111 (IEC 890 surfaces); 24 V budget with the cited 2.5 %/K derating and declared reserve;
  short-circuit withstand only from a declared assembly rating, busbars never; thirteen verification characteristics,
  no IEC 61439 conformity claimed.
- Fixtures: `tests/fixtures/panel-engineering/cat-panel.json` (ABLS1A24050, TM221CE16T, NSYS3D6420, NSYMM64, NSYTRV42,
  XB5AA31/42 from se.com pages read 2026-11-16), dimensions, coil losses and LRD21-under-LC1D18P7 added to
  `cat-motor-drives.json` (version 2026-11-16.1), the fictional panel `pnl-plant-m.json`; independent reference
  `tests/support/panel_thermal_check.py` (published example 4.128 m2 / 35.24 K; fixture idle 37.80 degC, M1 running
  40.84 degC). Tested on Windows x64 and WSL2 (Ubuntu 24.04).
- Open: native Ubuntu; cited dimensions/losses for LAD9V2, a C10G fuse holder and a star-delta timer (the fixture keeps
  them as visible unknowns); wiring and cable lists and document exports belong to CAD-03.

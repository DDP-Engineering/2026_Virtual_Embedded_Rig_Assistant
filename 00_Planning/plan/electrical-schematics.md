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
CAD-03 implemented 2026-11-16 (AEGIS TASK-d2b9147b), uncommitted hand-over; a numbered project saved by QElectroTech,
a real vendor tag export and native Ubuntu are open. CAD-04 implemented 2026-11-16 (AEGIS TASK-b74c88bb), uncommitted
hand-over, built from the public EPLAN API 2025 documentation without an EPLAN installation or licence: every
real-application part (CAD-04-A, the EPLAN parts of B, C and D) is open and #136 stays open.

## Order

| Order | Package | Issue | Result | Depends on | State |
|---|---|---|---|---|---|
| 1 | CAD-01 | [#133](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/133) | `qelectrotech`: read native `.qet` XML into the model, DOL / reversing / star-delta schematic candidates, numbering and cross-references | PWR-00 | implemented |
| 2 | CAD-02 | [#134](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/134) | `panel-engineering`: BOM, terminals, wiring, 24 V budget, 2D rail layout, dissipation and thermal check, assembly verification report | CAD-01, PWR-03, PWR-04 | implemented |
| 3 | CAD-03 | [#135](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/135) | `electrical-documentation`: material, connection, cable, terminal, label and I/O lists, change report, CSV/XLSX/PDF exports | CAD-02 | implemented |
| 4 | CAD-04 | [#136](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/136) | `eplan`: Windows adapter through the official EPLAN API: inspect, export, map, import approved data, save candidate | CAD-01, CAD-03 | implemented without EPLAN; real-application criteria open |

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

## CAD-03 #135 - Electrical documentation

- Product code in core next to the PWR, QET and panel engines (spec `.agentic/specs/REQ-DATA-aa83ed5c.md`): shared result
  section `documentation` (format 1 changed in place: project, revision, panel, seven lists with fixed columns, key and
  source per row and a sha256 per list, optional change report), pure engine `documentation.ts` (tag CSV reader, list
  derivation, checks, revision, change report), writers `documentation-export.ts` (CSV; XLSX zipped with fflate, already
  a core dependency; PDF 1.4 by an own writer with the standard Courier fonts), tools `documentation-tool.ts`. Plugin
  `electrical-documentation` (ecosystem electrical, no program, skill `electrical-documentation`, help en/ro/de/fr) in the
  pack Electrical schematics and panels. No npm dependency added.
- Tools, gated on plugin `electrical-documentation`: `electrical_documentation_check` (write: one new result from the
  model, a stored panel_engineering_check result with its panel file and motor_drives run, named .qet schematics, an
  optional tag CSV, an optional model document for the revision and an optional previous run), `electrical_documentation`
  (read: list pages, live changes since a run), `electrical_documentation_export` (write: one new CSV, XLSX or PDF file
  next to the run, controlled header with project, revision, run, generated time and model sha256).
- Lists: materials (panel BOM grouped by catalog item), connections (one row per conductor, ends as panel tag and
  terminal), cables (circuit, panel-side and field-side ends, exclusions from the panel), terminals (model terminals and
  drawn strip points merged), labels (devices, strips, two wire-end labels per numbered conductor, cable ends), I/O
  (module, device, terminal, tag, tag-file address), contents. Every row names its source file with its sha256.
- Checks (reported, never repaired): stale or changed upstream results and files (`source:*`), labels, numbering and
  cross-references (CAD-01 project checks), wire ends, duplicate connections, labels in neither panel nor model, the
  motor_drives assembly connections (CAD-01 `assemblyChecks`), cable ends, terminal points, the device - terminal - I/O
  address - tag chain and the tag file; the revision only from the model document's attributes, failing when a folio
  states another revision or the content changed under the same revision. PLC tags come only from the model and the
  named tag file; nothing is printed, ordered or sent.
- Change to CAD-02 code: `csvField` in panel.ts is exported and shared by the documentation CSV.
- Fixtures: `tests/fixtures/electrical-documentation/plant-m-doc.json` (plant M with a document at revision B, PLC A1 with
  three inputs, tags, terminals XM1/XM2 and cable ends) and `tags-plant-m.csv`; the test numbers the CAD-01 candidates
  in place and plants duplicates, missing connections and references and uncorrelated I/O as visible edits. Exports were
  rendered and inspected: the PDF with the repository's pdfjs-dist and @napi-rs/canvas, the XLSX opened by LibreOffice
  Calc and openpyxl. Tested on Windows x64 only.
- Open: a numbered project saved by QElectroTech itself and a real vendor tag export as read-back fixtures; native Ubuntu
  and WSL2 runs; export texts are English and the PDF is limited to WinAnsi characters.

## CAD-04 #136 - EPLAN exchange

- API research first (2026-11-16, https://www.eplan.help/en-us/Infoportal/Content/api/2025/, pages dated 17.02.2025,
  read in the browser, nothing downloaded; details in the TASK-b74c88bb journal and spec
  `.agentic/specs/REQ-DATA-203d52e6.md`). Declared target: EPLAN Electric P8 2025, Windows x64 (API on .NET Framework
  4.8.1, tested on Windows 7/8/10). Ways in: the EPLAN.exe command line (/Variant, /Quiet, /Auto, /NoLicenseDialog,
  /NoUserRightsDialog), offline programs (EplApplication.Init + LockingStep), add-ins, scripts and Remoting (gRPC into a
  RUNNING EPLAN). Documented operations: ProjectOpen/ProjectAction with OpenMode Standard|ReadOnly|Exclusive (opens in
  that mode or not at all; a project needing an upgrade opens read-only); devicelist IMPORT/EXPORT/DELETE with
  XDLXmlExporter, XDLCsvImporterExporter (semicolon) and XDLTxtImporterExporter; partslist; XMActionDCCommonExport /
  XMActionDCImport (external editing by configuration scheme, .edc file); label; reports PROJECT; check PROJECT;
  backup/restore (.zw1); projectmanagement CREATESNAPSHOTCOPY; export/import PXFPROJECT; generatemacros/preparemacros
  (macro projects only), XMIaInsertMacro and Function.PlaceFunctionalMacro; ExecuteScript. No Project.Save: changes are
  committed by transactions under locks. Identity: StorableObject.ToStringIdentifier is valid only while the project is
  open, DatabaseIdentifier changes on reopen, ObjectIdentifier persistence is not stated; the visible identity is the
  device tag (=AP+PT1-X4) and a user-defined property can carry an external ID. Licences: an API developer licence
  limits projects to 5 pages; a runtime licence needs EADN-signed programs; scripts run without an API licence.
- What cannot be confirmed without an install: the device list CSV header names and encoding, the TXT layout of an
  external-editing scheme, EPLAN.exe exit codes, the order of global parameters and action, whether CREATESNAPSHOTCOPY
  needs SCHEME, the licence each action needs and the behaviour under /NoLicenseDialog without one, the behaviour on a
  project open in another EPLAN or with unsaved work, ObjectIdentifier persistence and whether a user property with the
  VERA ID survives the device list round trip.
- Design chosen from that: a VERA-side adapter on documented exchange files plus a small Windows helper on the
  documented command line. Rejected: an offline .NET program or add-in (cannot be compiled or tested here and needs a
  signed runtime licence), Remoting (attaches to a running EPLAN), PXF/EPJ, .edc and macro files (formats not
  documented), and a manifest `find` program for EPLAN.exe (the manifest requires a version probe; EPLAN.exe has no
  documented version option, so the probe would start EPLAN).
- Product code in core next to the documentation engine: shared `eplan.ts` (profile `electrical-automation-eplan/<id>.json`
  kind `vera-eplan-profile`, outcome kind `vera-eplan-outcome`, both format 1), core `electrical/eplan.ts` (strict table
  reader on the documentation `csvRecords`, now taking a delimiter and returning spans; device tags; reconcile;
  candidate; round-trip and outcome criteria; result) and `electrical/eplan-tool.ts`. Plugin `eplan` 0.1.0 (ecosystem
  electrical, Windows x64 only, program `eplan-tool` = PEP 723 standard-library script, skill `eplan-exchange`, help
  en/ro/de/fr) in the pack Electrical schematics and panels, group EPLAN exchange, default off. No npm dependency added.
- Tools, gated on plugin `eplan`: `eplan` (read: inspect a table; reconcile devices by VERA ID or identifier, part
  numbers with manufacturer prefixes, terminal points of panel strips and connections with wire numbers against a stored
  electrical-documentation run, proposing `attributes.eplanTag` operations it never applies), `eplan_change` (write: a
  new device list import candidate from a base export and its sha256; untouched records byte for byte; parts and empty
  VERA ID cells filled; missing devices appended as `-<tag>`; nothing removed; report of what cannot transfer:
  connections, terminals, macros, unmapped fields), `eplan_check` (write: one result with `source:documentation`,
  `devices`, `part-numbers`, `terminals`, `connections` and, after an import, `identity`, `unchanged`, `applied`,
  `outcome`).
- eplan-tool (every EPLAN.exe line carries /NoRemoting, the copy must sit beside the project link): `plan` (prints
  command lines), `export` (devicelist EXPORT and the scheme tables with the project opened
  ReadOnly, device-read), `import` (CREATESNAPSHOTCOPY, devicelist IMPORT into the copy opened Exclusive, reports PROJECT,
  re-export; device-write). Never ExecuteScript, never Remoting, never a command without /PROJECTNAME, never an import
  into the profile's project. Refusals before EPLAN starts (exit 2): wrong or missing project, existing copy or output,
  changed candidate (conflict), unsafe paths, other system, no EPLAN 2025. A failed, timed-out or stopped step ends the
  run as failed or interrupted (exit 1, outcome.json written); success is decided by `eplan_check` on the re-export,
  never by EPLAN's exit code.
- Fixtures: `tests/fixtures/eplan/` (fictional plant M profile, device list, terminal and connection tables matching the
  plant M documentation run); the plant M upstream chain moved from documentation-tool.test.ts into
  `electrical/plant-m.test-support.ts`, shared by the documentation and EPLAN tool tests. Tested on Windows x64 only;
  the real-EPLAN tests in `tests/plugins/eplan.test.ts` run only with VERA_TEST_EPLAN_PROFILE and were skipped.
- Criteria: CAD-04-A open (no EPLAN, no licence: inspect/export/import/save never ran on a real EPLAN). CAD-04-B partly
  (VERA side: identities, unchanged cells and applied values are checked on the round trip and the candidate keeps every
  untouched record; macros are not handled; whether EPLAN keeps identities and properties is unproven). CAD-04-C partly
  (VERA side: wrong project, conflict, existing copy, missing EPLAN refused before start; failed, interrupted or
  mismatched outcomes never count as applied; EPLAN's own behaviour on a locked project, unsaved work, a missing licence
  and Stop is unverified). CAD-04-D partly (data reconciled with the CAD-03 lists in tests; approval, refusal and
  reopening of a candidate in EPLAN on Windows not demonstrated).
- Open: everything above that needs a licensed EPLAN Electric P8 2025 with a fixture project; macros; connection and
  terminal import (needs the .edc format); paths with spaces; native Ubuntu is out of scope (Windows-only adapter).

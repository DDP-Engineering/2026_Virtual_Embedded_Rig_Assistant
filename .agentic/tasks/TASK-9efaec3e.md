# TASK-9efaec3e - CAD-01 qelectrotech: read QET projects, DOL/reversing/star-delta candidates, numbering and cross-references (#133)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-963cbdf6, REQ-FUNC-778b9fc6, REQ-FUNC-8958b763, REQ-FUNC-3f13f78d, REQ-FUNC-2e3af206, REQ-FUNC-07c03695, REQ-REL-3e094ff0, REQ-DATA-6609a3b6, REQ-FUNC-b21bd414, REQ-TEST-7eb1927d, REQ-SEC-4dfa2a5b, REQ-UX-d32cc9db
parent:
branch: feature/123-electrical-schematics
base: 86801fb0cea25a6eafcd6012df712c427572968c
opened: 2026-11-15

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [x] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [x] knowledge pages of changed components current with the reviewed code
- [x] project and environment context reconciled with the candidate
- [x] requirements re-read: status, prose, verification, paths and links true
- [x] manual or inspection verification recorded where applicable
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: VERA cannot read or produce QElectroTech schematics: no `.qet` reader, no mapping of QET devices and
references to the electrical model, no schematic candidates for the PWR-04 starter assemblies (OBSERVED: core
src/electrical has no QET code; 00_Planning/plan/electrical-schematics.md lists CAD-01 planned; motor_drives results
carry `assemblies` "for the CAD epic's panel-engineering adapter", electrical-model.md).
Desired outcome: plugin `qelectrotech` (ecosystem electrical, license PolyForm NC, help en/ro/de/fr) with product code
in core, tools gated on its own plugin ID (PWR-04 coordinator decision): (1) a strict `.qet` XML reader (no DTD, no
entities beyond the predefined five - XXE refused) that maps folios, symbols (embedded element definitions), conductors
(per-terminal potentials, folio reports), devices (labels, master/slave groups) and cross-references, and reconciles
devices with the model's visible references and QET UUID identity; (2) DOL, reversing and star-delta candidates from
verified templates driven by a CURRENT motor_drives assembly, written as a new `.qet` file through the prepared change
(approval, base hash, write queue), validated by reading the written XML back - connections per phase, electrical
interlocks as graph cuts in the control circuit, cross-references; (3) numbering, cross-reference and device-list checks
stored as an electrical result stamped with the `.qet` file's sha256; (4) edits of an existing project (element
information such as labels) as byte-preserving splices with a base sha256, keeping unaffected content and element UUIDs
(STATED: ticket CAD-01, coordinator brief).
Actors: the agent with `qelectrotech` loaded; the engineer who opens candidates in QElectroTech, inspects them and
approves writes (STATED: ticket "candidate projects are opened in QET and inspected visually").
Primary scenario: PWR-04 has stored a current motor_drives result for motor M1 (DOL). The agent calls
`qelectrotech_change` {action candidate, motorDrivesRun, motor, path schematics/m1-dol.qet}; VERA builds the project
from the DOL template with the assembly's tags (Q1, KM1, F1, M1), reads it back, validates it and prepares one new file
(approval). The engineer opens it in QET 0.100, inspects it and may save it from QET; `qelectrotech` view project/devices
reads the saved file; `qelectrotech_check` stores a result with numbering, cross-references and device list against the
model and the candidate's sha256; reconcile returns `electrical_model_change` operations that add the QET devices to
the model with their UUIDs (INFERRED: from the ticket's read/candidate/apply steps and the PWR-00 write flow).
Examples: KM1's coil (master) linked to its main contacts and 13-14 auxiliary (slaves) - one device, one label, the
slaves show the coil's folio position (INFERRED: QET master/slave links, source element.cpp links_uuids); reversing:
every path from the control supply to KM1's coil A1 passes KM2's NC contact and vice versa (INFERRED: textbook electrical
interlock); a conductor naming element1/terminal1 UUIDs or a legacy numeric terminal id (OBSERVED: QET 0.100
diagram.cpp findTerminal; examples/photovoltaique.qet mixes both).
Counterexamples: `<!DOCTYPE project [<!ENTITY x SYSTEM "file:///...">]>` read at all; a drawn interlock symbol without
the NC contact in series counted as an interlock (STATED: ticket "the drawn symbol alone does not prove the connection
or interlock"); a candidate for a softstarter, a VFD or a stale motor_drives result; rewriting a whole project to change
one label; overwriting a `.qet` that changed after preview; PDF/image to netlist conversion (STATED: ticket).
In scope: strict XML reader with source spans; QET project reader (0.80/0.90/0.100 element, conductor and collection
structure as written by QET); device/xref/numbering/net analysis; three templates and their self-authored element
definitions; tools `qelectrotech` (read), `qelectrotech_change` (write: candidate, edit), `qelectrotech_check` (write: one
result); plugin package, skill, README, help, pack, catalog; en/ro/de/fr tool texts; fixtures (QET-saved candidates);
spec, requirements, knowledge, CONTRIBUTING, plan page, CHANGELOG, release notes; QET probe on Windows (0.100) and WSL2
(apt 0.90) and visual check in the real application.
Out of scope: panel layout, BOM, terminal plans (CAD-02/03); softstarter and VFD templates (STATED: ticket "first
delivery DOL, reversing, star-delta"); PDF/image conversion (STATED: ticket); driving QET's GUI from VERA or a QET CLI
export (OBSERVED: `qelectrotech --help` on 0.100.0 and 0.90 lists only --help, -v/--version, --license and directory
options; qetarguments.cpp); native Ubuntu proof (STATED: brief "native Ubuntu stays open").
Constraints: formats version 1, no migrations or readers for older VERA data (QET's own legacy conductor ids are QET
data, not VERA compatibility); reuse the model, result-change, commitChange/write queue, fileDiff, PathGuard, gating;
no new dependency; targeted tests only; no commit; fixtures self-authored (STATED: brief).
Success signals: CAD-01-A..C focused tests green; candidates of the three templates open in QET 0.100 (Windows) and
0.90 (WSL2) with the drawn devices, labels, conductors and cross-references visible, recorded with screenshots;
QET-saved files read back without losing folios, conductors or references; lint, typecheck, check:i18n, check:help,
test:plugins (qelectrotech) green.
Evidence: ticket F:/ProjectsDDP/VERA_Electrical_Automation_Plugins_Tickets/CAD-01.md; plan
F:/ProjectsDDP/VERA_Electrical_Automation_Plugins_Plan.md; electrical-schematics.md; electrical-model.md; QET 0.100
sources (tag 0.100 of qelectrotech-source-mirror: diagram.cpp, element.cpp, conductor.cpp, terminal.cpp,
qetarguments.cpp) and the examples and ELEMENTS.LICENSE of the 0.100 portable build.
Assumptions: QET resolves `embed://import/...` element types from the project's embedded collection (OBSERVED:
diagram.cpp ElementsLocation(type_id, m_project)); an instance's dynamic texts come from the instance XML, not the
definition (OBSERVED: element.cpp fromXml deletes description texts).
Unknowns: whether QET 0.90 opens files written in the 0.100 structure (to be probed); conductor numbering policy of a
real project (QET autonum formulas vary) - the check reports equal numbers per potential and distinct numbers across
potentials, a project without numbers is unknown.
Decision-blocking questions: none (QET installs, no EPLAN, formats, fixtures and test scope decided by the user
2026-11-15, plan page).
Proposed behaviors: as in Desired outcome; mechanical interlocks are taken from the motor_drives criterion, never from
the drawing; model mapping is offered as `electrical_model_change` operations, never written by the QET tools.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | three new tools, a plugin |
| no new interface or data format | no | reads/writes .qet, new result producer |
| no new dependency | yes | @xmldom not needed; own span reader, no package |
| an existing requirement already covers the behavior | no | no QET requirement |
| no security or data-handling change | no | untrusted XML input (XXE), writes project files |

## Requirement coverage

| Behavior | Requirement | Status |
|---|---|---|
| strict XML, DTD/entities/XXE refused | REQ-DATA-963cbdf6 | new |
| folios, definitions, elements, conductors (UUID and legacy ids), potentials, reports, problems | REQ-FUNC-778b9fc6 | new |
| devices (master/slave), positions, cross-reference problems | REQ-FUNC-8958b763 | new |
| reconcile with the model as proposed operations, model unchanged | REQ-FUNC-3f13f78d | new |
| DOL/reversing/star-delta candidates from a current assembly; refusals | REQ-FUNC-2e3af206 | new |
| candidate validation from the written XML (phases, interlock cuts, overload, links, mechanical copied) | REQ-FUNC-07c03695 | new |
| prepared change with base hash: new path only, edit with sha256, conflict, read-only | REQ-REL-3e094ff0 | new |
| edits as splices keeping bytes and UUIDs | REQ-DATA-6609a3b6 | new |
| check result with numbering, xref, device list, candidate checks, sha256 | REQ-FUNC-b21bd414 | new |
| self-authored fixtures saved by QET 0.100/0.90, visual check | REQ-TEST-7eb1927d | new |
| tool gating on plugin qelectrotech, none of the write tools read-only | REQ-SEC-4dfa2a5b | revised |
| tool descriptions en/ro/de/fr | REQ-UX-d32cc9db | revised |


## Design

**Approach.** Product code in core next to the PWR engines, a plugin package without programs (like PWR-01..06), three
tools gated on plugin `qelectrotech` through `electricalPluginTools` (REQ-SEC-4dfa2a5b). Reading: an own strict XML
reader `xml-strict.ts` producing element nodes with source spans (REQ-DATA-963cbdf6); `qet.ts` maps the tree to a
`QetProject` (folios, definitions, elements, conductors, potentials, devices, problems) (REQ-FUNC-778b9fc6,
REQ-FUNC-8958b763). Rejected: @xmldom/xmldom (already in core for office text) - it keeps no attribute/text offsets, so
byte-preserving edits (REQ-DATA-6609a3b6) would need a second pass, and it accepts internal DTD subsets; the span
reader is ~250 lines and needs no new dependency. Candidates: `qet-templates.ts` renders the three templates as XML
text from an `ElectricalAssembly` with self-authored element definitions (QET collection elements are CC-BY 3.0 outside
diagrams, ELEMENTS.LICENSE, so none are copied) (REQ-FUNC-2e3af206). `qet-check.ts` runs the independent checks on a
re-read `QetProject` - phase connections, interlock cuts on the control graph, star point, links, labels, numbering,
reconciliation (REQ-FUNC-07c03695, REQ-FUNC-3f13f78d, REQ-FUNC-b21bd414). Writes reuse `commitChange` (diff, approval,
write queue, before-hash recheck) and `prepareResultChange` (REQ-REL-3e094ff0).

**Interfaces and data.** As the spec: `parseStrictXml(text, label)` -> {root}, throws `Invalid QElectroTech project`;
`readQetProject(text, path)` -> QetProject; `renderTemplate({assembly, motorRef, title, newUuid})` -> {xml, method};
`assemblyChecks(project, assembly, stored criteria)`, `projectChecks(project, model, path)`, `reconcile(project, model,
path)`; `spliceEdits(text, project, request)`. Tools read the file through PathGuard (16 MiB), the model with
`readModelFile`, results with `readResultFile` + `resultFreshness`. Edit/candidate apply returns {path, sha256, bytes,
checks}; the check tool returns the result-change summary. Nothing is cached; no state outside the files.

**Files and test seams.** core/src/electrical: xml-strict.ts, qet.ts, qet-templates.ts, qet-check.ts, qet-tool.ts
(+ .test.ts for xml/qet, templates/check, tool); tools.ts (gating), result-change.ts (tool union), tools/changes.ts,
tools/registry.ts (+test), shared tools.ts, events.ts, session-state.ts, index exports; desktop workbench-tools.tsx and
locales; sessions/electrical-model.test.ts, write-edit.test.ts, prepare-plugins.test.ts lists; plugin qelectrotech
(plugin.yaml, README, skill, help x4), catalog.yaml, packs.yaml; fixtures tests/fixtures/qelectrotech (QET-saved
candidates + model); docs (knowledge, CONTRIBUTING, plan, CHANGELOG, release notes).

**Risks and open decisions.** Untrusted XML: no DTD at all, bounded size/depth/nodes (REQ-DATA-963cbdf6). A QET
version may write structure the reader does not know: unknown elements are ignored, only the mapped ones are read, and
unresolved references are problems, never silent drops. Whether QET 0.90 opens 0.100-structure files is probed. Graph
cut check is exponential only in pathological graphs: paths enumerated with a 10 000 path bound, beyond which the
check is unknown.

**Requirement map.** REQ-DATA-963cbdf6 xml-strict.ts; REQ-FUNC-778b9fc6, REQ-FUNC-8958b763 qet.ts; REQ-FUNC-3f13f78d,
REQ-FUNC-07c03695, REQ-FUNC-b21bd414 qet-check.ts + qet-tool.ts; REQ-FUNC-2e3af206 qet-templates.ts + qet-tool.ts;
REQ-REL-3e094ff0, REQ-DATA-6609a3b6 qet-tool.ts (+ splice in qet.ts); REQ-TEST-7eb1927d fixtures; REQ-SEC-4dfa2a5b
tools.ts gating; REQ-UX-d32cc9db workbench-tools + locales.

Diagrams: [diagram_TASK-9efaec3e.md](diagram_TASK-9efaec3e.md)


## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: QET probe: Windows portable 0.100.0+git8590 (download.qelectrotech.org tags/20260125, 7z sha256 552402198011f37633ffcff4f9ce561a9abaf22dc14f9cc09ddc231245b16445) prints 0.100.0 for --version; WSL2 Ubuntu 24.04 apt qelectrotech 1:0.9-2build2 prints 0.90; both list only --help, -v/--version, --license and directory options - no CLI export or headless mode (qetarguments.cpp)
- 2026-11-15 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-15 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-15 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-15 build: DEVIATION build: xml-strict.ts, qet.ts, qet-symbols.ts, qet-templates.ts and qet-check.ts were written before their tests; the tests followed in the same increment, so no red run was recorded for them - the mutation tests (removed conductor, bridged interlock, missing overload NC, wrong star point, missing phase swap) show the checks fail where they must
- 2026-11-15 build: finding: motor-drives reversing with an overload relay recorded KM2 -> F1 without the phase swap (only the no-relay case said motor:W1,V1,U1); fixed in motor-drives.ts as KM2 -> F1:5,3,1 (same notation), no motor-drives test asserted the old connection
- 2026-11-15 build: green: npx vitest run qet.test.ts qet-templates.test.ts exit 0, 33 passed (REQ-DATA-963cbdf6, REQ-FUNC-778b9fc6, REQ-FUNC-8958b763, REQ-FUNC-2e3af206, REQ-FUNC-07c03695)
- 2026-11-15 build: visual check: QET 0.100.0 opened dol.generated.qet without a load error in its log (D:/Temp/cad01-qet/visual/qet-win.log); screen access to QET (Windows and WSLg) was declined by the user, so no screenshot and no QET-saved fixture yet - CAD-01-B/D visual part open
- 2026-11-16 build: green: npx vitest run src/libraries/core/src/electrical/ sessions/electrical-model.test.ts tools/registry.test.ts tools/write-edit.test.ts tests/packaging/prepare-plugins.test.ts desktop workbench-tools.test.ts main/sessions.test.ts exit 0 after the prepare-plugins order fix (28 files, 308 passed, 3 skipped) (all REQ of the task)
- 2026-11-16 build: green: WSL2 Ubuntu 24.04 ~/vera-cad (rsync of the worktree, setup.py ok) vitest qet, qet-templates, qet-tool, motor-drives, motor-drives-tool, sessions/electrical-model exit 0 (6 files, 74 passed)
- 2026-11-16 build: QET load probes: Windows 0.100.0 opened reversing and star-delta candidates too, no error lines in its log; WSL2 0.90 (QT_QPA_PLATFORM=offscreen) ran 20 s on each of the three without a crash or load message. Not a visual check.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: Inspection REQ-TEST-7eb1927d: tests/fixtures/qelectrotech holds dol/reversing/star-delta.generated.qet with self-authored symbols only (embed://import/vera/, no QET collection element); qet-templates.test.ts compares fresh renders byte for byte; QET 0.100.0 (Windows) and 0.90 (WSL2 offscreen) loaded all three without a load error; the visual check with screenshots is open because screen access to QElectroTech was declined
- 2026-11-16 validate: review round 1 findings - quality: (1) lineAt per element makes parsing quadratic; (2) entity check 'in PREDEFINED' accepts &constructor;/&__proto__;; (3) duplicate uuids in an edit can insert duplicate information; (4) inserted lines use LF in CRLF files. spec: (1) conductor-numbering pass/fail untested; (2) spec says 0.100 structure, code writes version 0.90; (3) spec names F1/<coil>, code interlock:electrical:F1; (4) sequence check not tied to KT1; (5) no tests for link-type, report-unlinked, modelOnly/device-list fail, node cap; (6) clip can cut the sha256 off sources; (7) denied approval for the QET tools not asserted
- 2026-11-16 validate: returned to build - review round 1: fix the eleven recorded findings
- 2026-11-16 build: green: review round 1 fixes - running line count, Object.hasOwn entity check, repeated UUID refused, CRLF kept on insert, hash kept in sources, timer contacts tied to KT1, spec aligned (0.90 structure, interlock:electrical:F1, repeated UUID), REQ-REL verification; new tests: prototype entities, node cap + 400k-element linear-time bound, link-type, report-unlinked, numbering pass/fail, device-list fail (modelOnly, differs), repeated UUID, CRLF + long path; vitest focused 28 files exit 0 (315 passed, 3 skipped); typecheck exit 0; biome on new files clean
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: final: python .agentic/aegis.py check --task TASK-9efaec3e --strict --run exit 0; lint, typecheck, i18n, help ok (test not in the run list per verification policy; focused vitest 28 files 315 passed after the last code edit); remaining warnings: journal-header in other tasks (pre-existing), uncovered-source for help pages, CONTRIBUTING and test files, outside-layout for release notes - same as the PWR plugins, not limiting
- 2026-11-16 validate: completed; next done
- 2026-11-16 done: green (final candidate, after review fixes): WSL2 Ubuntu 24.04 ~/vera-cad vitest qet, qet-templates, qet-tool, motor-drives, motor-drives-tool, sessions/electrical-model exit 0 (6 files, 81 passed)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-9efaec3e.md
changed: plugin qelectrotech (3 tools, reader, templates, checks), motor-drives phase-swap fix, docs, 10 new + 2 revised requirements
evidence: check --strict --run exit 0; vitest focused 28 files exit 0 (315 passed); WSL2 6 files exit 0 (74 passed, before review fixes); review round 2 approved/approved
issues: visual check in QElectroTech open (screen access declined); no QET-saved fixtures; conductor numbering not tried on a real numbered project; native Ubuntu open
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-16)

- stage: validate; type: feature; path: full; branch: feature/123-electrical-schematics
- requirements:
  - REQ-DATA-963cbdf6 - Read a QElectroTech project only from strict XML without DTD or entities
  - REQ-FUNC-778b9fc6 - Map the folios, symbols, conductors and potentials of a QElectroTech project
  - REQ-FUNC-8958b763 - Group QElectroTech devices and check their cross-references
  - REQ-FUNC-3f13f78d - Reconcile QElectroTech devices with the electrical model as proposed operations
  - REQ-FUNC-2e3af206 - Generate DOL, reversing and star-delta candidates from a current motor_drives assembly
  - REQ-FUNC-07c03695 - Validate a candidate's connections and interlocks from its written XML
  - REQ-REL-3e094ff0 - Write QElectroTech files only through the prepared change with a base hash
  - REQ-DATA-6609a3b6 - Edit a QElectroTech project by splices that keep unaffected bytes and UUIDs
  - REQ-FUNC-b21bd414 - Store a QElectroTech check result stamped with the project's sha256
  - REQ-TEST-7eb1927d - Self-authored QElectroTech fixtures saved by the real application
  - REQ-SEC-4dfa2a5b - Offer the electrical tools only to hosts that enable them, never the change tool read-only
  - REQ-UX-d32cc9db - Describe the electrical tools in the workbench tools editor
- deviations: 1 recorded
  - build: xml-strict.ts, qet.ts, qet-symbols.ts, qet-templates.ts and qet-check.ts were written before their tests; the tests followed in the same increment, so no red run was recorded for them - the mutation tests (removed conductor, bridged interlock, missing overload NC, wrong star point, missing phase swap) show the checks fail where they must
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 86801fb: 62 file(s) changed, 6827 line(s) added
- checks: errors=0 warnings=42 notes=38
- checklist: 9/9 done

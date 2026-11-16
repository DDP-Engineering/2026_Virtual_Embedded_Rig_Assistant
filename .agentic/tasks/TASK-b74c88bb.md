# TASK-b74c88bb - CAD-04 eplan: EPLAN Electric P8 2025 exchange adapter - strict device/terminal/connection tables, reconcile with the documentation lists, import candidate, Windows command-line helper, round-trip verification (#136)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-203d52e6, REQ-DATA-e601f922, REQ-FUNC-f415fdc8, REQ-FUNC-0103d4c6, REQ-REL-f8d51ff3, REQ-FUNC-8b2ae38f, REQ-REL-803299e7, REQ-SEC-8fcf4dc1, REQ-REL-cafafa22, REQ-REL-a897a77d, REQ-TEST-ba396827, REQ-SEC-4dfa2a5b, REQ-UX-d32cc9db
parent:
branch: feature/123-electrical-schematics
base: fc7525cebe786d436f9d3268e16c9c2129b2b2d3
opened: 2026-11-16

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

Problem: VERA has the electrical model, QElectroTech schematics, the panel result and the documentation lists, but no
way to exchange devices, terminals and connections with EPLAN Electric P8, so a project kept in EPLAN cannot be checked
against VERA's documentation, nor can VERA hand approved data back (OBSERVED: core src/electrical has no EPLAN code;
electrical-schematics.md lists CAD-04 planned). There is no EPLAN installation or licence (STATED: brief, user decision
2026-11-15).
Desired outcome: plugin `eplan` (ecosystem electrical, PolyForm NC, help en/ro/de/fr, pack "Electrical schematics and
panels", tools gated on its own ID) built only on what the official public EPLAN API 2025 documentation states
(STATED: brief, ticket): (1) a strict mapping profile naming the declared target (EPLAN Electric P8 2025, Windows x64),
the project link file and the exchange table columns; (2) strict reading of the semicolon-separated device list export
(XDLCsvImporterExporter) and of terminal and connection tables written by the user's export scheme, keeping unmapped
columns; (3) a reconcile with the model and a stored electrical-documentation run (devices, part numbers, terminals,
connections) that reports differences and proposes model operations it never applies; (4) an import candidate: a new
device list file built from the base export, unmapped cells and untouched rows kept byte for byte, with a mapping report
of what cannot transfer, prepared through the write flow with the base sha256; (5) a Windows helper `eplan-tool` with
finite operations over EPLAN's documented command-line actions (ProjectAction with OpenMode, devicelist, reports,
projectmanagement CREATESNAPSHOTCOPY, XMActionDCCommonExport): export read-only, import only into a new snapshot copy,
never ExecuteScript, never Remoting, never the open or selected project, with an outcome file; (6) a check result that
verifies the round trip (identities, unchanged properties, applied values) and the helper outcome, so wrong project,
locked or unsaved project, conflict, missing licence and Stop never count as success (INFERRED: from CAD-04-A..D and
the API research in this journal).
Actors: the agent with the plugin loaded; the engineer who keeps the EPLAN project, configures the export schemes, runs
the helper through VERA's approvals and reviews the candidate copy in EPLAN (STATED: ticket, plan section 4).
Primary scenario: plant M (fixture): the documentation run exists; the engineer exports devices, terminals and
connections from the EPLAN project (helper `export`); `eplan` view reconcile lists differences with the documentation
lists; `eplan_change` candidate writes a device list import file updating part numbers and adding a missing device;
helper `import` creates a snapshot copy, imports the file into the copy, regenerates the reports and re-exports;
`eplan_check` verifies identities, unchanged columns and that the candidate values arrived; the engineer then keeps or
discards the copy (INFERRED).
Examples: EPLAN row `-KM1-M1;SE.LC1D09P7;...` matches documentation label KM1-M1 and material LC1D09P7 with the declared
part prefix `SE.`; a connection `-Q1:2` -> `-KM1-M1:1` with wire 101 matches the documentation connection Q1:2 /
KM1-M1:1 wire 101; a re-export where an untouched row's description changed fails `unchanged` (INFERRED: fixture
design). No real EPLAN data was supplied.
Counterexamples: attaching to the EPLAN instance the user has open (Remoting) or acting on the selected project;
running a script found in the project (ExecuteScript); importing into the original project; reporting success from an
exit code when the re-export does not show the change (STATED: ticket).
In scope: shared profile schema (format 1); core strict table reader (the documentation tag-file CSV reader,
generalised to a delimiter), device tag parsing, reconcile, candidate, round-trip and outcome verification; tools
`eplan` (read), `eplan_change` (write), `eplan_check` (write); PEP 723 helper `eplan-tool` with refusals and a dry-run
plan; plugin package (find program EPLAN.exe, rules), skill, help, pack, catalog; i18n tool texts; spec, requirements,
knowledge, plan page, CHANGELOG, release notes; fictional fixtures.
Out of scope: EPLAN Data Portal; macros (authoring or placing: the macro file format is not documented publicly and
macro generation needs a macro project); PXF/EPJ project exchange (format not documented); connection or terminal
import (needs a .edc data configuration file of an undocumented format); Remoting and add-ins; Linux (STATED: ticket
excludes the Data Portal by default, plan section 4 promises no Linux for vendor adapters; INFERRED for the format
exclusions from the API research).
Constraints: formats stay version 1, no migrations (STATED: CLAUDE.md); reuse model, result-change/commitChange/write
queue, PathGuard, the documentation lists and its CSV reader (STATED: brief); no new npm dependency (STATED: brief);
cited public EPLAN pages for every format detail, self-authored fictional fixtures (STATED: brief); targeted tests,
no commit (STATED: brief); a mock never ticks a criterion (STATED: brief, plan section 5).
Success signals: focused tests green for the profile, the table reader, reconcile against a real documentation run of
plant M, the candidate (byte-identical untouched rows), the round-trip and outcome checks, refusals and gating; helper
refusal and dry-run tests green; lint, typecheck, check:i18n, check:help, check:release-notes green; CAD-04-A, the
real-application parts of C and D and the macro part of B stay open and #136 stays open.
Evidence: ticket F:/ProjectsDDP/VERA_Electrical_Automation_Plugins_Tickets/CAD-04.md; plan page
00_Planning/plan/electrical-schematics.md; API research 2026-11-16 below (eplan.help API 2025 pages, read in the
browser); knowledge electrical-model.md; core documentation.ts `csvRecords` (comma only) (OBSERVED).
Assumptions: the user's terminal and connection export schemes can write semicolon-separated text with a header row
(UNKNOWN until an install; recorded as a profile declaration); the device list CSV has a header row (UNKNOWN).
Unknowns: exact column headers and encoding of the device list CSV; whether EPLAN.exe returns a non-zero exit code on a
failed action; the licence each command-line action needs; whether ObjectIdentifier persists across sessions; whether a
command-line ProjectAction fails on a project open in another instance; what happens to unsaved work of an interactive
session.
Decision-blocking questions: none (no licence: build against the docs, real-application criteria open, #136 open -
user 2026-11-15; dependency, fixture and test rules in the brief).
Proposed behaviors: as in Desired outcome.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new tools, plugin and helper |
| no new interface or data format | no | profile file, exchange tables, outcome file |
| no new dependency | yes | stdlib Python helper, no npm package |
| an existing requirement already covers the behavior | no | no EPLAN requirement |
| no security or data-handling change | no | runs an external program on the user's project |

API research (2026-11-16, https://www.eplan.help/en-us/Infoportal/Content/api/2025/, pages dated 17.02.2025, read in
the browser, nothing downloaded):
- Platform: EPLAN API built on .NET Framework 4.8.1, tested on Windows 7/8/10 (EplanApiDotNet, DevelopmentEnvironment).
  Ways in: the EPLAN.exe command line (Command line parameters: /Variant, /Quiet 0|1|2 default 1, /Auto,
  /NoLicenseDialog, /NoUserRightsDialog, /Frame), offline applications (UsingEplanAssemblies: EplApplication.Init, a
  LockingStep before opening), add-ins, scripts, EPLAN Remoting (gRPC client to a RUNNING instance started without
  /NoRemoting).
- Licences: the API developer licence limits projects to 5 pages and loads unsigned programs only; a runtime licence
  needs EADN-signed programs (Signing_EPLAN_assembies); scripts run without an API licence but cannot reference other
  assemblies (Scripts). Which licence each command-line action needs is not stated.
- Project open/inspect: ProjectOpen and ProjectAction take /PROJECTNAME (.elk link file) and OpenMode
  Standard|ReadOnly|Exclusive; with a mode the project opens in it or not at all and an error is reported; a project
  needing an upgrade opens read-only (ProjectOpen, ProjectAction). Project has IsReadOnly, IsExclusive and Close, no
  Save: changes are committed by transactions (Transactions: an uncommitted transaction rolls back) under locks
  (Locking: an exclusive lock is needed for structure changes, copy and backup).
- Export/import: devicelist TYPE IMPORT|EXPORT|DELETE with FORMAT XDLXmlExporter (default), XDLCsvImporterExporter
  ("Uses semicolon as separator"), XDLTxtImporterExporter; partslist IMPORT/EXPORT (XPalXmlExporter, XPalCSVConverter);
  XMActionDCCommonExport (external editing: CONFIGSCHEME, LANGUAGE, DESTINATION TXT|XLSX|XML, EXECUTIONMODE) and
  XMActionDCImport (.edc data configuration file, changes function properties); XMExportConnectionsAction (kept for
  backward compatibility); label (txt/xls/xlsx/xml by scheme); reports TYPE PROJECT regenerates the reports; check TYPE
  PROJECT with a verification scheme; backup/restore (.zw1); projectmanagement CREATESNAPSHOTCOPY (FILENAME = target
  project); export/import PXFPROJECT (EPJ); XEsUserPropertiesExport/ImportAction (user property definitions as XML).
  The column layouts of these files come from configuration schemes and are not documented in the API reference.
- Macros: generatemacros/preparemacros need a project of type macro project; the XMIaInsertMacro interaction and
  Function.PlaceFunctionalMacro place macros. The macro file format is not documented there.
- Identity: StorableObject.ToStringIdentifier is valid only at runtime and becomes invalid when the project closes;
  DatabaseIdentifier changes when the project is reopened; ObjectIdentifier is "unique for all objects of this type"
  with no statement about persistence. The visible identity is the device tag (Function.Name, e.g. =AP+PT1-X4);
  user-defined properties (PropertyIdentName) can hold an external ID.
- Hazards: ExecuteScript runs any [Start] script with parameters; Remoting controls a running instance; ProjectAction
  without PROJECTNAME uses the last opened project.
- Not confirmed without an install: file headers and encodings, exit codes, licence per action, behaviour on a project
  open elsewhere, persistence of ObjectIdentifier, whether a user property survives the device list round trip.

## Requirement coverage

| Behavior | Requirement | Status |
|---|---|---|
| strict mapping profile | REQ-DATA-203d52e6 | new |
| strict exchange tables, unmapped columns kept | REQ-DATA-e601f922 | new |
| reconcile with the documentation lists (CAD-04-D data) | REQ-FUNC-f415fdc8 | new |
| device list import candidate (CAD-04-B import mapping) | REQ-FUNC-0103d4c6 | new |
| refusals before any change (CAD-04-C conflict) | REQ-REL-f8d51ff3 | new |
| check result: reconcile and round trip (CAD-04-B, CAD-04-D) | REQ-FUNC-8b2ae38f | new |
| no success without a completed outcome and re-export (CAD-04-C) | REQ-REL-803299e7 | new |
| helper runs only finite documented actions on the named project or a new copy | REQ-SEC-8fcf4dc1 | new |
| helper refusals before EPLAN starts (wrong project, conflict) | REQ-REL-cafafa22 | new |
| helper failure and Stop recorded as not completed (licence, lock, Stop) | REQ-REL-a897a77d | new |
| fictional fixtures, real-application tests gated | REQ-TEST-ba396827 | new |
| tool gating on plugin eplan | REQ-SEC-4dfa2a5b | revised |
| tool descriptions in the tools editor | REQ-UX-d32cc9db | revised |


## Design

**Approach**: two halves with one file contract between them (spec REQ-DATA-203d52e6). VERA side, pure and testable
here: shared `eplan.ts` (profile schema, outcome schema), core `eplan.ts` (profile check, table reader on the
documentation tag-file `csvRecords` generalised to a delimiter - one CSV reader, not a second; device tag parsing,
reconcile, candidate builder, round-trip and outcome checks) and `eplan-tool.ts` (tools `eplan` read: views inspect,
reconcile; `eplan_change` write: candidate; `eplan_check` write: result through `prepareResultChange`). EPLAN side: a
PEP 723 standard-library helper `eplan-tool` in the plugin that turns a profile into the documented EPLAN.exe
command lines (ProjectAction with PROJECTNAME and OpenMode, devicelist, XMActionDCCommonExport, projectmanagement
CREATESNAPSHOTCOPY, reports), imports only into a new snapshot copy and writes an outcome file (REQ-SEC-8fcf4dc1).
Success is never taken from EPLAN exit codes: eplan_check re-reads the re-export from the copy and compares it with the
base and the candidate (REQ-REL-803299e7). Rejected: an offline .NET program or add-in (cannot be compiled or tested
here, needs a signed runtime licence - Signing_EPLAN_assembies); Remoting (attaches to a running instance, which the
ticket forbids); PXF/EPJ, .edc and macro files (formats not documented); a `find` program for EPLAN.exe in the manifest
(the manifest requires a version probe and EPLAN.exe has no documented version option, so probing would start EPLAN).
**Interfaces and data**: profile `electrical-automation-eplan/<id>.json` (kind vera-eplan-profile, format 1,
REQ-DATA-203d52e6, read by `readEplanProfile`, 64 KiB); tables read by `readEplanTable` (PathGuard, 4 MiB,
REQ-DATA-e601f922); tool `eplan` {view inspect {profile, table, path, offset?} | reconcile {profile, documentationRun,
devices, terminals?, connections?}} (REQ-FUNC-f415fdc8); `eplan_change` {action candidate, profile, base, sha256,
documentationRun, path} -> one new .csv via `commitChange` (before absent; base sha256 rechecked at prepare,
REQ-FUNC-0103d4c6, REQ-REL-f8d51ff3); `eplan_check` {profile, documentationRun, exports {devices, terminals?,
connections?}, base?, candidate?, outcome?} -> one result, criteria per spec section 6 (REQ-FUNC-8b2ae38f,
REQ-REL-803299e7). Outcome file kind vera-eplan-outcome format 1 (strict zod in shared; written by the helper).
Errors: refusals throw before preparing; differences are failed criteria; no source file is ever written.
**Files and test seams**: shared src/eplan.ts (+ index export); core electrical/eplan.ts + eplan.test.ts (profile,
tables, tag parsing, candidate bytes, outcome rules), electrical/eplan-tool.ts + eplan-tool.test.ts (plant M chain with
a real documentation run, reconcile, candidate, check, refusals, gating); documentation.ts `csvRecords` exported with a
delimiter and raw spans (documentation tests rerun); plant M upstream chain moved from documentation-tool.test.ts into
electrical/plant-m.test-support.ts and shared by both tool tests; registration in tools.ts gating, registry,
changes.ts, result-change.ts, shared tools/events/session-state, desktop workbench-tools + 4 locales, core index.ts;
plugin 05_Software/plugins/eplan (plugin.yaml windows-x64, program eplan-tool, rules, README, skill eplan-exchange,
help x4), scripts/eplan_tool.py; tests/plugins/eplan.test.ts (manifest, rules, plans, refusals; real tests gated on
VERA_TEST_EPLAN_PROFILE; the step loop with a stand-in process); fixtures tests/fixtures/eplan (profile, tables; outcomes built
by the tests); packs.yaml, catalog.yaml,
CONTRIBUTING; test lists registry/write-edit/sessions electrical-model/prepare-plugins.
**Risks and open decisions**: everything EPLAN-side is unverified (spec section 7) and stays open; the helper's
command-line form follows the documentation examples and refuses paths with spaces to avoid an undocumented quoting
rule; the plugin is windows-x64 only, so its VERA-side tools are offered on Windows only (a stated limit). No product
decision is open.
**Requirement map**: REQ-DATA-203d52e6 `checkEplanProfile`; REQ-DATA-e601f922 `parseEplanTable`; REQ-FUNC-f415fdc8
`reconcileEplan` + view reconcile; REQ-FUNC-0103d4c6 `eplanCandidate` + eplan_change; REQ-REL-f8d51ff3 tool refusals;
REQ-FUNC-8b2ae38f `analyzeEplan` + eplan_check; REQ-REL-803299e7 `outcomeCriterion`; REQ-SEC-8fcf4dc1 helper `plan_steps`
+ rules; REQ-REL-cafafa22 helper `refuse`; REQ-REL-a897a77d helper step loop and signal handler; REQ-TEST-ba396827
fixtures and gated tests; REQ-SEC-4dfa2a5b `electricalPluginTools` entries; REQ-UX-d32cc9db locales.
Diagrams: [diagram_TASK-b74c88bb.md](diagram_TASK-b74c88bb.md)


## Log

- 2026-11-16 frame: journal opened
- 2026-11-16 frame: Frame recorded under autopilot from the brief and the public EPLAN API 2025 research; commits by the coordinator only (brief)
- 2026-11-16 frame: completed; next specify - frame recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-16 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-16 design: Dependency decision: no new npm dependency; the helper is a PEP 723 script using the Python standard library only
- 2026-11-16 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-16 build: red: npx vitest run eplan.test.ts eplan-tool.test.ts exit 1 - 15 failed: profile, table reader, tag parsing, reconcile, candidate, check, outcome and gating missing (REQ-DATA-203d52e6, REQ-DATA-e601f922, REQ-FUNC-f415fdc8, REQ-FUNC-0103d4c6, REQ-REL-f8d51ff3, REQ-FUNC-8b2ae38f, REQ-REL-803299e7, REQ-SEC-4dfa2a5b)
- 2026-11-16 build: green: npx vitest run eplan.test.ts eplan-tool.test.ts documentation.test.ts documentation-tool.test.ts exit 0, 39 tests (REQ-DATA-203d52e6, REQ-DATA-e601f922, REQ-FUNC-f415fdc8, REQ-FUNC-0103d4c6, REQ-REL-f8d51ff3, REQ-FUNC-8b2ae38f, REQ-REL-803299e7, REQ-SEC-4dfa2a5b); plant M bench moved to electrical/plant-m.test-support.ts, documentation csvRecords takes a delimiter and returns spans
- 2026-11-16 build: green: npx vitest run eplan, eplan-tool, documentation, documentation-tool, tools, qet-tool, registry, write-edit, sessions/electrical-model, workbench-tools, packaging/prepare-plugins, plugins/eplan exit 0 (90 passed, 2 skipped: the real-EPLAN case and an existing skip); typecheck, lint, check:i18n, check:help, check:release-notes exit 0 (REQ-SEC-8fcf4dc1, REQ-REL-cafafa22, REQ-SEC-4dfa2a5b, REQ-UX-d32cc9db, REQ-TEST-ba396827)
- 2026-11-16 build: Inspection (REQ-REL-a897a77d): eplan_tool.py execute() writes outcome.json with status interrupted before the first step, stops at the first step with a non-zero exit, timeout (taskkill /T /F of the started PID) or missing file (status failed, exit 1), turns SIGINT/SIGTERM/SIGBREAK and KeyboardInterrupt into interrupted after ending EPLAN's tree, and writes completed only after every step; a hard kill by VERA's Stop leaves the provisional interrupted outcome.
- 2026-11-16 build: DEVIATION build: the helper's step loop, timeout and Stop handling (REQ-REL-a897a77d) are verified by inspection only - no EPLAN installation, and the helper finds EPLAN.exe only in the default install folder, so no test can start a step; the real-application tests are gated on VERA_TEST_EPLAN_PROFILE and skipped
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: review round 1 quality changes_required: Stop/Ctrl+C never ended EPLAN (CURRENT reset in finally; wait blocks signals), empty EPLAN part never filled by the candidate, --copy not confined, outcome criterion trusts steps/profile, appended -<tag> devices fail identity after EPLAN adds the structure, lone CR accepted, malformed profile raises a traceback
- 2026-11-16 validate: review round 1 spec changes_required: spec lists terminal wire/vera and connection vera columns the schema refuses; spec status rule differs from code; VERA_TEST_EPLAN name; plugin suite red on Linux; REQ-FUNC-0103d4c6 overstates appended devices; verifications claim untested refusals (eplan_check conflict/read-only, 4 MiB, profile read); optional /NoRemoting; helper profile check weaker
- 2026-11-16 validate: returned to build - review round 1 findings (spec and quality changes_required)
- 2026-11-16 build: green: round 1 fixes - helper waits in 1 s slices and ends the running EPLAN on Stop, /NoRemoting, copy confined beside the project link (copy-folder), malformed profile refused; candidate fills an empty EPLAN part; outcome requires the profile sha256 and steps snapshot/import/reports/export with exit 0; appended -<tag> devices found by identifier; lone CR refused; spec, requirement and README texts aligned; plugin helper tests Windows-only. npx vitest run (12 files) exit 0, 91 passed 2 skipped; typecheck, lint, check:i18n, check:help, check:release-notes exit 0 (REQ-REL-a897a77d, REQ-REL-cafafa22, REQ-SEC-8fcf4dc1, REQ-FUNC-0103d4c6, REQ-REL-803299e7, REQ-FUNC-8b2ae38f, REQ-DATA-e601f922, REQ-REL-f8d51ff3)
- 2026-11-16 build: REQ-REL-a897a77d is now covered by a plugin test that runs the helper's step loop with a stand-in process (completed, step-failed, no-file, timeout, Stop); the earlier build deviation stays true only for EPLAN itself, whose behaviour is unverified
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: review round 2: spec approved, quality approved; applied the spec reviewer's two wording-only should-fix items afterwards (electrical-model.md rule sentence, plan page eplan-tool bullet) - documentation only, no code change; quality should-fix notes accepted: duplicate appended identifiers fail safe, a killed step keeps exit null
- 2026-11-16 validate: final: python .agentic/aegis.py check --task TASK-b74c88bb --strict --run exit 0; ran lint, typecheck, check:i18n, check:help (all ok), strict ok; remaining warnings: pre-existing journal-header and ticket-ref records of other tasks, uncovered-source for registration/test-list files, test support, fixtures README and plugin help (no requirement lists them, as in CAD-02/03), outside-layout for CHANGELOG and release notes (repository convention). Focused tests ran before (12 files, 91 passed, 2 skipped: the real-EPLAN case and an existing skip); full suite not run by the coordinator's instruction (after CAD-04, by the coordinator).
- 2026-11-16 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-b74c88bb.md
changed: plugin eplan: shared eplan.ts, core eplan.ts, eplan-tool.ts + tests, plant-m.test-support.ts, documentation csvRecords delimiter, registrations, plugin package with eplan-tool, fixtures, spec, requirements, knowledge, plan page; 41 files
evidence: check --task TASK-b74c88bb --strict --run exit 0; focused vitest 12 files exit 0 (91 passed, 2 skipped); review round 2 spec approved, quality approved
issues: CAD-04-A open (no EPLAN/licence); B, C, D partly: VERA side only, EPLAN behaviour unverified, macros not handled; real-EPLAN tests gated on VERA_TEST_EPLAN_PROFILE and skipped; Windows x64 only; paths with spaces refused; full suite deferred to the coordinator; #136 stays open
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-16)

- stage: validate; type: feature; path: full; branch: feature/123-electrical-schematics
- requirements:
  - REQ-DATA-203d52e6 - Accept only a strictly valid EPLAN mapping profile
  - REQ-DATA-e601f922 - Read an EPLAN exchange table strictly or refuse it, keeping unmapped columns
  - REQ-FUNC-f415fdc8 - Reconcile EPLAN devices, part numbers, terminals and connections with the documentation lists
  - REQ-FUNC-0103d4c6 - Prepare an EPLAN device list import candidate that keeps every untouched row and cell
  - REQ-REL-f8d51ff3 - Refuse an EPLAN candidate on a changed base export or invalid inputs before any change
  - REQ-FUNC-8b2ae38f - Store an EPLAN check result with reconcile and round-trip criteria through an approved prepared change
  - REQ-REL-803299e7 - Never count an EPLAN import as applied without a completed outcome and matching re-export
  - REQ-SEC-8fcf4dc1 - Run only finite documented EPLAN command-line actions on the named project or a new copy
  - REQ-REL-cafafa22 - Refuse an eplan-tool operation before EPLAN starts when its inputs are unsafe or invalid
  - REQ-REL-a897a77d - Stop the eplan-tool sequence at the first failure or Stop and record it as not completed
  - REQ-TEST-ba396827 - Fictional plant M EPLAN exchange fixtures and real-application tests gated on an installation
  - REQ-SEC-4dfa2a5b - Offer the electrical tools only to hosts that enable them, never the change tool read-only
  - REQ-UX-d32cc9db - Describe the electrical tools in the workbench tools editor
- deviations: 1 recorded
  - build: the helper's step loop, timeout and Stop handling (REQ-REL-a897a77d) are verified by inspection only - no EPLAN installation, and the helper finds EPLAN.exe only in the default install folder, so no test can start a step; the real-application tests are gated on VERA_TEST_EPLAN_PROFILE and skipped
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base fc7525c: 65 file(s) changed, 4592 line(s) added
- checks: errors=0 warnings=46 notes=38
- checklist: 9/9 done

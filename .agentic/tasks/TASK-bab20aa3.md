# TASK-bab20aa3 - PWR-06 lighting-design: preliminary lumen-method estimate, IES/LDT import with diagnostics, direct point calculation, verification-report mapping for DIALux evo (#132)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-affb2e6b, REQ-FUNC-21405311, REQ-FUNC-ca72aaff, REQ-FUNC-b78b7b15, REQ-FUNC-dafae3f1, REQ-FUNC-e087cb4d, REQ-FUNC-addd6a2f, REQ-FUNC-e86a35c5, REQ-FUNC-50fa2fc0, REQ-REL-840d2785, REQ-FUNC-98dceeb1, REQ-TEST-4eb926f2, REQ-SEC-4dfa2a5b, REQ-UX-d32cc9db, REQ-DATA-06c0bd54
parent:
branch: feature/122-electrical-power
base: b0cc097f6af271c14fb6de49773f2101166d326f
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

Problem: VERA has no lighting design support: no photometry import (IES LM-63, EULUMDAT), no room/luminaire input,
no illuminance estimate and no way to map a photometric engine's report (OBSERVED: core/src/electrical/ has no
lighting code; 00_Planning/plan/electrical-power.md lists PWR-06 planned; units.ts already has lm, lx, lm/W).
Desired outcome: plugin `lighting-design` (ecosystem electrical, pack "Electrical power and distribution") with a pure
engine in core and one write tool `lighting_design`, gated on its own plugin (PWR-04 RULING-001), at two declared
levels: (1) a preliminary estimate (lumen/utilisation method with a cited utilisation factor, plus the direct component
on the calculation grid from the photometry), numerically verified and labelled preliminary, never a detailed verdict;
(2) verification that maps a report of a demonstrated photometric engine (DIALux evo target) for the same room and
photometry, and is the only level with maintained illuminance, uniformity and UGR verdicts. Inputs: geometry and
declared length unit, reflectances, calculation plane, luminaire types with IES/LDT photometry (optionally a catalog
item), positions/orientations, scenarios, maintenance factor, user-entered requirements with a source field.
Diagnostics for wrong scale/units/orientation and missing photometry; uniformity/UGR not computed stay
not-evaluated; emergency and exterior are separate profiles, declared not supported in this delivery (STATED: ticket
PWR-06, coordinator brief).
Actors: the agent with lighting-design loaded; the engineer who keeps the lighting project, photometry, catalog and
report records and approves result writes (STATED: brief).
Primary scenario: the engineer keeps `electrical-automation-lighting/<id>.json` (room, surfaces, plane, luminaires,
scenarios, MF, requirements) and photometry files; the agent calls `lighting_design` level preliminary; VERA prepares
result.json with the estimate, direct grid values and diagnostics (approval like a write). For verification the
engineer rebuilds the room in DIALux evo from the same data and photometry (assisted step), calculates there, and a
report record maps DIALux's values; `lighting_design` level verification checks the record against the project and
gives the verdicts (STATED: brief "assisted flow may deliver data and check the real report").
Examples: lumen method E = N Phi UF MF / A, room index k = L W / (hm (L + W)) (INFERRED: textbook method, hand
calculations as independent oracle); a Lambertian intensity I0 cos(g) integrates to pi I0 (INFERRED: analytic); a
point directly below a luminaire at height h gets E = I(0)/h^2 (INFERRED: inverse-square cosine law).
Counterexamples: a preliminary result claiming uniformity or UGR; a pass on a DIALux record whose room size, MF or
luminaire count differ from the project; a room of 6000 m (mm typed as m) accepted silently; an upward-tilted
luminaire counted as lighting the plane; writing STF or another unpublished DIALux format; a "headless DIALux run"
(STATED: ticket).
In scope: lighting project file format 1 and report record format 1 (shared schema + core readers); IES LM-63
(1995/2002/2019 header, type C, TILT=NONE) and EULUMDAT (Isym 0, 1, 2, 4) parsers with diagnostics; engine + write
tool + compact request schema; catalog convention for luminaires; plugin package, skill, README, pack; en/ro/de/fr tool
texts; fixtures (fictional room, hand-written fictional IES/LDT, fictional report record); spec/requirements/knowledge/
plan/CONTRIBUTING; DIALux evo capability probe as a recorded proof activity at the end.
Out of scope: inter-reflection (radiosity) calculation and VERA-computed UGR (verification level only via an engine
report); daylight; emergency/exterior criteria (declared not supported); writing DIALux project files, STF, or UI
automation of DIALux (STATED: ticket); copied EN 12464-1 tables (STATED: user decision, values only user-entered).
Constraints: formats version 1, no migrations; reuse catalog findItems, result-change, generic report, one unit table,
confined file reads like measurements.ts; compact tool schema (32k replay test); targeted tests; no commit; no
CHANGELOG; downloads only after coordinator approval (STATED: brief).
Success signals: PWR-06-A, C, D focused tests green on Windows and WSL2 with analytic/hand-calculation oracles at
tolerances fixed before comparison; PWR-06-B met only if DIALux evo is installed and a real room is calculated there,
otherwise open with the assisted-flow needs recorded; lint, typecheck, check:i18n green.
Evidence: ticket F:/ProjectsDDP/VERA_Electrical_Automation_Plugins_Tickets/PWR-06.md; plan; PWR-00..05 hand-overs;
core electrical/*.ts; shared electrical-model.ts, industrial-catalog.ts; DIAL knowledge base article 9000073210 "Exchange
of data from CAD programs to DIALux and back again" (read 2026-11-15: evo imports DWG/DXF and STF, STF export "in
preparation", STF documentation sent to CAD vendors on request - not openly published).
Assumptions: rectangular rooms only in the validated domain (INFERRED: lumen method room index needs L and W); C
angles counter-clockwise seen from above, C0 along the luminaire's rotation axis (INFERRED: LM-63/EULUMDAT C-plane
convention; stated in the spec).
Unknowns: DIALux evo installation (not installed at start, checked 2026-11-15 Program Files/registry/Start menu); which
results export of the installed version exists (CSV/XML tables not confirmed from a DIAL page); public manufacturer
IES/LDT with clear terms (none chosen, coordinator approval needed); native Ubuntu (WSL2 only).
Decision-blocking questions: none (coordinator brief settles scope, data policy, gating and the DIALux fallback).
Proposed behaviors: see Requirement coverage (autopilot).
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new tool, plugin, result |
| no new interface or data format | no | lighting project, report record, photometry readers |
| no new dependency | yes | zod/node only |
| an existing requirement already covers the behavior | no | none for lighting |
| no security or data-handling change | no | new workbench file reads and result write |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| lighting project, report record, photometry files, request, result names | REQ-DATA-affb2e6b (spec) |
| IES LM-63 / EULUMDAT parsing in the validated domain, refusals outside | REQ-FUNC-21405311 |
| preliminary lumen-method estimate with cited UF, labelled preliminary | REQ-FUNC-ca72aaff |
| direct component on the calculation grid (values only) | REQ-FUNC-b78b7b15 |
| scale/unit/orientation and missing-photometry diagnostics | REQ-FUNC-dafae3f1 |
| uniformity and UGR not-evaluated without an engine report | REQ-FUNC-e087cb4d |
| verification against a mapped engine report record | REQ-FUNC-addd6a2f |
| emergency/exterior profiles not supported (blocked) | REQ-FUNC-e86a35c5 |
| luminaire catalog item vs photometry | REQ-FUNC-50fa2fc0 |
| refused inputs, nothing prepared | REQ-REL-840d2785 |
| result via prepared change with snapshots, file sha256 | REQ-FUNC-98dceeb1 |
| analytic/hand references, fictional labelled fixtures | REQ-TEST-4eb926f2 |
| per-plugin tool gating incl. lighting_design (revised) | REQ-SEC-4dfa2a5b |
| lighting_design description en/ro/de/fr (revised) | REQ-UX-d32cc9db |

## Design

**Approach**: as PWR-02..05, product code next to the model. Shared `lighting-project.ts` (format-1 zod schemas of the
project and report record, folders, limits); core `electrical/photometry.ts` (pure `parsePhotometry(name, text)` ->
normalized absolute candela table + `intensityAt(C, g)` + integrated flux, refusals outside the validated domain);
core `electrical/lighting-files.ts` (pure `checkLightingProject`/`checkLightingReport` for references and IDs, and the
confined readers `readLightingProject`, `readLightingReport`, `readPhotometryFile`, `hashEvidenceFile`, like
measurements.ts); pure engine `electrical/lighting.ts` (`lightingRequestSchema`, `analyzeLighting(input)` ->
ElectricalResult, exported `roomIndex`, `utilisationFactorAt`, `directIlluminance` for reference tests); write tool
`electrical/lighting-tool.ts` (`lighting_design`, class write) that reads model, project, photometry, optional catalog
and report, checks model loads, runs the engine and prepares ONE result through `prepareResultChange`.
Rejected: a radiosity/inter-reflection engine or VERA-computed UGR (not demonstrable here; the ticket wants
verification on a demonstrated engine); generating UF from LDT direct ratios (needs copyrighted utilance tables);
writing STF/DIALux project files (STF documentation is sent to CAD vendors on request, not published - DIAL KB
9000073210); a Program Files probe in product code (the capability probe is a proof activity recorded in the journal,
plan section 4 "first stage of each adapter verifies the public operations on the installed version"); room/luminaire
objects in the electrical model (geometry arrays do not fit object properties; a separate file like PWR-05's
measurement file, freshness stated as a limit with sha256 in sources).
Reuse: catalog `findItems` + `readCatalogFile`, `result-change.ts`, `renderResultReport`, units.ts (adds `m²` to area and
dimension `power-density` `W/m²`), PathGuard confined reads as measurements.ts, `linkProblem` not needed (no links),
gating `electricalPluginTools`.
**Interfaces and data**: spec REQ-DATA-affb2e6b. Fixtures `tests/fixtures/lighting-design/` (all fictional, hand-written):
`lgt-office-a.json` (8 x 6 x 3 m, 12 panels, two scenarios), `fict-panel.ldt` (Isym 4 panel, cd/klm), `fict-downlight.ies`
(LM-63-2002 rotational, absolute), `rep-office-a.json` (fictional record), `model-lighting.json` (minimal model with a
lighting load), `cat-lighting.json` (fictional luminaire items). Errors: invalid request/file/reference -> thrown,
nothing prepared; data gaps -> unknown criteria.
**Files and test seams**: shared lighting-project.ts, index.ts, tools.ts, events.ts, session-state.ts; core
electrical/photometry.ts (+test), lighting-files.ts (+test), lighting.ts (+test), lighting-tool.ts (+test),
result-change.ts, tools.ts, units.ts, index.ts, tools/registry.ts (+test), tools/changes.ts;
sessions/electrical-model.test.ts; desktop workbench-tools.tsx + 4 locales; plugins/lighting-design/ (plugin.yaml,
README, skill lighting-design), catalog.yaml, packs.yaml; CONTRIBUTING, knowledge, plan page, fixtures README.
**Risks and open decisions**: PWR-06-B needs DIALux evo installed and authorized real photometry (coordinator);
which results export the installed DIALux version offers is unknown until the probe; direct-only grid is a lower bound,
never a verdict; tool-schema size (keep the request tiny).


## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-15 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-15 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-15 build: red: npx vitest run core/src/electrical/photometry.test.ts exit 1 - module photometry.ts missing (REQ-FUNC-21405311)
- 2026-11-15 build: green: npx vitest run core/src/electrical/photometry.test.ts exit 0, 9 tests (REQ-FUNC-21405311)
- 2026-11-15 build: red: npx vitest run core/src/electrical/lighting.test.ts exit 1 - module lighting.ts missing (REQ-FUNC-ca72aaff, REQ-FUNC-b78b7b15, REQ-FUNC-dafae3f1, REQ-FUNC-e087cb4d, REQ-FUNC-addd6a2f, REQ-FUNC-e86a35c5, REQ-FUNC-50fa2fc0)
- 2026-11-15 build: correction of the previous red line: lighting.ts already existed when lighting.test.ts first ran (it failed on a transform error, not on missing behavior). DEVIATION build: the engine, lighting-files and the shared schema were written before their tests ran red - the tests encode the spec's hand calculations written before the engine; costs the red-first evidence for those increments
- 2026-11-15 build: green: npx vitest run core/src/electrical/{photometry,lighting-files,lighting}.test.ts exit 0, 31 tests; direct inner-grid average 580.29 lx vs independent Python midpoint sum 580.42 lx (0.02 %, tolerance 1 %); fictional UF table raised to 0.70/0.76 so it is not below the 0.61 direct share (REQ-FUNC-21405311, REQ-FUNC-ca72aaff, REQ-FUNC-b78b7b15, REQ-FUNC-dafae3f1, REQ-FUNC-e087cb4d, REQ-FUNC-addd6a2f, REQ-FUNC-e86a35c5, REQ-FUNC-50fa2fc0, REQ-DATA-affb2e6b)
- 2026-11-15 build: green: npx vitest run core/src/electrical/ + tools/registry + sessions/electrical-model + sessions/skills + desktop main/sessions, workbench-tools, plugin-packs + plugins catalog-source, catalog + shared plugin-catalog exit 0: 28 files, 295 passed, 2 skipped; typecheck exit 0; lint exit 0; check:i18n exit 0 (all REQs of the task)
- 2026-11-15 build: green WSL2 (~/vera-pwr at b0cc097 + 39 changed files, script wsl-pwr06.sh in the session scratchpad): vitest core/src/electrical/ + tools/registry + sessions/electrical-model + sessions/skills + plugins catalog-source, catalog + shared plugin-catalog exit 0: 25 files, 278 passed, 1 skipped. WSL2 is not native Ubuntu.
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: DIALux evo capability probe 2026-11-15 (PowerShell, read-only): no DIAL*/DIALux folder under Program Files, Program Files (x86), LocalAppData\Programs or ProgramData; no Uninstall entry (HKLM, WOW6432Node, HKCU) with DIAL in name or publisher; no HKLM/HKCU DIAL GmbH key; no Start menu entry; no App Paths entry; file associations: .evo -> VLC.evo (VLC, unrelated), .stf/.ldt/.ies/.ulf/.gldf none. DIALux evo is NOT installed: no import/export of an installed version could be probed; PWR-06-B stays open. Documented interfaces (DIAL KB 9000073210, read 2026-11-15): DWG/DXF import and export, STF import (STF export 'in preparation'), STF documentation sent to CAD vendors on request (not published) - so VERA writes no STF; IES/LDT are open luminaire formats DIALux reads.
- 2026-11-15 validate: review round 1: spec - REQ-FUNC-e087cb4d vs REQ-FUNC-addd6a2f contradict on not-evaluated vs unknown for a non-matching/missing surface (prose fix). quality - result texts are not truncated to the result schema limits (sources 200, notes/messages 1000): a long MF/requirement/UF source, a long photometry name or a blocked note listing 50+ luminaires makes checkResult refuse the whole run. Non-blocking taken: per-scenario abort check, BOM strip, LDT missing-line check, multi-item catalog message, placement criteria summarised past 20, rotation direction test, catalog absent-value test, EULUMDAT flux-vs-LORL test, wording fixes.
- 2026-11-15 validate: returned to build - review round 1 findings: requirement prose contradiction; result text limits
- 2026-11-15 build: round-1 fixes: result texts clipped to the format limits (sources 200, notes/messages/assumptions 1000), placement criteria past 20 summarised, blocked note names 5 + 'and N more', abort signal checked per scenario, BOM stripped (IES/LDT and JSON), LDT missing-line check, separate multi-item catalog message, limit line for report-match without reflectances/positions; requirement prose REQ-FUNC-e087cb4d/addd6a2f/21405311, REQ-REL-840d2785 aligned; spec wording; tests added (60 misplaced luminaires + long sources through checkResult, rotation direction with a bilateral C0/C180 3:1 distribution, catalog absent value, LDT flux vs LORL, BOM, missing surface not-evaluated, report record sha256 source). green: vitest Windows 28 files 298 passed/2 skipped exit 0; WSL2 25 files 281 passed/1 skipped exit 0; typecheck, lint, check:i18n exit 0 (REQ-FUNC-dafae3f1, REQ-FUNC-e087cb4d, REQ-FUNC-addd6a2f, REQ-DATA-affb2e6b)
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: review round 2: spec approved, quality approved. Accepted non-blocking: a source line longer than 200 characters (type ID + photometry name near their maxima) is clipped at the end and can lose its sha256; the project-level placement summary lists every further ID and relies on clipping; the BOM is also ignored in LDT and lighting JSON files although the spec names IES only; confined() duplicates measurements.ts; Isym 0 with uneven C spacing is refused with a generic message.
- 2026-11-15 validate: final: python .agentic/aegis.py check --task TASK-bab20aa3 --strict --run exit 0 (strict ok; ran lint, typecheck, i18n; tests are not in [check] run, so the focused vitest runs logged above are the test evidence: Windows 28 files 298 passed/2 skipped, WSL2 25 files 281 passed/1 skipped). 0 errors, 44 warnings: 19 uncovered-source for wiring/fixture/doc files (same pattern as PWR-02..05), journal-header and ticket-ref warnings in other tasks' files; none limits this candidate.
- 2026-11-15 validate: inspection REQ-TEST-4eb926f2: read photometry.test.ts, lighting.test.ts and lighting-tool.test.ts - each oracle and its tolerance is stated in the file header or next to the assertion (pi I0 0.5 %, inverse-square cosine law 0.5 %, lumen method 0.5 %/1 %, Python midpoint 580.42 lx 1 %); the six fixtures in tests/fixtures/lighting-design/ declare fictional origin (IES [TEST] FICTIONAL keyword, LDT company line, project/report origin fictional, model limits text, catalog CC0 fictional source) and the fixtures README lists them. Observed: holds.
- 2026-11-15 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-bab20aa3.md
changed: plugin lighting-design; core photometry.ts, lighting-files.ts, lighting.ts, lighting-tool.ts (+tests); shared lighting-project.ts; gating/unions/registry/locales; units floor-area and power-density; fixtures lighting-design; spec REQ-DATA-affb2e6b, 12 requirements, 2 revised; knowledge, project context, CONTRIBUTING, plan page
evidence: check --task TASK-bab20aa3 --strict --run exit 0; vitest Windows 28 files 298 passed/2 skipped; WSL2 25 files 281 passed/1 skipped; review round 2 spec+quality approved
issues: PWR-06-B open: DIALux evo not installed (probe 2026-11-15) and no authorized real photometry; only fictional photometry shipped; emergency/exterior profiles not supported; lighting/photometry/report files not freshness-tracked (sha256 in sources); a clipped long source line can lose its sha256; native Ubuntu not run (WSL2 only)
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-15)

- stage: validate; type: feature; path: full; branch: feature/122-electrical-power
- requirements:
  - REQ-DATA-affb2e6b - Lighting project file, report record, request and lighting result format 1
  - REQ-FUNC-21405311 - Import IES and EULUMDAT photometry within the validated domain
  - REQ-FUNC-ca72aaff - Estimate average illuminance with the lumen method as a preliminary result
  - REQ-FUNC-b78b7b15 - Calculate the direct illuminance component on the calculation grid
  - REQ-FUNC-dafae3f1 - Diagnose wrong scale, units and orientation and missing photometry
  - REQ-FUNC-e087cb4d - Keep uniformity and glare not-evaluated without an engine report
  - REQ-FUNC-addd6a2f - Verify a scenario against a mapped photometric engine report
  - REQ-FUNC-e86a35c5 - Declare emergency and exterior lighting profiles not supported
  - REQ-FUNC-50fa2fc0 - Check luminaire catalog items against the photometry
  - REQ-REL-840d2785 - Refuse invalid lighting inputs without preparing a result
  - REQ-FUNC-98dceeb1 - Store the lighting result through a prepared change with input snapshots
  - REQ-TEST-4eb926f2 - Verify the lighting engine against analytic and hand-calculated references
  - REQ-SEC-4dfa2a5b - Offer the electrical tools only to hosts that enable them, never the change tool read-only
  - REQ-UX-d32cc9db - Describe the electrical tools in the workbench tools editor
  - REQ-DATA-06c0bd54 - Accept only a strictly valid format-1 electrical model
- deviations: 1 recorded
  - build: the engine, lighting-files and the shared schema were written before their tests ran red - the tests encode the spec's hand calculations written before the engine; costs the red-first evidence for those increments
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base b0cc097: 60 file(s) changed, 4352 line(s) added
- checks: errors=0 warnings=44 notes=38
- checklist: 9/9 done

# TASK-662ede41 - PWR-02 electrical-network: load balance, cable sizing, voltage drop and short circuit on radial LV networks (#128)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-42ce122f, REQ-FUNC-6a60acb5, REQ-FUNC-f1d93773, REQ-FUNC-bc6a2e50, REQ-FUNC-6a025b48, REQ-REL-60a7e063, REQ-FUNC-f4654788, REQ-FUNC-8b895a77, REQ-TEST-e3eb9076, REQ-SEC-4dfa2a5b, REQ-UX-d32cc9db
parent:
branch: feature/122-electrical-power
base: 696bbde311bf34ba252a46a664b158f4ead1acd3
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

Problem: VERA has no engine for low-voltage network calculations: nothing computes load balance, design currents,
cable sections, voltage drop or fault currents from the electrical model, and PWR-03 (protection) and PWR-05 (PFC)
have no currents or fault levels to build on (OBSERVED: core/src/electrical holds model, results and catalog only;
plan 00_Planning/plan/electrical-power.md lists PWR-02 planned).
Desired outcome: plugin `electrical-network` (ecosystem electrical) plus a product engine that, for a RADIAL LV
network in the model, computes P/Q/S balance per scenario with simultaneity, phase loading, design currents, cable
sizing or checking from a cited cable-table file (installation method, ambient temperature, grouping), single- and
three-phase voltage drop and min/max short-circuit currents, and writes one PWR-00 result (inputs snapshots, method
and edition actually implemented, conditions, criteria pass/fail/unknown/not-evaluated) readable by PWR-03/05; a
report shows scenarios, governing criterion, fault currents, thermal check, voltage drop and table conditions
(STATED: PWR-02 ticket, coordinator brief).
Actors: the agent in a workbench with an electrical plugin loaded; the engineer who keeps the model and cable tables
and approves result writes; later PWR helpers reading the results.
Primary scenario: the model holds a transformer source, a main board, circuits with cables (length, installation
method, ambient, grouping) and loads/motors; the agent calls the network tool with scenarios and limits; VERA
computes, prepares result.json in a new run folder (approval like a write) and returns the report; later a cable
length changes and the result lists as stale with that cable named.
Examples: a 3-phase 400 V circuit 11 kW cos phi 0.85 has Ib = 18.7 A; with ks 0.8 on its board in scenario "normal"
the board demand is 0.8 x sum; a 230 V single-phase lighting circuit uses the 2 x L voltage-drop loop; a cable
without installation method gets no section (unknown); a 630 kVA transformer behind a 500 MVA network gives
Ik3max at the LV busbar of about 22 kA (INFERRED: hand calculation, to be fixed in tests against pandapower).
Counterexamples: a source of kind generator/UPS/PV, a sub-network not fed from a source, parallel cables or a DC
network give not-evaluated/blocked, never pass; an unknown motor efficiency stays unknown, never zero.
In scope: shared result-contract use, cable-table file format 1 (shared schema + core parser), core engine
(load balance, phase loading, design current, sizing, voltage drop, IEC 60909-style impedance method for radial LV),
write tool storing the result via the prepared-change flow, a generic Markdown report view of stored results,
units for linear resistance, plugin package + skill + README + pack, tool texts en/ro/de/fr, fixtures (small cited
cable table typed from a public manufacturer datasheet, network model), pandapower cross-check script (opt-in) and
recorded reference values, spec/requirements/knowledge.
Out of scope: meshed networks, MV/HV, DC, generators/UPS/PV sources, motor contribution to faults, protection
selection, selectivity and disconnection times (PWR-03), harmonics/PFC (PWR-05), copying IEC tables, changing the
model or approved selections automatically (STATED: ticket, brief).
Constraints: format 1, no migrations; one unit table (units.ts); pandapower only as an independent test cross-check
outside the repo (brief); fixtures typed from public sources with URL, revision/read date, page/table; targeted
tests only; no commit; Windows + WSL2 evidence.
Success signals: PWR-02-A..D focused tests green on Windows and WSL2; lint, typecheck, check:i18n green.
Evidence: ticket F:\ProjectsDDP\VERA_Electrical_Automation_Plugins_Tickets\PWR-02.md; plan; PWR-00/01 hand-overs;
shared/src/electrical-model.ts; core/src/electrical/*.ts; tools/changes.ts (single-file prepared change).
Assumptions: the method implemented follows the equivalent-voltage-source principle of IEC 60909-0:2016 (c factors,
KT) without claiming conformity; the report states method, edition and simplifications (INFERRED from ticket
"edition actually implemented is shown").
Unknowns: permission to read public cable datasheet PDFs for the fixture (asked the coordinator); native Ubuntu (WSL2
only); licensed IEC 60364-5-52 tables (criteria needing them stay open).
Decision-blocking questions: none (datasheet access affects only the fixture source).
Proposed behaviors: see Design (accepted under autopilot by the coordinator brief).
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new tool, plugin, result |
| no new interface or data format | no | cable-table format 1 |
| no new dependency | yes | zod/node only; pandapower test-only outside repo |
| an existing requirement already covers the behavior | no | none for network calculations |
| no security or data-handling change | no | new workbench write of results |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| strict format-1 cable table with cited source and licence | REQ-DATA-42ce122f (spec) |
| P/Q/S per scenario, simultaneity, demand factors, phase and neutral currents | REQ-FUNC-6a60acb5 |
| design currents, single/three-phase voltage drop along the path vs limit | REQ-FUNC-f1d93773 |
| sizing/checking with method, temperature, grouping; governing criterion; no inputs -> unknown | REQ-FUNC-bc6a2e50 |
| Ik3max/ip, Ik3min, Ik1min with IEC 60909-0:2016 method and edition shown | REQ-FUNC-6a025b48 |
| unsupported topology/source/missing data never pass | REQ-REL-60a7e063 |
| result stored by approved prepared change, snapshots, model untouched, stale | REQ-FUNC-f4654788 |
| Markdown report of a stored result with freshness | REQ-FUNC-8b895a77 |
| independent references (hand calc, pandapower) with preset tolerances | REQ-TEST-e3eb9076 |
| electrical_network gated with the electrical tools, never read-only (revised) | REQ-SEC-4dfa2a5b |
| tool description en/ro/de/fr (revised) | REQ-UX-d32cc9db |

## Design

**Approach**: engine and table format are product code next to the PWR-00 model, like PWR-01 (shared zod schema
`cable-table.ts`, core `electrical/cable-table.ts` parse + confined file read, pure engine `electrical/network.ts`),
so PWR-03/05 can import the engine and read its results; one write tool `electrical_network`
(`electrical/network-tool.ts`) runs the engine and prepares ONE new result file through the existing single-file
`commitChange` flow (before = absent, approval like a write, never overwrites); a generic Markdown renderer
`electrical/report.ts` behind `electrical_model` view `report` serves every PWR result. Plugin package
`electrical-network` (ecosystem electrical, no program) brings the skill `network-sizing` and README and joins the
"Electrical power and distribution" pack. Rejected: a Python helper program (second unit table, PWR-03 could not
call it - same reason as PWR-01's design); pandapower at runtime (heavy dependency, the brief makes it a test
cross-check); a domain-specific report renderer (generic one serves PWR-03..06).
Reuse: units through `toBaseUnit`/`unitDimension` (units.ts, no new units: the table format fixes its units),
`readModelFile`, `checkResult`, `resultFreshness`, `listResults`, `commitChange`, `PathGuard`, catalog-tool's
confined directory pattern. electronics-calc is not reused: its scripts are a separate Python helper with their own
quantities and no model access.
**Interfaces and data**: spec REQ-DATA-42ce122f. `checkCableTable(raw, fileId?)`, `readCableTableFile(root, id)`;
`analyzeNetwork(model, modelSha256, table, tableStamp, request, {runId, now})` -> ElectricalResult (pure);
`renderResultReport(result, model, freshness)` -> string.
Errors: invalid table/model or request -> thrown, nothing prepared; network problems -> result status/verdicts.
**Files and test seams**: shared cable-table.ts, tools.ts (+name), index.ts; core electrical/cable-table.ts,
network.ts, network-tool.ts, report.ts, tools.ts (gate list, report view), tools/registry.ts, index.ts; tests
electrical/cable-table.test.ts, network.test.ts (hand calcs, pandapower values, opt-in recompute),
network-tool.test.ts, registry.test.ts and sessions/electrical-model.test.ts (gating); tests/support/
pandapower_network_check.py; fixtures tests/fixtures/electrical-network/ (table + model); desktop
workbench-tools.tsx + 4 locales; plugins/electrical-network/, catalog.yaml, packs.yaml; CONTRIBUTING, knowledge.
**Risks and open decisions**: fixture table values depend on the coordinator allowing public datasheet PDFs;
until then the engine tests use hand-made table data marked fictional. Licensed IEC 60364-5-52 tables are not
shipped. WSL is not native Ubuntu.
**Requirement map**: 42ce122f -> cable-table.ts; 6a60acb5, f1d93773, bc6a2e50, 6a025b48, REL-60a7e063 ->
network.ts; f4654788 -> network-tool.ts; 8b895a77 -> report.ts + tools.ts; TEST-e3eb9076 -> network.test.ts +
support script; SEC-4dfa2a5b -> electricalToolNames; UX-d32cc9db -> locales.


## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-15 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-15 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-15 build: red: npmw npx vitest run core electrical/network-tool.test.ts exit 1 - 6 failed, electrical_network tool and report view missing (REQ-FUNC-f4654788, REQ-FUNC-8b895a77, REQ-DATA-42ce122f)
- 2026-11-15 build: DEVIATION build: engine network.ts and cable-table.ts written before network.test.ts, which passed on its first run (22 tests) - accepted: its oracles are independent (hand calculations written out, pandapower 3.1.2 values), so a green first run still compares against references the code did not produce
- 2026-11-15 build: green: npmw npx vitest run core electrical/, tools/registry, sessions/electrical-model, plugins/catalog-source+catalog, desktop plugin-packs, workbench-tools, main/sessions exit 0 (15 files, 155 passed, 2 skipped: pandapower opt-in, Linux-only symlink); opt-in VERA_PANDAPOWER_PYTHON (pandapower 3.1.2, pandas 2.2.3, scratch uv env) exit 0; npm run typecheck, lint (no errors), check:i18n exit 0 (all 11 requirements)
- 2026-11-15 build: green (Linux WSL2 Ubuntu-24.04, ~/vera-pwr refreshed to 696bbde + 50 changed files): npmw npx vitest run core electrical/, tools/registry, sessions/electrical-model, plugins/catalog-source+catalog exit 0 (12 files, 138 passed, 1 skipped pandapower opt-in) (REQ-TEST-e3eb9076, REQ-FUNC-f4654788)
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: review round 1: spec changes_required (given section passes with capacity inputs missing; unknown drop/reactance gives fail; unreached parts leave completed; inputs cut at 1000 silently; source uri/pages optional; assumedReactance not in spec/skill; Un=UrLV and unbalanced-drop simplifications not stated; table conditions per cable not in the report; untested: status in parallel/IT cases, supply Ik3min/ip) and quality changes_required (unknown->fail in cable-section; cableTable condition text can exceed 200 and scenario titles accept control characters; Ik1/min-fault unknown leaves completed; efficiency/demand factor/uk not range-checked; unknown scenario keys silent; spec drift assumedReactance; inputs/messages truncation silent, resultBytes unchecked; circuit without children Ib 0)
- 2026-11-15 validate: returned to build - review round 1 findings
- 2026-11-15 build: green round 1 fixes: Windows npmw vitest 15 files 163 passed 2 skipped exit 0; opt-in VERA_PANDAPOWER_PYTHON exit 0; typecheck, lint (0 errors), check:i18n exit 0; WSL2 npmw vitest 12 files 146 passed 1 skipped exit 0 (REQ-REL-60a7e063, REQ-FUNC-bc6a2e50, REQ-FUNC-6a025b48, REQ-DATA-42ce122f, REQ-FUNC-f4654788, REQ-FUNC-8b895a77)
- 2026-11-15 build: datasheet PDFs allowed by the coordinator (read-only in the built-in browser): Bayka TD04EN answered with a file download (save dialog shown, nothing saved, not retried), Eupen Ed 05 2022 link 404; fixture stays on the cited Nexans NYM-J HTML page, manufacturer correction factors remain open
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: review round 2: spec approved, quality approved; accepted limits (non-blocking): earth-fault note says 'shortCircuitCurrentMin unknown' for a supply with Ze but no minimum level while Ik1 values exist (conservative: status incomplete, short-circuit-minimum names the cause); assumptions beyond 200 are cut without their own message (intermediate cap is reached first); no dedicated tests for the >1000 inputs, 200-message cap, 4 MiB refusal and feeds-nothing paths (inspected by review)
- 2026-11-15 validate: final: python .agentic/aegis.py check --task TASK-662ede41 --strict --run exit 0 (strict ok; lint, typecheck, i18n ok; tests not in [check] run); focused vitest proof from build round 1: Windows 15 files 163 passed + 2 skipped (pandapower opt-in, Linux-only symlink), opt-in pandapower 3.1.2 exit 0, WSL2 12 files 146 passed + 1 skipped. Remaining warnings: uncovered-source for test and fixture files (linked tests and data, not behavior); others belong to other tasks' records. DEVIATION validate: Linux evidence is WSL2, not native Ubuntu - accepted per the coordinator brief
- 2026-11-15 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-662ede41.md
changed: cable-table format 1, radial LV network engine, electrical_network tool, report view, electrical-network plugin, fixtures, spec, knowledge
evidence: check --task TASK-662ede41 --strict --run exit 0; vitest Windows 163 passed/2 skipped; WSL2 146 passed/1 skipped; opt-in pandapower 3.1.2 exit 0
issues: native Ubuntu not run (WSL2 only); manufacturer temperature/grouping factors and licensed IEC 60364-5-52 tables not in fixtures (Nexans page gives none; Bayka PDF download-only, Eupen 404); earth-fault note wording for supply with Ze but no minimum level; assumptions over 200 cut without own message; no dedicated tests for result-size/input/message caps
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-15)

- stage: validate; type: feature; path: full; branch: feature/122-electrical-power
- requirements:
  - REQ-DATA-42ce122f - Accept only a strictly valid format-1 cable table
  - REQ-FUNC-6a60acb5 - Balance P, Q and S per scenario with simultaneity and phase loading
  - REQ-FUNC-f1d93773 - Compute design currents and single- and three-phase voltage drop along the radial path
  - REQ-FUNC-bc6a2e50 - Size or check cables from the cable table with installation method, temperature and grouping
  - REQ-FUNC-6a025b48 - Compute maximum and minimum short-circuit currents on radial LV networks with the implemented method shown
  - REQ-REL-60a7e063 - Report unsupported topologies, sources and missing data as not evaluated or unknown, never pass
  - REQ-FUNC-f4654788 - Store network results as PWR-00 results through an approved prepared change without changing the model
  - REQ-FUNC-8b895a77 - Render a stored electrical result as a report with its freshness
  - REQ-TEST-e3eb9076 - Network calculations agree with independent references within preset tolerances
  - REQ-SEC-4dfa2a5b - Offer the electrical tools only to hosts that enable them, never the change tool read-only
  - REQ-UX-d32cc9db - Describe the electrical tools in the workbench tools editor
- deviations: 2 recorded
  - build: engine network.ts and cable-table.ts written before network.test.ts, which passed on its first run (22 tests) - accepted: its oracles are independent (hand calculations written out, pandapower 3.1.2 values), so a green first run still compares against references the code did not produce
  - validate: Linux evidence is WSL2, not native Ubuntu - accepted per the coordinator brief
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 696bbde: 51 file(s) changed, 4219 line(s) added
- checks: errors=0 warnings=36 notes=39
- checklist: 9/9 done

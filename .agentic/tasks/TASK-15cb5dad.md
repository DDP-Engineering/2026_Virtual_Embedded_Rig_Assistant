# TASK-15cb5dad - PWR-01 industrial-catalog: catalog item format and documented selection (#127)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-d7e27def, REQ-DATA-b3d86b99, REQ-FUNC-742db7ea, REQ-DATA-fd465e9f, REQ-FUNC-b2ae3ed9, REQ-FUNC-ca8c6870, REQ-SEC-07040413, REQ-REL-003c3adc, REQ-REL-6546e9a4, REQ-TEST-647c2266, REQ-SEC-4dfa2a5b, REQ-UX-d32cc9db
parent:
branch: feature/122-electrical-power
base: 543892e7bc4b14b55f1e6ee18d7c5426a8bffe1f
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

Problem: VERA has no format for industrial equipment data (LV switchgear, contactors, protection) and no
selection that applies firm requirements under conditions; PWR-03..06 need one to cite (OBSERVED: no catalog
code under core/src/electrical; results carry only `catalog: {id, version} | null`, RULING-004 of TASK-bdafefcf).
Desired outcome: a format-1 industrial catalog file (manufacturer, order code, variant, accessories apart from
distributor SKUs; parameters with conditions, units, source revision and page/table) and a read tool that lists
catalogs, finds items, selects by firm requirements (eliminations explained, absent values unknown) and looks up
coordination tables only for the exact products and conditions they state; plugin `industrial-catalog`
(ecosystem electrical) with a selection skill (STATED: PWR-01 ticket, coordinator brief).
Actors: the agent in a workbench with an electrical/automation plugin loaded; the engineer who writes or
imports catalog files and approves model changes; later PWR helpers that cite `catalog: {id, version}`.
Primary scenario: the engineer places `electrical-automation-catalogs/<id>.json`; the agent calls
`industrial_catalog` view select with requirements (Ie >= 9 A at AC-3 400 V, coil 230 V); VERA returns each item
eligible/unknown/eliminated with reasons, evidence (source title, revision, URL, page/table, conditions) and the
catalog id/version/sha256; the agent proposes, the engineer applies any model change through
`electrical_model_change`.
Examples: LC1D09P7 (9 A AC-3 <= 440 V, 230 V AC coil) passes Ie >= 9 A at 400 V AC-3; LC1D09B7 (24 V AC coil)
is eliminated by a 230 V coil requirement; an absent parameter (e.g. Icu on a contactor) is unknown; the LC1D09
type-2 fuse entry (20 A gG at <= 690 V) does not answer a question about LC1D12 or about 1000 V. RS stock no.
394-9790 is a distributor SKU of LC1D09P7, not its order code (OBSERVED: se.com UK and uk.rs-online.com pages,
2026-11-15).
Counterexamples: a cheaper item or a similar name is never "equivalent"; a distributor's parameter text
(RS lists "4 kW 230V ac" for LC1D09P7, the manufacturer gives 4 kW at 380/400 V) is not evidence.
In scope: shared schema, core validation/selection/coordination, tool `industrial_catalog` gated with the
electrical tools, unit scales and known properties in units.ts, plugin package + skill + README, fixture of two
real Schneider Electric families (TeSys Deca LC1D contactors, TeSys GV2ME motor circuit breakers) with the
LADN11 accessory, tool texts en/ro/de/fr, spec/requirements/knowledge.
Out of scope: scraping, live supplier calls from the catalog tool (parts_search stays the live path), orders,
automatic replacement in schematics or the model, copying whole vendor catalogs or IEC tables (STATED: brief);
PDF extraction tooling (values are typed and marked confirmed/extracted); a dedicated catalog write tool
(catalog files are written with the ordinary approved write) (INFERRED: golden path).
Constraints: format 1, no migrations; one unit table (units.ts); no second catalog/credential store
(parts-search stores no supplier results and keeps keys in the credential store - OBSERVED README); results
reference `catalog: {id, version}` (RULING-004); targeted tests only; no commit.
Success signals: PWR-01-A..D focused tests green on Windows and WSL; lint, typecheck, check:i18n green.
Evidence: ticket F:\ProjectsDDP\VERA_Electrical_Automation_Plugins_Tickets\PWR-01.md; PWR-00 hand-over;
shared/src/electrical-model.ts; core/src/electrical/*.ts; plugins/parts-search.
Assumptions: product web pages (se.com UK, no document revision shown) are acceptable public sources when cited
with URL, table name and capture date as revision (INFERRED from "reading public web pages is fine").
Unknowns: native Ubuntu run (WSL only); licensed manufacturer coordination tables (GV2+LC1D type 2) not used.
Decision-blocking questions: none.
Proposed behaviors: see Design (accepted under autopilot by the coordinator's brief).
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new tool and plugin |
| no new interface or data format | no | catalog format 1 |
| no new dependency | yes | zod/node only |
| an existing requirement already covers the behavior | no | none for catalogs |
| no security or data-handling change | no | file reading, URIs with secrets refused |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| strict format-1 catalog, units, refs, licence per source | REQ-DATA-d7e27def (spec) |
| order code / variant / accessories / distributor SKU apart | REQ-DATA-b3d86b99 |
| firm requirement elimination with reason | REQ-FUNC-742db7ea |
| absent / extracted / off-condition value is unknown | REQ-DATA-fd465e9f |
| catalog id/version/sha256 and value sources in each selection | REQ-FUNC-b2ae3ed9 |
| coordination only for exact products and conditions | REQ-FUNC-ca8c6870 |
| links with credentials refused; no credential store or network | REQ-SEC-07040413 |
| broken catalog listed, others usable; select refused | REQ-REL-003c3adc |
| reproducible selection and order | REQ-REL-6546e9a4 |
| two real cited families fixture | REQ-TEST-647c2266 |
| tool gated with electrical tools (revised) | REQ-SEC-4dfa2a5b |
| tool description en/ro/de/fr (revised) | REQ-UX-d32cc9db |

## Design

**Approach**: the format and the pure engine live in product code next to the PWR-00 model (shared zod
schema, core `electrical/catalog.ts`), exposed as one read tool `industrial_catalog` in
`electrical/catalog-tool.ts`, gated with the electrical tools. The plugin package `industrial-catalog`
(ecosystem electrical, no program) brings the skill and README. Rejected: a Python helper in the plugin -
it would need a second unit table (plan: one unit engine) and later PWR engines in core could not call it.
Reuse choice: parts-search keeps the live supplier search (`parts_search`) and the supplier keys in the
credential store; it stores no supplier result, so there is no store to extend. The catalog holds
manufacturer data and distributor SKUs with capture times only, never credentials or live offers.
**Interfaces and data**: spec REQ-DATA-d7e27def. `checkCatalog(raw, fileId?)` -> {catalog} | {problems};
`selectItems(catalog, sha256, path, request)`; `findItems`; `coordinationFor`. Units: `unitScale` and
known properties added to units.ts. Errors: tool argument errors throw (zod); an invalid catalog throws
`Invalid industrial catalog:` lines on select/items/coordination and is listed with `valid: false`.
**Files and test seams**: shared/src/industrial-catalog.ts (+index export); core/src/electrical/units.ts,
catalog.ts, catalog-tool.ts, catalog.test.ts, catalog-tool.test.ts; tools/registry.ts, shared/src/tools.ts,
electrical/tools.ts (gate list), sessions/electrical-model.test.ts (gating), desktop workbench-tools.tsx +
4 locales; tests/fixtures/industrial-catalog/cat-schneider-tesys.json; plugins/industrial-catalog/,
plugins/catalog.yaml (official list, metadata) and plugins/packs.yaml (new pack "Electrical power and
distribution", so the plugin is offered on the Plugins page).
**Risks and open decisions**: licensed coordination tables stay out (fixture uses per-product fuse
coordination); WSL is not native Ubuntu.
**Requirement map**: d7e27def -> checkCatalog; b3d86b99 -> findItems match + accessories by reference;
742db7ea, fd465e9f, 6546e9a4 -> selectItems; b2ae3ed9 -> evidence + catalog stamp; ca8c6870 ->
coordinationFor; SEC-07040413 -> uri check + files only; REL-003c3adc -> catalog-tool list/select;
TEST-647c2266 -> fixture; SEC-4dfa2a5b -> electricalToolNames; UX-d32cc9db -> locales.

## Log

- 2026-11-15 frame: journal opened
- 2026-11-15 frame: completed; next specify - scope recorded under autopilot (7 Done checklist item(s) left unticked)
- 2026-11-15 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-15 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-15 build: red: npmw npx vitest run core electrical/catalog.test.ts catalog-tool.test.ts sessions/electrical-model.test.ts exit 1 - catalog module, industrial_catalog tool and its gating missing (REQ-DATA-d7e27def, REQ-DATA-b3d86b99, REQ-FUNC-742db7ea, REQ-DATA-fd465e9f, REQ-FUNC-b2ae3ed9, REQ-FUNC-ca8c6870, REQ-SEC-07040413, REQ-REL-003c3adc, REQ-REL-6546e9a4, REQ-TEST-647c2266, REQ-SEC-4dfa2a5b)
- 2026-11-15 build: green: npmw npx vitest run core electrical/, sessions/electrical-model, tools/registry, plugins/catalog-source+catalog, desktop workbench-tools, plugin-packs, main/sessions exit 0 (12 files, 109 tests); npm run typecheck exit 0; npm run lint exit 0; npm run check:i18n exit 0 (all 12 requirements)
- 2026-11-15 build: green (Linux WSL2 Ubuntu-24.04, ~/vera-pwr refreshed with 38 changed files): npmw npx vitest run core electrical/, sessions/electrical-model, tools/registry, plugins/catalog-source exit 0 (8 files, 78 tests) (REQ-REL-6546e9a4)
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: review round 1: spec approved (text fixes: coordination example needs circuit, ca8c6870 verification wording, commercial text/extra output keys; tests for value null, schema-invalid/oversize file; packs.yaml electrical pack unlisted in Design); quality changes_required (credential link pattern too narrow incl. fragments; conditionProperty skips settingCurrentMin-style keys; no tests for conservative-value rule, Min/Max edges, °C conditions, text-vs-number, symlink confinement; coordination silent on requested conditions a table does not name; PathGuard per file)
- 2026-11-15 validate: returned to build - review round 1 findings
- 2026-11-15 build: green round 1 fixes: Windows npmw vitest 12 files 119 passed 1 skipped (Linux-only symlink) exit 0; lint, typecheck, check:i18n exit 0; WSL2 npmw vitest 8 files 89 passed exit 0 incl. symlink confinement (REQ-SEC-07040413, REQ-FUNC-742db7ea, REQ-DATA-fd465e9f, REQ-FUNC-ca8c6870, REQ-REL-003c3adc)
- 2026-11-15 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-15 validate: inspection REQ-TEST-647c2266: values extracted 2026-11-15 in the built-in browser from the characteristicTables (Main/Complementary/Environment) embedded in each se.com UK product page (LC1D09P7, LC1D09B7, LC1D12P7, LC1D18P7, GV2ME08, GV2ME10, GV2ME14, LADN11) and the RS UK pages for 394-9790 and 395-0239; the fixture was generated from those rows (8 items, 99 item parameters, 8 coordination entries) and catalog.test.ts asserts every value cites a se.com URL, table, capture date and licence. GV2 motor-power rows were left out (the page lists two values per voltage).
- 2026-11-15 validate: review round 2 quality approved; accepted limits: the link check fails closed on names that contain key/sig/sid (a #key-features anchor or ?design= query is refused - the author edits the link), and secrets inside a URL path are not detected (not required by REQ-SEC-07040413)
- 2026-11-15 validate: final: python .agentic/aegis.py check --task TASK-15cb5dad --strict --run exit 0 (strict ok; lint, typecheck, i18n ok); focused vitest proof from build round 1: Windows 12 files 119 passed + 1 Linux-only skip, WSL2 8 files 89 passed. Remaining warnings: uncovered-source for test files (linked tests, not behavior); others belong to other tasks' records. DEVIATION validate: Linux evidence is WSL2, not native Ubuntu - accepted per the coordinator brief
- 2026-11-15 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-15cb5dad.md
changed: industrial catalog format, engine, tool, plugin, fixture, docs
evidence: check --task TASK-15cb5dad --strict --run exit 0; vitest Windows 119 passed/1 skipped, WSL2 89 passed
issues: native Ubuntu not run (WSL2 only); licensed manufacturer coordination tables (GV2+LC1D type 2) not in fixture; link check fails closed on key/sig/sid-like names
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-15)

- stage: validate; type: feature; path: full; branch: feature/122-electrical-power
- requirements:
  - REQ-DATA-d7e27def - Accept only a strictly valid format-1 industrial catalog
  - REQ-DATA-b3d86b99 - Keep order code, variant, accessories and distributor SKUs apart
  - REQ-FUNC-742db7ea - Eliminate catalog items that fail a firm requirement with the reason
  - REQ-DATA-fd465e9f - Mark an absent, unconfirmed or off-condition catalog value unknown
  - REQ-FUNC-b2ae3ed9 - Carry the catalog revision and value sources in each selection
  - REQ-FUNC-ca8c6870 - Apply a coordination table only to its exact products and conditions
  - REQ-SEC-07040413 - Refuse catalog source links that carry credentials
  - REQ-REL-003c3adc - List unreadable or invalid catalogs without stopping the others
  - REQ-REL-6546e9a4 - Return the same selection for the same catalog and request
  - REQ-TEST-647c2266 - Two real Schneider Electric families typed from cited public pages
  - REQ-SEC-4dfa2a5b - Offer the electrical tools only to hosts that enable them, never the change tool read-only
  - REQ-UX-d32cc9db - Describe the electrical tools in the workbench tools editor
- deviations: 1 recorded
  - validate: Linux evidence is WSL2, not native Ubuntu - accepted per the coordinator brief
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 543892e: 44 file(s) changed, 4892 line(s) added
- checks: errors=0 warnings=30 notes=38
- checklist: 8/9 done; open: `report` appended

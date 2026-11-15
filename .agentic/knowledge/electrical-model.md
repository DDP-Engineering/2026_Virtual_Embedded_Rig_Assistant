# Electrical project model

## Routing

Select for the electrical project model, `electrical-automation-model.json`, `electrical-automation-results/`,
`electrical_model`, `electrical_model_change`, quantities with units and basis, entity IDs versus visible
references (M1, QF1), relation rules, result freshness/stale results, explicit-mapping imports and the
`electricalModel` host flag, and the industrial catalog: `electrical-automation-catalogs/<id>.json`, the
`industrial_catalog` tool, order codes versus distributor SKUs, firm-requirement selection and coordination
lookups (spec .agentic/specs/REQ-DATA-d7e27def.md, core electrical/catalog.ts and catalog-tool.ts), and the
radial LV network engine: `electrical_network`, cable tables `electrical-automation-tables/<id>.json`, load
balance, cable sizing, voltage drop, fault currents and the `electrical_model` report view (spec
.agentic/specs/REQ-DATA-42ce122f.md, core electrical/network.ts, network-tool.ts, cable-table.ts, report.ts), and the
LV protection engine: `protection_coordination`, breaking capacity Icu/Ics/Icn, overload, disconnection bands,
let-through energy, RCD, selectivity/cascading/starter tables (spec .agentic/specs/REQ-DATA-a5673202.md, core
electrical/protection.ts, protection-tool.ts, result-change.ts). Start at 05_Software/src/libraries/core/src/electrical/ (model.ts, tools.ts) and
shared/src/electrical-model.ts, with spec .agentic/specs/REQ-DATA-06c0bd54.md. Tests: core/src/electrical/*.test.ts,
core/src/sessions/electrical-model.test.ts, desktop main/sessions.test.ts. The write flow itself
(commitChange, WriteQueue) belongs to [file tools](file-tools.md); plugin packages and their helpers belong to
[plugins](plugins.md) and [official plugins](official-plugins.md).

## Purpose and boundaries

First-party foundation of the electrical and automation plugins (PWR, CAD, PLC, IND): one project model per
workbench, the industrial catalog files and their selection, its units, its relation graph, provenance and the result contract, the radial LV network engine with its cable tables, and the LV protection engine. The
workbench owns the model file; VERA reads it strictly and writes it only through `electrical_model_change`, a
prepared change on the shared write flow. Plugin helpers read the model and write results into their own run
folders; VERA derives result freshness from the results' input snapshots and stores no second copy.

## Public interface

- Shared (`electrical-model.ts`): zod schemas `electricalModelSchema` (kind `vera-electrical-model`, format 1) and
  `electricalResultSchema` (kind `vera-electrical-result`, format 1), the fixed paths `electricalModelPath`,
  `electricalResultsDir`, `electricalResultFile`, the object/relation/basis/status/verdict lists,
  `electricalIdPrefixes` and `electricalLimits`.
- Core pure services: `checkModel`/`parseModel` (problems `{path, message}`, at most 20, thrown as
  `Invalid <label>:` lines), `serializeModel` (canonical bytes), `canonicalJson`/`entityHash`, `modelEntities`,
  `modelIssues` (`unfed`, `unprotected`), `relationRules`; `unitDimensions`, `knownProperties`, `unitProblem`;
  `applyOperations` with `electricalOperationSchema`; `checkResult`, `resultFreshness`.
- Access port: `readModelFile(root)` and `listResults(root, model)`, both confined to the workbench with
  PathGuard (8 MiB model, 4 MiB result, 100 newest run folders).
- Tool `electrical_model` (read) {view summary|objects|relations|results, type?, ids? <=100, offset?}: summary
  {exists, path, sha256, project, sources, objects, counts, relations, issues <=100}; objects <=100 per page with
  each object's `sha256`; relations <=200 per page touching `ids`; results with freshness current/stale (changed,
  removed) or invalid (problem). A missing model gives `{exists: false}`.
- Tool `electrical_model_change` (write) {operations 1..200: set-project, add-source, remove-source, add-object,
  update-object, remove-object, add-relation, remove-relation, import {path, mapping}}: the whole new model is
  validated, serialized canonically and prepared as a FileChangeRequest (tool `electrical_model_change`, path,
  before/after SHA-256, diff cut to 2000 lines); applying is `commitChange`. Result {path, sha256, bytes, ids}.
- Industrial catalog (spec REQ-DATA-d7e27def): shared `industrialCatalogSchema` (kind `vera-industrial-catalog`,
  format 1), `industrialCatalogDir` (`electrical-automation-catalogs`), `industrialCatalogLimits`,
  `catalogRequirementSchema`. Core pure services `checkCatalog`/`parseCatalog` (file id must equal catalog id,
  units, unique IDs and (manufacturer, orderCode), references, licence per source, `linkProblem`), `findItems`
  (match `order-code` or `distributor-sku`), `selectItems` (eligible/unknown/eliminated, reasons absent,
  conditions, unconfirmed; cited evidence; stamp {id, version, sha256, path}), `coordinationFor`
  (applicable with `unevaluated` request conditions; notApplicable with other-products, conditions,
  missing-condition); `toBaseUnit` in units.ts.
  Access: `readCatalogFile(root, id)`, `listCatalogs(root)` (<=50 files, 4 MiB each, PathGuard).
- Tool `industrial_catalog` (read) {view list|items|select|coordination, catalog?, orderCode?|sku?, family?,
  category?, offset?, requirements? <=32, items? <=4, conditions?}: list gives each file valid or invalid with its
  problem; items <=50 per page; select and coordination return the catalog stamp. Files only: no network, no
  credential store.
- Network engine (spec REQ-DATA-42ce122f): shared `cableTableSchema` (kind `vera-cable-table`, format 1, fixed
  units mm², A, °C, Ω/km), `cableTableDir` (`electrical-automation-tables`); core `checkCableTable`/
  `parseCableTable`, `readCableTableFile(root, id)` -> {table, stamp}, `temperatureFactor`/`groupingFactor`/
  `tableRating` (next tabulated point, never interpolated); pure `analyzeNetwork({model, table, request, runId,
  now, ...})` -> ElectricalResult with `networkRequestSchema` {cableTable, source?, voltageTolerance 6|10,
  scenarios 1..8 {id, title, simultaneity?, loads?}, voltageDropLimit, voltageDropLimitLighting?, faultDuration?,
  assumedReactance?}; stable intermediate names (`designCurrent`, `ik3MaxStart`, `ik3MinEnd`, `ik1MinEnd`,
  `crossSection`, `currentCapacity`, `activePower:<s>`, `ik3Max`, ...) and criteria `current-capacity`,
  `voltage-drop`, `short-circuit-withstand`, `cable-section`, `short-circuit`.
- Tool `electrical_network` (write): runs the engine and prepares one new
  `electrical-automation-results/<run-id>/result.json` (run ID `YYYYMMDD-HHMMSS-<4 hex>`, before = absent) through
  `commitChange`; apply returns {path, runId, sha256, bytes, status, criteria counts, report}. `electrical_model`
  view `report` {runId} returns {runId, freshness, changed?, removed?, report} from `renderResultReport`, for any
  plugin's result (64 KiB at most).
- Protection engine (spec REQ-DATA-a5673202): pure `analyzeProtection({model, network, catalog, catalogStamp, cable
  {k, text}, request, runId, now})` -> ElectricalResult with `protectionRequestSchema` {network run ID, catalog,
  breakingCapacity Icu|Ics|Icn, assumedInstantaneousTripTime? (s), circuits 1..16 {circuit, protection?, candidates
  1..8 (16 in all), setting? (A), disconnectionTime? (s), rcd?, residualCurrentMax? (mA)}, coordination? <=16 {kind
  selectivity|cascading, upstream, upstreamItem, downstream, downstreamItem}, starters? <=16 {circuit, protection,
  contactor, type 1|2}}; criteria `<name>:<orderCode>` (`device-kind`, `rated-voltage`, `poles`,
  `breaking-capacity`, `rated-current`, `conventional-tripping`, `disconnection-time`, `let-through-energy`,
  `selection`), `rcd-type`, `rcd-sensitivity`, `selectivity|cascading:<up>/<down>`, `starter-type-<n>:<p>/<c>`.
  Catalog values go through `selectItems` on a one-item catalog (coverage, conservative value, unconfirmed rules);
  band points through `findItems`; tables through `coordinationFor`.
- Tool `protection_coordination` (write): reads the model, the named network result (`readResultFile`; refuses a
  missing, invalid, foreign or stale one), the catalog and the cable table the network result names (k only when its
  sha256 prefix still matches) and prepares one new result through `prepareResultChange` (`result-change.ts`, shared
  with `electrical_network`: `newRun()`, checked result, one new file, report). The result copies the network
  result's inputs, so it goes stale with them.
- `SessionHost.electricalModel` offers the five tools (`industrial_catalog`, `electrical_network` and `protection_coordination` included); `electricalModelPlugin(plugin)` is true for manifest ecosystem
  `electrical` or `automation`, and the desktop sets the flag while such a plugin is loaded. The headless CLI does
  not set it.

## Invariants

- Strict format 1 with no defaults, repairs or migrations: an unknown key, another kind or format, a missing
  `value` key, an unknown unit or a unit of another dimension on a known property makes the document invalid and
  nothing is read or written (REQ-DATA-06c0bd54, REQ-DATA-9d50631c).
- `value: null` is unknown and stays null; it is never read as zero (REQ-DATA-006f36b5).
- One ID namespace (project, sources, objects, relations); a visible `ref` is unique and never equals an ID;
  relations name object IDs only (REQ-DATA-183b71d2, REQ-DATA-05117b78).
- Relation endpoint types and cardinalities follow `relationRules`; no self-relation, no repeated relation, no
  feeds cycle (REQ-DATA-b75d05b0). Missing feeds or protection are issues, never refusals.
- A valid canonical file round-trips byte for byte (REQ-FUNC-11cf80d0).
- A result is stale exactly when an input snapshot's canonical hash differs from the current entity or the entity
  is gone; an invalid result is never listed as current (REQ-FUNC-7f4b0a41, REQ-DATA-8b66f751).
- The model is written only inside the write queue with the before-hash recheck: a file changed after preparation
  is a conflict and stays as it is; read-only sessions never get the change tool (REQ-REL-cc710d50,
  REQ-SEC-4dfa2a5b).
- An industrial catalog is read strictly like the model: an invalid file is listed invalid and never selected
  from; the others stay usable (REQ-DATA-d7e27def, REQ-REL-003c3adc). Links with user information or a
  credential-like query or fragment parameter make it invalid (REQ-SEC-07040413).
- A selection decides only on confirmed values whose conditions cover the requested conditions (`xMin`/`xMax`
  bounds, unit-scaled); the most conservative value counts; absent, off-condition or extracted values are unknown,
  never pass or zero; order is eligible, unknown, eliminated, then order code - never price or name
  (REQ-FUNC-742db7ea, REQ-DATA-fd465e9f, REQ-REL-6546e9a4). Accessories are separate items, never evaluated for the
  item that lists them; a distributor SKU never matches an order code (REQ-DATA-b3d86b99).
- A coordination entry applies only to exactly its item set and only when the request names and satisfies every
  table condition (REQ-FUNC-ca8c6870).
- The network engine evaluates only a radial three-phase AC LV network (50..1000 V) from one transformer or
  supply point; a tie between busbars, another phase count, DC or an unknown voltage blocks the run; another
  source kind, TT/IT earth faults, a circuit with no or parallel cables are not evaluated; an absent or null input
  makes the value null and its criteria unknown (`cable-section` fails only when every table cross-section was
  evaluated and none fits; `earth-fault`, `short-circuit-minimum` and `network-coverage` criteria keep such runs
  incomplete); a cross-section is proposed only with installation method,
  ambient temperature and grouping covered by the table (REQ-REL-60a7e063, REQ-FUNC-bc6a2e50).
- Fault currents follow the equivalent voltage source with cmax 1.05/1.10, cmin 0.95, feeder cQ 1.1/1.0 and KT
  for max and min, as pandapower 3.1.2 does; results state the method, edition and simplifications
  (REQ-FUNC-6a025b48). `electrical_network` writes only a new result file, never the model (REQ-FUNC-f4654788).
- The protection engine reads only the capacity kind the request names (Icu `ultimateBreakingCapacity`, Ics
  `serviceBreakingCapacity` or ratio x Icu at the same conditions, Icn / fuse `ratedBreakingCapacity`) at the
  circuit voltage; the generic `breakingCapacity` is never read. Disconnection passes only when Ik1min reaches a
  cited band point at or below the required time (or the instantaneous band's upper edge with a cited or assumed
  operating time), fails only below a point at exactly that time, and is unknown otherwise; selectivity, cascading
  and starter coordination come only from an applicable table for the exact items (selectivity and cascading entries
  only in the order [upstream, downstream], the upstream circuit feeding the downstream one), an unevaluated requested
  condition is unknown, no table is not-evaluated; nothing is derived from curves (REQ-FUNC-b65fb9ee,
  REQ-FUNC-b9c2bc7d, REQ-FUNC-894dce2a, REQ-REL-8f88c502). `protection_coordination` refuses a stale network result
  and writes only a new result file (REQ-REL-62b1aee8, REQ-FUNC-4dcdce2d).
- An import merges only through a mapping naming every imported ID as new or an existing entity of the same kind
  and type; anything else refuses the whole change (REQ-FUNC-784f108f).

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Model fields, limits, result fields | shared electrical-model.ts, spec | electrical/model.test.ts, results.test.ts |
| Units or known properties | electrical/units.ts | electrical/model.test.ts (units) |
| Relation types or cardinalities | `relationRules` in model.ts | electrical/model.test.ts (relation rules) |
| Operations or import mapping | electrical/edit.ts | electrical/tools.test.ts |
| Views, freshness listing, write preparation | electrical/tools.ts, results.ts | electrical/tools.test.ts |
| Catalog format, selection, coordination | shared industrial-catalog.ts, electrical/catalog.ts, spec REQ-DATA-d7e27def | electrical/catalog.test.ts |
| Catalog files and the industrial_catalog tool | electrical/catalog-tool.ts | electrical/catalog-tool.test.ts |
| Network engine, request, result names | electrical/network.ts, spec REQ-DATA-42ce122f | electrical/network.test.ts |
| Cable table format and lookups | shared cable-table.ts, electrical/cable-table.ts | electrical/cable-table.test.ts |
| Network tool, report view | electrical/network-tool.ts, report.ts, tools.ts | electrical/network-tool.test.ts |
| Protection engine, request, criteria | electrical/protection.ts, spec REQ-DATA-a5673202 | electrical/protection.test.ts |
| Protection tool, shared result write | electrical/protection-tool.ts, result-change.ts | electrical/protection-tool.test.ts, network-tool.test.ts |
| Offering the tools | sessions/service.ts filter, desktop main/sessions.ts | sessions/electrical-model.test.ts, desktop main/sessions.test.ts |

## Key behaviors

- REQ-DATA-06c0bd54 — accept only a strictly valid format-1 electrical model.
- REQ-DATA-183b71d2 — refuse duplicate IDs and references that repeat or equal an ID.
- REQ-DATA-05117b78 — refuse relations and citations to missing entities.
- REQ-DATA-b75d05b0 — refuse relations that break endpoint types, cardinalities or a radial feed.
- REQ-DATA-006f36b5 — keep an unknown quantity unknown and never zero.
- REQ-DATA-9d50631c — refuse unknown units and units of another dimension.
- REQ-FUNC-11cf80d0 — write the model in one canonical form that round-trips.
- REQ-DATA-8b66f751 — accept only strictly valid format-1 results.
- REQ-FUNC-7f4b0a41 — mark exactly the results whose inputs changed as stale.
- REQ-FUNC-4437aa41 — read the model through finite views.
- REQ-FUNC-46374a53 — change the model through an approved prepared change.
- REQ-REL-cc710d50 — refuse a change when the file changed after preparation.
- REQ-SEC-4dfa2a5b — offer the tools only to hosts that enable them; never the change tool in read-only.
- REQ-FUNC-784f108f — import an exchange file only through an explicit mapping.
- REQ-TEST-033d495e — two-pump panel fixture.
- REQ-DATA-d7e27def — accept only a strictly valid format-1 industrial catalog.
- REQ-DATA-b3d86b99 — keep order code, variant, accessories and distributor SKUs apart.
- REQ-FUNC-742db7ea — eliminate catalog items that fail a firm requirement with the reason.
- REQ-DATA-fd465e9f — mark an absent, unconfirmed or off-condition catalog value unknown.
- REQ-FUNC-b2ae3ed9 — carry the catalog revision and value sources in each selection.
- REQ-FUNC-ca8c6870 — apply a coordination table only to its exact products and conditions.
- REQ-SEC-07040413 — refuse catalog links that carry credentials; files only.
- REQ-REL-003c3adc — list unreadable or invalid catalogs without stopping the others.
- REQ-REL-6546e9a4 — return the same selection for the same catalog and request.
- REQ-TEST-647c2266 — two real Schneider Electric families typed from cited public pages.
- REQ-DATA-42ce122f — accept only a strictly valid format-1 cable table.
- REQ-FUNC-6a60acb5 — balance P, Q and S per scenario with simultaneity and phase loading.
- REQ-FUNC-f1d93773 — design currents and single- and three-phase voltage drop along the path.
- REQ-FUNC-bc6a2e50 — size or check cables with installation method, temperature and grouping.
- REQ-FUNC-6a025b48 — maximum and minimum fault currents with the implemented method shown.
- REQ-REL-60a7e063 — unsupported networks and missing data never pass.
- REQ-FUNC-f4654788 — store network results through an approved prepared change, model unchanged.
- REQ-FUNC-8b895a77 — render a stored result as a report with its freshness.
- REQ-TEST-e3eb9076 — independent references (hand calculations, pandapower 3.1.2) with preset tolerances.
- REQ-DATA-a5673202 — accept only a strictly valid protection request.
- REQ-FUNC-b65fb9ee — breaking capacity of the named kind at the circuit voltage against Ik3max.
- REQ-FUNC-f24b4131 — Ib <= In <= Iz and I2 <= 1.45 Iz with the cited ratio and setting range.
- REQ-FUNC-b9c2bc7d — automatic disconnection from cited band points against Ik1min.
- REQ-FUNC-884410b3 — let-through energy against k²S².
- REQ-FUNC-894dce2a — selectivity, cascading and starter coordination only from manufacturer tables.
- REQ-FUNC-870b4cdc — RCD type from the equipment, sensitivity from the profile.
- REQ-REL-8f88c502 — missing, extracted, off-condition or other-kind data never passes.
- REQ-REL-62b1aee8 — a missing, invalid, foreign or stale network result is refused.
- REQ-FUNC-4dcdce2d — protection results stored through an approved prepared change, stale with the network inputs.
- REQ-TEST-4ef52f14 — cited protection fixture and hand calculations.
- REQ-UX-d32cc9db — electrical tool descriptions in the workbench tools editor (en/ro/de/fr).

## Files

- `05_Software/src/libraries/shared/src/electrical-model.ts` — format-1 schemas, names and limits.
- `05_Software/src/libraries/core/src/electrical/units.ts` — the unit table and known properties.
- `05_Software/src/libraries/core/src/electrical/model.ts` — validation, issues, canonical form, hashes.
- `05_Software/src/libraries/core/src/electrical/edit.ts` — operations and the explicit-mapping import.
- `05_Software/src/libraries/core/src/electrical/results.ts` — result checks and derived freshness.
- `05_Software/src/libraries/core/src/electrical/tools.ts` — access port, both tools, host-flag helpers.
- `05_Software/tests/fixtures/electrical-model/two-pump-panel.json` — fictional two-pump panel model.
- `05_Software/src/libraries/shared/src/industrial-catalog.ts` — catalog format-1 schema, folder, limits, requirement schema.
- `05_Software/src/libraries/core/src/electrical/catalog.ts` — catalog checks, lookup, selection, coordination.
- `05_Software/src/libraries/core/src/electrical/catalog-tool.ts` — catalog files and the industrial_catalog tool.
- `05_Software/tests/fixtures/industrial-catalog/cat-schneider-tesys.json` — two Schneider families from cited se.com pages.
- `05_Software/src/libraries/core/src/electrical/catalog.test.ts` — format, links, SKU/variant/accessory, selection, coordination.
- `05_Software/src/libraries/core/src/electrical/catalog-tool.test.ts` — listing, broken files, tool views, plugin ecosystem.
- `05_Software/src/libraries/core/src/electrical/model.test.ts` — format, IDs, relations, units, unknowns, round trip, fixture.
- `05_Software/src/libraries/core/src/electrical/results.test.ts` — result format and freshness.
- `05_Software/src/libraries/core/src/electrical/tools.test.ts` — views, prepared change, conflicts, import.
- `05_Software/src/libraries/core/src/sessions/electrical-model.test.ts` — approval, auto-edit, read-only, gating.
- `05_Software/src/libraries/shared/src/cable-table.ts` — cable table format-1 schema, folder and limits.
- `05_Software/src/libraries/core/src/electrical/cable-table.ts` — table checks, confined reading, factor lookups.
- `05_Software/src/libraries/core/src/electrical/network.ts` — the radial LV network engine and its request schema.
- `05_Software/src/libraries/core/src/electrical/network-tool.ts` — the electrical_network write tool.
- `05_Software/src/libraries/core/src/electrical/report.ts` — Markdown report of a stored result.
- `05_Software/src/libraries/core/src/electrical/network.test.ts` — hand calculations, pandapower references, sizing, refusals.
- `05_Software/src/libraries/core/src/electrical/network-tool.test.ts` — prepared result, freshness, report view, plugin.
- `05_Software/src/libraries/core/src/electrical/cable-table.test.ts` — table format, lookups, the Nexans fixture.
- `05_Software/tests/fixtures/electrical-network/` — fictional network A, fictional test table, cited Nexans NYM-J table.
- `05_Software/tests/support/pandapower_network_check.py` — independent pandapower 3.1.2 fault-current references.
- `05_Software/src/libraries/core/src/electrical/protection.ts` — the LV protection engine and its request schema.
- `05_Software/src/libraries/core/src/electrical/protection-tool.ts` — the protection_coordination write tool.
- `05_Software/src/libraries/core/src/electrical/result-change.ts` — run IDs and the prepared write of a new result.
- `05_Software/src/libraries/core/src/electrical/protection.test.ts` — criteria with hand calculations, refusals, fixture.
- `05_Software/src/libraries/core/src/electrical/protection-tool.test.ts` — prepared result, stale refusal, k check, plugin.
- `05_Software/tests/fixtures/protection-coordination/cat-lv-protection.json` — cited iC60N, C10G, GV2ME14 and LC1D data.

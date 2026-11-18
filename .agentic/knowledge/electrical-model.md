# Electrical project model

## Routing

Select for the electrical project model, `electrical-automation-model.json`, `electrical-automation-results/`,
`electrical_model`, `electrical_model_change`, quantities with units and basis, entity IDs versus visible
references (M1, QF1), relation rules, result freshness/stale results, explicit-mapping imports and the
`electricalModel` host flag, the industrial catalog: `electrical-automation-catalogs/<id>.json`, the
`industrial_catalog` tool, order codes versus distributor SKUs, firm-requirement selection and coordination
lookups (spec .agentic/specs/REQ-DATA-d7e27def.md, core electrical/catalog.ts and catalog-tool.ts), and the
per-plugin tool gating (`electricalPluginTools`, `electricalToolOffered`). Start at
05_Software/src/libraries/core/src/electrical/ (model.ts, tools.ts) and
shared/src/electrical-model.ts, with spec .agentic/specs/REQ-DATA-06c0bd54.md. Tests: core/src/electrical/*.test.ts,
core/src/sessions/electrical-model.test.ts, desktop main/sessions.test.ts. The radial LV network engine and the
LV protection engine belong to [network and protection engines](electrical-model-network-protection.md); the motor drives, power factor correction and lighting engines belong to
[drives, PFC and lighting engines](electrical-model-drives-pfc-lighting.md). The write flow itself
(commitChange, WriteQueue) belongs to [file tools](file-tools.md); plugin packages and their helpers belong to
[plugins](plugins.md) and [official plugins](official-plugins-electrical.md).

## Purpose and boundaries

First-party foundation of the electrical and automation plugins (PWR, CAD, PLC, IND): one project model per
workbench, its units, its relation graph, provenance and the result contract, and the industrial catalog files and
their selection. The
workbench owns the model file; VERA reads it strictly and writes it only through `electrical_model_change`, a
prepared change on the shared write flow. Plugin helpers read the model and write results into their own run
folders; VERA derives result freshness from the results' input snapshots and stores no second copy. The
calculation engines that read the model and store results have their own pages (see Routing).

## Public interface

Agent input entrypoints capture toolPathGuard(ctx) and retain it across catalog/cable/measurement/lighting/photometry/evidence and import reads; model/result storage keeps its confined guard. Identifier selectors remain identifiers, and canonical aliases outside the workbench require Bypass. They refuse application data even when nested inside the workbench, before parsing bytes. Result listings resolve each child through the guard. Internal host callers retain default exclusions of none; stored result/model locations stay workbench-owned. Focused boundary proof is tools/app-data-inputs.test.ts and the valid protected cable-table case in network-tool.test.ts.

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
- Result format 1 has an optional strict `assemblies` list (<= 16; per assembly motor, circuit, method, conditional,
  devices <= 16 {tag, role, item|null, orderCode|null, setting?}, connections <= 32 {from, to, kind power|control},
  interlocks <= 8 {kind mechanical|electrical|sequence, devices, note}); `renderResultReport` lists them.
- Tool gating: `electricalModelToolNames` (`electrical_model`, `electrical_model_change`) are offered while any plugin
  of manifest ecosystem `electrical` or `automation` is loaded (`electricalModelPlugin`); each tool of
  `electricalPluginTools` (`industrial_catalog` -> industrial-catalog, `electrical_network` -> electrical-network,
  `protection_coordination` -> protection-coordination, `motor_drives` -> motor-drives, `power_quality` -> power-quality-pfc, `lighting_design` -> lighting-design) only while its own plugin ID
  is loaded (`electricalToolOffered(name, plugins)`). `SessionHost.electricalPlugins` holds the loaded plugin IDs; the
  desktop sets it from the loaded plugins of those ecosystems. The headless CLI does not set it.

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
| Result assemblies | shared electrical-model.ts, results.ts, report.ts | electrical/motor-drives.test.ts |
| Offering the tools | electrical/tools.ts (`electricalPluginTools`), sessions/service.ts filter, desktop main/sessions.ts | sessions/electrical-model.test.ts, desktop main/sessions.test.ts |

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
- REQ-UX-d32cc9db — electrical tool descriptions in the workbench tools editor (en/ro/de/fr).
- REQ-DATA-e3d5c15f — strict assemblies in the result and the report.

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

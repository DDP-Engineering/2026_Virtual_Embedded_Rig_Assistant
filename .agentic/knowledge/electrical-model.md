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
electrical/protection.ts, protection-tool.ts, result-change.ts), the motor drives engine: `motor_drives`, DOL,
reversing, star-delta, softstarter and VFD comparison, acceleration model, starter and drive sizing, the result's
`assemblies` connection and interlock scheme (spec .agentic/specs/REQ-DATA-79118f9a.md, core electrical/motor-drives.ts,
motor-drives-tool.ts), the power factor correction engine: `power_quality`, measurement files
`electrical-automation-measurements/<id>.json` (+ `.csv`), displacement versus total power factor, compensation need,
fixed or automatic capacitor banks, detuned steps and resonance (spec .agentic/specs/REQ-DATA-4dc5e2c7.md, core
electrical/measurements.ts, power-quality.ts, power-quality-tool.ts), the lighting engine: `lighting_design`,
lighting projects and report records `electrical-automation-lighting/<id>.json`, photometry files
`electrical-automation-photometry/` (IES LM-63, EULUMDAT), lumen method, utilisation and maintenance factor, direct
component, DIALux evo report mapping (spec .agentic/specs/REQ-DATA-affb2e6b.md, core electrical/photometry.ts,
lighting-files.ts, lighting.ts, lighting-tool.ts), and the per-plugin tool gating (`electricalPluginTools`, `electricalToolOffered`). Start at 05_Software/src/libraries/core/src/electrical/ (model.ts, tools.ts) and
shared/src/electrical-model.ts, with spec .agentic/specs/REQ-DATA-06c0bd54.md. Tests: core/src/electrical/*.test.ts,
core/src/sessions/electrical-model.test.ts, desktop main/sessions.test.ts. The write flow itself
(commitChange, WriteQueue) belongs to [file tools](file-tools.md); plugin packages and their helpers belong to
[plugins](plugins.md) and [official plugins](official-plugins.md).

## Purpose and boundaries

First-party foundation of the electrical and automation plugins (PWR, CAD, PLC, IND): one project model per
workbench, the industrial catalog files and their selection, its units, its relation graph, provenance and the result contract, the radial LV network engine with its cable tables, the LV protection engine, the motor drives engine and the power factor correction engine with its measurement files. The
workbench owns the model file; VERA reads it strictly and writes it only through `electrical_model_change`, a
prepared change on the shared write flow. Plugin helpers read the model and write results into their own run
folders; VERA derives result freshness from the results' input snapshots and stores no second copy.

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
- Motor drives engine (spec REQ-DATA-79118f9a): pure `analyzeMotorDrives({model, protection, network, catalog,
  catalogStamp, request, runId, now})` -> ElectricalResult with `motorDrivesRequestSchema` {protection run ID, catalog,
  ambientTemperature? (°C), altitude? (m), motors 1..4 {motor, reversing?, speedControl?, inching?, startingCurrentMax?
  (A), accelerationTimeMax?, stopTimeMax? (s), switchover? (share of rated speed), currentLimit? (x In), protection?,
  contactor?, starContactor?, overloadRelay?, softstarter?, drive? (catalog items)}}; exported `motorTorque`,
  `breakdownSpeed`, `accelerationTime` (midpoint rule) for the hand-calculation tests. Criteria per motor (subject =
  motor) `function|star-delta-eligibility|starting-current|starting-torque|acceleration-time|starts-per-hour:<method>`,
  `method:<method>`, `proposal`, and for the proposed method `protection:<code>`, `contactor-<line|reverse|delta|star|
  bypass>:<code>`, `mechanical-interlock:<code>`, `overload-relay:<code>`, `overload-start:<code>`,
  `starter-coordination:<p>/<c>`, `softstarter:<code>`, `drive-current|drive-overload-time|drive-voltage|motor-cable|
  emc|braking|rcd-requirement:<code>`; values `ratedTorque`, `synchronousSpeed`, `totalInertia`,
  `startingCurrent|startingTorque|accelerationTime:<method>`, `motorTorque:<method>@<pct>`, `loadTorque@<pct>`,
  `brakingEnergy`, `brakingPower`; conditions `protectionRun`, `networkRun`, `proposal<N>`.
- Tool `motor_drives` (write): reads the model, the named CURRENT protection-coordination result and the network result
  it names (both refused when missing, invalid, foreign or stale) and the catalog, and prepares one new result through
  `prepareResultChange`; the result copies the protection result's inputs plus the motors, circuits, cables and
  relations it read.
- Measurement files (spec REQ-DATA-4dc5e2c7): shared `powerMeasurementsSchema` (kind `vera-power-measurements`,
  format 1), `powerMeasurementsDir` (`electrical-automation-measurements`), `powerMeasurementLimits` (64 columns,
  20000 rows, 4 MiB per file); core `checkMeasurements`/`parseMeasurements(json, csv?, id)` -> series {file, times,
  values by `columnKey` (`activePower`, `harmonicVoltage@5`, ...) in kW, kvar, kVA, V, A and shares, intervalSeconds,
  gaps}, `readMeasurementFile(root, id)` -> {series, stamp {id, sha256 of JSON + CSV, path, rows, origin}} (PathGuard).
- Power factor correction engine (spec REQ-DATA-4dc5e2c7): pure `analyzePowerQuality({model, network|null,
  measurements|null, catalog|null, catalogStamp|null, request, runId, now})` with `powerQualityRequestSchema` {board,
  network?, measurements?, catalog?, targetPowerFactor 0.8..1, totalPowerFactorMin?, voltageTolerance? (%),
  resonanceMargin?, harmonicThreshold? (%), maxSteps? 1..32, harmonicGeneratorPower? (kVA), reactiveAsFundamental?,
  steps? 1..4 {capacitor,
  reactor?, units? 1..8}, contactor?, protection?}; exported `compensationNeed`, `displacementFactor`,
  `powerFactorAfter`, `resonanceOrder`, `stepCurrent`, `capacitorCurrentRatio`. Producer `power-quality-pfc` /
  `pfc`. Criteria (subject = board) `fixed-bank`, `fixed-share`, `step-size|step-count|step-combination|
  capacitor-voltage|harmonic-duty|non-linear-share|configuration|resonance|contactor|protection|inrush|step:<step>`,
  `target:<s>`, `total-power-factor:<s>`, `proposal`; values per scenario `<s>` (network IDs, `measured-peak`,
  `measured-light`) `activePower|reactivePower|displacementFactor|totalPowerFactor|compensationNeed|
  displacementFactorAfter|totalPowerFactorAfter:<s>`, per step `stepOutput|stepCurrent|permissibleCurrent|steps|
  capacitorCurrentRatio:<step>`, `resonanceOrder:<step>@<n>`; conditions `bankType`, `step`, `stepOutput`, `steps`,
  `bankOutput`, `controlLogic`, `measurements`, `networkRun`.
- Tool `power_quality` (write): reads the model, the named network result (refused when missing, invalid, foreign or
  stale), the measurement file (refused when invalid or of another board) and the catalog, and prepares one new result
  through `prepareResultChange`; the result copies the network result's inputs plus the board, its subtree and its
  source.
- Photometry (spec REQ-DATA-affb2e6b "Photometry"): pure `parsePhotometry(name, latin1Text)` -> {format ies|ldt,
  standard, identity, symmetry rotational|quadrant|bilateral|full, cAngles, gammas, candela[c][g] absolute cd,
  absolute, lampFlux|null, luminaireFlux (integrated: 1-degree C steps, 0.5-degree gamma zones), lightOutputRatio,
  declaredLightOutputRatio, inputWatts|null, dimensions m, messages}; `intensityAt(p, C, gamma)` (bilinear, 0 outside
  the gamma range), `integrateFlux`. IES type C with TILT=NONE and horizontal ranges 0/90/180/360; EULUMDAT symmetry
  0, 1, 2, 4. Throws `Invalid photometry file <name>: <reason>.` otherwise.
- Lighting files: shared `lighting-project.ts` (`lightingProjectSchema`, `lightingReportSchema`, `lightingDir`,
  `photometryDir`, `lightingLimits`); core `lighting-files.ts` (`checkLightingProject`, `checkLightingReport`,
  `parseLightingProject`, `parseLightingReport`, confined `readLightingProject`, `readLightingReport`,
  `readPhotometryFile` -> {photometry, stamp {name, path, sha256}}, `hashEvidenceFile` streamed, <= 64 MiB).
- Lighting engine: pure `analyzeLighting({model, project, projectStamp, photometry Map<type, {photometry, stamp}>,
  catalog|null, catalogStamp|null, report {report, stamp, evidenceSha256|null}|null, request, runId, now})` with
  `lightingRequestSchema` {project, level preliminary|verification, report? (exactly at verification), catalog?,
  scenarios?}; exported `roomIndex`, `utilisationFactorAt`, `directIlluminance`. Producer `lighting-design` /
  `lighting`, engine `vera-lighting` 1.0.0. Criteria `profile`, `geometry` (project), `photometry`, `catalog` (type),
  `placement` (luminaire, failures only), per scenario `estimated-average-illuminance`, `maintained-illuminance`,
  `uniformity`, `glare-ugr`, `report-match`, `report-consistency`; values `roomArea` (m²), per type `luminaireFlux`,
  `lampFlux`, `inputPower`, `efficacy`, `lightOutputRatio`, per scenario `luminaireCount`, `mountingHeight`,
  `roomIndex`, `utilisationFactor`, `estimatedAverageIlluminance`, `luminairesNeeded`, `gridPoints`,
  `directIlluminanceMin|Average|Max`, `installedPower`, `powerDensity` (W/m²), `reportAverage|Minimum|Uniformity|Ugr`.
- Tool `lighting_design` (write): reads the model, the project, every type's photometry, the optional catalog and
  report record (refused when it belongs to another project; its evidence file hashed) and prepares one new result
  through `prepareResultChange`; inputs = the model project + the lighting loads the types name; the files' sha256
  are in `sources` (file freshness not tracked, a stated limit).
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
- The motor drives engine compares methods only on stated data: an absent or null nameplate, torque, inertia or load
  value leaves the dependent values null and their verdicts unknown; without a stated pull-up torque the starting
  torque stands in and the torque check stays unknown; a limit that is not stated gives not-evaluated, never pass.
  The proposal is the first passing method in the order dol, reversing, star-delta, softstarter, vfd and is conditional
  (unknown) when a simpler method or the assembly is not established. Contactors are checked at their position
  current in the method's utilisation category, drives by continuous and transient current per duty class (never by
  power), derating only from cited per-kelvin or per-100 m factors; protective-device and starter verdicts are copied
  from the protection result. Nothing is configured and no safety function is claimed (REQ-FUNC-30561076,
  REQ-FUNC-31a5706e, REQ-FUNC-179328ee, REQ-FUNC-12507326, REQ-FUNC-f19b1719, REQ-FUNC-028689c0). `motor_drives`
  refuses a stale protection or network result and writes only a new result file (REQ-REL-6bf4730e,
  REQ-FUNC-285949c8).
- A measurement file is read strictly: declared origin, licensed source, board, interval and conventions, units of the
  quantity's dimension, one time column first with strictly increasing ISO times, CSV header equal to the column names;
  anything else refuses the file (REQ-DATA-fec8378b). The PFC engine converts declared generator or capacitive-positive
  data to the load convention, keeps Q1, DPF and the need unknown when the reactive convention does not establish them (an `undeclared` Q only with
  the request's `reactiveAsFundamental` assumption), evaluates at most 64 bank states for resonance,
  computes the total power factor only from S, a PF column or (stated approximation) THDi, fails a fixed bank that
  exceeds Q1 in any scenario or interval, accepts a capacitor/reactor pair only through a cited `detuned step` entry,
  never passes a resonance without fault level, margin and measured orders around the resonance, designs no filter and
  switches nothing (REQ-FUNC-936473de, REQ-FUNC-7484dcd8, REQ-FUNC-9ef28234, REQ-FUNC-a7193330, REQ-FUNC-6e83340d,
  REQ-FUNC-5f29d1c6). `power_quality` refuses a stale network result or another board's measurements and writes only a
  new result file (REQ-REL-0f24c593, REQ-FUNC-7c320847).
- The lighting engine labels the preliminary level preliminary, takes utilisation factors only from cited entries of
  the project (exact k or linear between two tabulated k, same reflectances), reports the grid only as the direct
  component, computes no uniformity or UGR, keeps maintained illuminance, uniformity and glare not-evaluated without a
  matched engine report, blocks scenarios with a failed placement or photometry, blocks the run on failed geometry or
  an emergency/exterior profile, and gives preliminary false only for a matched `origin: engine` record whose evidence
  sha256 VERA verified (REQ-FUNC-ca72aaff, REQ-FUNC-b78b7b15, REQ-FUNC-dafae3f1, REQ-FUNC-e087cb4d, REQ-FUNC-addd6a2f,
  REQ-FUNC-e86a35c5, REQ-FUNC-50fa2fc0). `lighting_design` refuses missing, invalid, lightless or foreign inputs and
  a non-lighting load, and writes only a new result file (REQ-REL-840d2785, REQ-FUNC-98dceeb1).
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
| Motor drives engine, request, criteria, scheme | electrical/motor-drives.ts, spec REQ-DATA-79118f9a | electrical/motor-drives.test.ts |
| Motor drives tool | electrical/motor-drives-tool.ts, result-change.ts | electrical/motor-drives-tool.test.ts |
| Measurement file format and reading | shared power-measurements.ts, electrical/measurements.ts, spec REQ-DATA-4dc5e2c7 | electrical/measurements.test.ts |
| PFC engine, request, criteria | electrical/power-quality.ts, spec REQ-DATA-4dc5e2c7 | electrical/power-quality.test.ts |
| PFC tool | electrical/power-quality-tool.ts, result-change.ts | electrical/power-quality-tool.test.ts |
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
- REQ-DATA-79118f9a — accept only a strictly valid motor drives request.
- REQ-FUNC-30561076 — five methods against the process function and limits.
- REQ-FUNC-270a3c8e — star-delta eligibility from terminals, connection and voltage.
- REQ-FUNC-31a5706e — starting current, torque and acceleration time in the modelled domain.
- REQ-FUNC-179328ee — simplest feasible method proposed, conditional when not established.
- REQ-FUNC-12507326 — contactors per position and utilisation category, relay, interlock, softstarter derating.
- REQ-FUNC-f19b1719 — drive by current, overload and duty class; braking, EMC, cable from data.
- REQ-FUNC-028689c0 — protection and starter verdicts copied from the protection result.
- REQ-REL-6bf4730e — a missing, invalid, foreign or stale protection or network result is refused.
- REQ-FUNC-285949c8 — motor results stored through an approved prepared change, stale with the motors read.
- REQ-TEST-c04129a0 — three load fixtures, cited catalog, preset reference tolerances.
- REQ-DATA-e3d5c15f — strict assemblies in the result and the report.
- REQ-DATA-4dc5e2c7 — accept only a strictly valid power quality request.
- REQ-DATA-fec8378b — import a declared measurement file or refuse it.
- REQ-FUNC-936473de — P, Q1, displacement and total power factor with declared conventions.
- REQ-FUNC-7484dcd8 — compensation need per scenario to the stated target.
- REQ-FUNC-9ef28234 — fixed or automatic bank, steps, control logic, overcompensation criteria.
- REQ-FUNC-a7193330 — capacitor, reactor, contactor and protection only from cited data.
- REQ-FUNC-6e83340d — resonance from fault level and measured orders; missing data unknown.
- REQ-FUNC-5f29d1c6 — Gh/Ssc configuration rule; no filter designed.
- REQ-REL-0f24c593 — a stale or foreign network result or another board's measurements is refused.
- REQ-FUNC-7c320847 — PFC results stored through an approved prepared change, switching nothing.
- REQ-TEST-37973c6e — guide references with preset tolerances, labelled fictional measurement set.

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
- `05_Software/src/libraries/core/src/electrical/motor-drives.ts` — the motor drives engine and its request schema.
- `05_Software/src/libraries/core/src/electrical/motor-drives-tool.ts` — the motor_drives write tool.
- `05_Software/src/libraries/core/src/electrical/motor-drives.test.ts` — hand calculations, ABB example, three loads, assembly, drive.
- `05_Software/src/libraries/core/src/electrical/motor-drives-tool.test.ts` — prepared result, stale refusal, plugin gating.
- `05_Software/tests/fixtures/motor-drives/` — fictional plant M and the cited motor-drives catalog.
- `05_Software/src/libraries/shared/src/power-measurements.ts` — measurement file format-1 schema, folder and limits.
- `05_Software/src/libraries/core/src/electrical/measurements.ts` — measurement checks, CSV rows, confined reading.
- `05_Software/src/libraries/core/src/electrical/power-quality.ts` — the PFC engine and its request schema.
- `05_Software/src/libraries/core/src/electrical/power-quality-tool.ts` — the power_quality write tool.
- `05_Software/src/libraries/core/src/electrical/measurements.test.ts` — format, CSV/rows, refusals, fixture reading.
- `05_Software/src/libraries/core/src/electrical/power-quality.test.ts` — guide examples, conventions, bank, equipment, resonance.
- `05_Software/src/libraries/core/src/electrical/power-quality-tool.test.ts` — prepared result, stale and board refusals, plugin.
- `05_Software/tests/fixtures/power-quality-pfc/` — fictional plant Q, fictional measurement day, HIPE real excerpt (CC BY 4.0), cited PFC catalog.
- `05_Software/src/libraries/shared/src/lighting-project.ts` — lighting project and report record format-1 schemas.
- `05_Software/src/libraries/core/src/electrical/photometry.ts` — IES LM-63 and EULUMDAT reading, intensity, flux.
- `05_Software/src/libraries/core/src/electrical/lighting-files.ts` — reference checks and confined lighting file reads.
- `05_Software/src/libraries/core/src/electrical/lighting.ts` — the lighting engine and its request schema.
- `05_Software/src/libraries/core/src/electrical/lighting-tool.ts` — the lighting_design write tool.
- `05_Software/src/libraries/core/src/electrical/photometry.test.ts` — analytic flux, symmetries, scaling, refusals.
- `05_Software/src/libraries/core/src/electrical/lighting-files.test.ts` — formats, references, confined reads.
- `05_Software/src/libraries/core/src/electrical/lighting.test.ts` — hand calculations, diagnostics, profiles, catalog, report mapping.
- `05_Software/src/libraries/core/src/electrical/lighting-tool.test.ts` — prepared result, staleness, evidence hash, refusals, plugin.
- `05_Software/tests/fixtures/lighting-design/` — fictional office, hand-written IES/LDT, fictional report record and catalog.

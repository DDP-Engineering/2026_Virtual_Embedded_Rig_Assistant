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
lighting-files.ts, lighting.ts, lighting-tool.ts), QElectroTech projects: `qelectrotech`, `qelectrotech_change`,
`qelectrotech_check`, strict .qet XML (no DTD/XXE), folios, conductors, potentials, master/slave cross-references,
DOL/reversing/star-delta template candidates, interlock checks, byte-preserving edits, reconcile with the model
(spec .agentic/specs/REQ-DATA-963cbdf6.md, core electrical/xml-strict.ts, qet.ts, qet-symbols.ts, qet-templates.ts,
qet-check.ts, qet-tool.ts), panel engineering: `panel_engineering`, `panel_engineering_check`, panel files
`electrical-automation-panels/<id>.json`, BOM and reconciliation with assemblies/model/schematics, accessories listed
by the host item, terminal strips, 24 V budget and derating, 2D rail placement, dissipation, enclosure heat balance,
short-circuit/busbars not evaluated, verification report, impact of a changed device, BOM CSV and layout SVG (spec
.agentic/specs/REQ-DATA-a8bf1713.md, core electrical/panel-file.ts, panel.ts, panel-tool.ts), electrical documentation:
`electrical_documentation`, `electrical_documentation_check`, `electrical_documentation_export`, material, connection,
cable, terminal, label and I/O lists, tag CSV import, wire numbering and wire ends, device-terminal-I/O-tag chain,
logical revision, change report, CSV/XLSX/PDF exports (spec .agentic/specs/REQ-DATA-aa83ed5c.md, core
electrical/documentation.ts, documentation-export.ts, documentation-tool.ts), EPLAN exchange: `eplan`, `eplan_change`,
`eplan_check`, profiles `electrical-automation-eplan/<id>.json`, strict semicolon device/terminal/connection tables,
EPLAN device tags =plant+location-identifier, reconcile with the documentation lists, the device list import candidate,
round-trip and eplan-tool outcome criteria (spec .agentic/specs/REQ-DATA-203d52e6.md, shared eplan.ts, core
electrical/eplan.ts, eplan-tool.ts; the helper eplan-tool belongs to official plugins), and the per-plugin tool gating (`electricalPluginTools`, `electricalToolOffered`). Start at 05_Software/src/libraries/core/src/electrical/ (model.ts, tools.ts) and
shared/src/electrical-model.ts, with spec .agentic/specs/REQ-DATA-06c0bd54.md. Tests: core/src/electrical/*.test.ts,
core/src/sessions/electrical-model.test.ts, desktop main/sessions.test.ts. The write flow itself
(commitChange, WriteQueue) belongs to [file tools](file-tools.md); plugin packages and their helpers belong to
[plugins](plugins.md) and [official plugins](official-plugins.md).

## Purpose and boundaries

First-party foundation of the electrical and automation plugins (PWR, CAD, PLC, IND): one project model per
workbench, the industrial catalog files and their selection, its units, its relation graph, provenance and the result contract, the radial LV network engine with its cable tables, the LV protection engine, the motor drives engine, the power factor correction engine with its measurement files, the lighting engine, the QElectroTech schematic reader, templates and checks, the panel engineering engine and the documentation lists and exports. The
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
- QElectroTech (spec REQ-DATA-963cbdf6): `parseStrictXml(source, label)` (span-keeping; refuses DOCTYPE, entities other
  than the five predefined and character references, PIs other than the leading declaration, non-UTF-8, depth > 64,
  > 500 000 elements, > 16 MiB; `Invalid QElectroTech project <label>: line <n>: <reason>.`), `decodeXmlBytes`;
  `readQetProject(source, label)` -> {version, title, properties, folios, definitions (embed:// paths), elements (uuid,
  info, label, links, position `<folio>-<row><col>`), conductors (ends by element+terminal UUID or legacy numeric id),
  potentials (conductors + linked folio reports), potentialOf, devices (master + linked slaves), problems}. Problem codes:
  uuid, uuid-duplicate, definition-missing, conductor-end, link-missing, link-type, link-not-reciprocal, slave-unlinked,
  slave-label, label-duplicate (terminals of a strip and unlinked slaves exempt), report-unlinked.
- Templates: `renderTemplate({assembly, motorRef, title, newUuid?})` for methods dol, reversing, star-delta (self-authored
  symbols `embed://import/vera/*.elmt` in qet-symbols.ts, terminal UUIDs stable per symbol); folio 1 draws the assembly's
  power connections per phase (`from` 2/4/6 -> `to` 1/3/5 or the listed terminals, `supply` = X0 L1..L3, star point on
  KM3 1-3-5), folio 2 the method's control circuit (X1 L/N, F1 95-96, S0, S1/S2 with 13-14 seal-in, 21-22 interlock NCs,
  coils; star-delta timer KT1 55-56 / 67-68).
- Checks: `assemblyChecks(project, assembly, motorRef, mechanical)` -> `assembly-devices`, `connection:<from>/<to>`,
  `star-point`, `coil-supply:<tag>`, `interlock:electrical:<F1>`, `interlock:electrical:<A>/<B>`, `interlock:sequence`,
  `mechanical-interlock` (copied from the stored criterion), `contact-links`; `projectChecks(project, model, path)` ->
  `project-read`, `labels`, `conductor-numbering`, `cross-references`, `device-list` plus `reconcile` {matched (identity
  recorded|unrecorded|differs), qetOnly, modelOnly, problems, operations (update-object / add-object with attributes
  qetUuid, qetProject)}.
- Tool `qelectrotech` (read) {view project|devices|potentials|reconcile, path .qet, offset?}; `qelectrotech_change` (write)
  {action candidate, motorDrivesRun, motor, path, title?} (new file only, CURRENT motor-drives result, checks must pass)
  | {action edit, path, sha256, title?, elements [{uuid, info}]} (splices of the allowed information names and the title,
  base sha256; elements and conductors must stay the same); `qelectrotech_check` (write) {path, motorDrivesRun?, motor?}
  -> one result (producer qelectrotech/check, engine vera-qet-check 1.0.0) with sources `qet:<path>@sha256:<hex>`.
- Panel files (spec REQ-DATA-a8bf1713): shared `panelSchema` (kind `vera-panel`, format 1), `panelDir`
  (`electrical-automation-panels`), `panelLimits`, `panelLocations`, `panelTagSchema`; core `checkPanel`/`parsePanel`
  (`Invalid panel file <id>:`, unique tags across zones, rules, rails, ducts, equipment and strips, references to rails,
  zones, hosts, supplies, scenarios and sources, units by property) and confined `readPanelFile(root, id)` -> {panel,
  stamp {id, path, sha256}} (1 MiB).
- Panel engine: pure `analyzePanel({model, panel, catalogs Map<id, {catalog, stamp}>, motorDrives, network|null,
  schematics [{path, sha256, motor, project}], ...})` -> result (producer `panel-engineering` / `panel`, engine
  `vera-panel` 1.0.0, preliminary, catalog null); exported `effectiveSurface`, `temperatureRise`, `AIR_FACTOR` 3.1,
  `verificationCharacteristics` (13), `NO_CONFORMITY`, `panelFingerprints`, `draftEquipment`, `panelImpact`,
  `panelBomCsv`, `panelLayoutSvg`. Criteria `bom-items`, `assembly:<motor ref>`, `model-loads`, `model-devices`,
  `schematic:<path>`, `accessory:plate|<tag>`, `terminals:<strip>`, `terminal-spare:<strip>`, `rail:<tag>` (failures),
  `placement:<tag>` (fail/unknown only), `layout`, `segregation:<rule>`, `reserve-rails`, `dissipation:<s>`, `thermal`
  (not-evaluated) or `thermal:<s>`, `supply:<psu>:<s>`, `short-circuit-withstand`, `busbars`; values `railFree`,
  `effectiveSurface`, `dissipation|temperatureRise|internalTemperature:<s>`, `loss:<tag>`,
  `supplyLoad|supplyAvailable:<psu>:<s>`. Result section `panel` {id, path, board, frame, plate, bom (sha256 per line),
  rails, zones, ducts, placements, verification}.
- Tool `panel_engineering_check` (write) {panel, motorDrivesRun, schematics? <= 8 {path, motor?}}: reads the model, the
  panel file, its catalogs plus the motor_drives result's catalog, the CURRENT motor_drives result (refused when
  missing, foreign or stale), its network result when current, the .qet files, and prepares one new result through
  `prepareResultChange`; refuses a panel board that is not a board or a motor that is not a motor. Tool
  `panel_engineering` (read) {view draft {motorDrivesRun, motors?} | impact {runId} | export {runId, format bom-csv |
  layout-svg}} writes nothing.
- Documentation (spec REQ-DATA-aa83ed5c): shared `documentationLists` (materials, connections, cables, terminals,
  labels, io, contents), `documentationColumns`, `documentationLimits` (2000 rows per list), result section
  `documentation` {project, revision {value, document, date, author}, panel {run, path, sha256}, lists [{list, title,
  columns, rows [{key, cells, source}], sha256}], changes? {previousRun, previousRevision, rows, truncated, objects,
  sources, results}}; core `parseTagFile`/`normalizeAddress` (tag CSV name,address[,dataType,comment], 5000 rows, 1 MiB,
  `Invalid tag file <path>: line <n>: <reason>.`), pure `analyzeDocumentation(input)` (producer `electrical-documentation`
  / `documentation`, engine `vera-documentation` 1.0.0), `changedSources`, `sourcePaths`; exports `documentationCsv`,
  `documentationXlsx` (fflate), `documentationPdf` (own PDF 1.4 writer, Courier, WinAnsi); panel.ts `csvField` shared.
  Criteria `source:panel-result|motor-drives|panel-file|tags`, `source:schematic:<path>`, per schematic
  `labels|numbering|cross-references|wire-ends|duplicates|device-refs:<path>`, `assembly:<path>:assembly-devices|connection:*`
  (CAD-01 `assemblyChecks`), `cable-ends`, `terminal-points`, `io-chain`, `tag-file`, `revision`, `limits:<list>`.
- Tool `electrical_documentation_check` (write) {panelRun, schematics? <= 8 {path, motor?}, document?, tags?, previousRun?}:
  reads the model, the panel result (refused when missing or not a panel result), its panel file and the motor_drives
  run it names (stale or missing ones are failed `source:*` criteria, status incomplete), the .qet files, the tag file,
  the previous documentation run and the stored results' freshness, and prepares one new result through
  `prepareResultChange`. Tool `electrical_documentation` (read) {view list {runId, list, offset?} | changes {runId}}.
  Tool `electrical_documentation_export` (write) {runId, format csv|xlsx|pdf, list?} prepares one new file
  `electrical-automation-results/<run>/documentation-<list>.csv|documentation.xlsx|documentation.pdf` through
  `commitChange` (existing file refused; binary preview = size and sha256).
- EPLAN exchange (spec REQ-DATA-203d52e6): shared `eplanProfileSchema` (kind `vera-eplan-profile`, format 1: target
  EPLAN Electric P8 2025 windows-x64, `project.link` absolute .elk path without spaces, `tables.devices.columns` tag +
  part/description/vera, `partPrefixes` per manufacturer, optional `terminals` {scheme, language, columns strip, point}
  and `connections` {scheme, language, columns from, to, wire?, crossSection?, color?}), `eplanOutcomeSchema` (kind
  `vera-eplan-outcome`, format 1), `eplanProfileDir`, `eplanTables`, `eplanColumns`, `eplanLimits` (profile 64 KiB,
  table 4 MiB / 20 000 records, outcome 256 KiB). Core pure: `parseEplanProfile` (`Invalid EPLAN profile <id>: ...`),
  `decodeEplanTable`/`parseEplanTable` (UTF-8, BOM kept, `;` via the documentation `csvRecords(text, fail, delimiter)`
  which returns record spans, header with every mapped header once, equal field counts, one empty final line,
  `Invalid EPLAN <table> table <path>: line <n>: <reason>.`; records keep cells, raw text and mapped values),
  `eplanTag`, `eplanEnd`, `eplanRecordText`, `reconcileEplan` (devices matched by VERA ID or identifier against the
  documentation labels of kind device, parts against materials with the manufacturer prefix, terminals against the
  terminal rows of panel strips, connections as unordered end pairs with wire numbers; `update-object` operations
  recording `attributes.eplanTag`), `eplanCandidate`, `roundTripCriteria`, `outcomeCriterion`, `analyzeEplan`
  (producer `eplan` / `check`, engine `vera-eplan` 1.0.0). Access: `readEplanProfile(root, id)`, `readEplanTable(root,
  path, table, profile)`.
- Tool `eplan` (read) {view inspect {profile, table, path, offset?} | reconcile {profile, documentationRun, devices,
  terminals?, connections?}}; tool `eplan_change` (write) {action candidate, profile, base, sha256, documentationRun,
  path} prepares one new .csv through `commitChange` (base sha256 checked at prepare, existing path refused, profile
  without part and vera columns refused); tool `eplan_check` (write) {profile, documentationRun, exports {devices,
  terminals?, connections?}, base? {path, sha256}, candidate?, outcome?} prepares one result through
  `prepareResultChange` with criteria `source:documentation`, `devices`, `part-numbers`, `terminals`, `connections`
  and with a candidate `identity`, `unchanged`, `applied`, `outcome` (status incomplete when a source or the outcome
  fails).
- Result format 1 has an optional strict `assemblies` list (<= 16; per assembly motor, circuit, method, conditional,
  devices <= 16 {tag, role, item|null, orderCode|null, setting?}, connections <= 32 {from, to, kind power|control},
  interlocks <= 8 {kind mechanical|electrical|sequence, devices, note}); `renderResultReport` lists them.
- Tool gating: `electricalModelToolNames` (`electrical_model`, `electrical_model_change`) are offered while any plugin
  of manifest ecosystem `electrical` or `automation` is loaded (`electricalModelPlugin`); each tool of
  `electricalPluginTools` (`industrial_catalog` -> industrial-catalog, `electrical_network` -> electrical-network,
  `protection_coordination` -> protection-coordination, `motor_drives` -> motor-drives, `power_quality` -> power-quality-pfc, `lighting_design` -> lighting-design, `qelectrotech`, `qelectrotech_change`, `qelectrotech_check` -> qelectrotech, `panel_engineering`,
  `panel_engineering_check` -> panel-engineering, `electrical_documentation`, `electrical_documentation_check`,
  `electrical_documentation_export` -> electrical-documentation, `eplan`, `eplan_change`, `eplan_check` -> eplan) only
  while its own plugin ID
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
- A .qet file is read only through the strict reader: nothing named by an entity is ever opened; an unresolved
  reference is a problem, never dropped (REQ-DATA-963cbdf6, REQ-FUNC-778b9fc6, REQ-FUNC-8958b763). An electrical interlock
  passes only when every control path to the coil passes the other device's NC contact; a mechanical interlock is the
  motor_drives verdict, never the drawing; a candidate is prepared only when every check passes and only for a CURRENT
  motor-drives assembly of dol, reversing or star-delta (REQ-FUNC-07c03695, REQ-FUNC-2e3af206). A candidate is a new file;
  an edit needs the file's sha256, changes only information spans and the title and keeps every other byte and UUID
  (REQ-REL-3e094ff0, REQ-DATA-6609a3b6). Reconcile never writes the model (REQ-FUNC-3f13f78d).
- A panel check reads catalog values only as confirmed values whose conditions cover the equipment's, the largest
  counting; a missing dimension leaves the entry unplaced (unknown), a missing loss leaves the scenario's dissipation
  and air temperature unknown, never zero; an accessory or plate is compatible only when the host item lists it
  (REQ-DATA-a8bf1713, REQ-FUNC-cc5f6c3c, REQ-FUNC-0487d376, REQ-FUNC-39b7793a). The thermal estimate is the enclosure
  heat balance Ti = Te + P / (K S + V / 3.1) with S after IEC 890 (Schneider Electric catalogue p. 8/110-8/111), losses
  at rating; short-circuit withstand only from a declared assembly rating, busbars never; no IEC 61439 conformity is
  claimed (REQ-FUNC-c3a96daf, REQ-FUNC-865665b6, REQ-FUNC-f761244d). `panel_engineering_check` refuses a missing,
  foreign or stale motor_drives result and writes only a new result file (REQ-REL-665727e6, REQ-FUNC-b0b55ff0).
- Documentation lists derive only from the model, the named panel result and panel file, the named schematics and the
  named tag file; every row names its source (file sha256); differences are failed criteria and no source file is
  written; PLC tags never come from a PLC project; the revision, date and author come only from the named model document
  and are null (not stated) otherwise; content changed under the same revision fails `revision`. Exports are new files
  only and carry project, revision, run and model sha256; nothing is printed, ordered or sent (REQ-DATA-aa83ed5c,
  REQ-FUNC-68911c98, REQ-FUNC-9a06c922, REQ-FUNC-e7ad9a1c, REQ-FUNC-df08e0a4, REQ-FUNC-59134b83, REQ-FUNC-3d4e6392,
  REQ-FUNC-c0be3443).
- EPLAN tables are read only as declared by the profile: semicolon UTF-8 text with a header holding every mapped
  header once; anything else refuses the whole file. Reconcile proposes operations and never writes the model. A
  candidate is a new file that copies every unchanged base record byte for byte, changes only the part and an empty
  VERA ID cell of matched devices (an empty EPLAN part is filled), appends missing devices that have a known order
  code or model object and removes nothing; connections, terminals and macros are
  never imported. An import counts only when the outcome is a completed import of this candidate into the profile's
  project whose re-export hashes match; otherwise `outcome` fails, `identity`/`unchanged`/`applied` cannot pass and the
  run is incomplete. No EPLAN behaviour is confirmed without an installation (REQ-DATA-203d52e6, REQ-DATA-e601f922,
  REQ-FUNC-f415fdc8, REQ-FUNC-0103d4c6, REQ-FUNC-8b2ae38f, REQ-REL-803299e7).
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
| .qet reading, strict XML | electrical/xml-strict.ts, qet.ts, spec REQ-DATA-963cbdf6 | electrical/qet.test.ts |
| Templates, symbols, candidate checks | electrical/qet-templates.ts, qet-symbols.ts, qet-check.ts | electrical/qet-templates.test.ts (fixtures tests/fixtures/qelectrotech, VERA_QET_FIXTURES_UPDATE=1) |
| QET tools, edits, check result | electrical/qet-tool.ts | electrical/qet-tool.test.ts |
| Panel file format | shared panel.ts, electrical/panel-file.ts, spec REQ-DATA-a8bf1713 | electrical/panel.test.ts |
| Panel engine: BOM, placement, budget, heat, report | electrical/panel.ts | electrical/panel.test.ts (tests/support/panel_thermal_check.py) |
| Panel tools, impact, exports, draft | electrical/panel-tool.ts | electrical/panel-tool.test.ts |
| Documentation lists, checks, revision, change report | electrical/documentation.ts, spec REQ-DATA-aa83ed5c | electrical/documentation-tool.test.ts |
| Documentation exports, tag file | electrical/documentation-export.ts, documentation.ts | electrical/documentation.test.ts |
| Documentation tools | electrical/documentation-tool.ts | electrical/documentation-tool.test.ts |
| EPLAN profile, tables, reconcile, candidate, round trip | shared eplan.ts, electrical/eplan.ts, spec REQ-DATA-203d52e6 | electrical/eplan.test.ts |
| EPLAN tools | electrical/eplan-tool.ts | electrical/eplan-tool.test.ts (plant M bench electrical/plant-m.test-support.ts) |
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
- REQ-DATA-963cbdf6 — read a .qet project only from strict XML without DTD or entities.
- REQ-FUNC-778b9fc6 — map folios, symbols, conductors and potentials, unresolved references as problems.
- REQ-FUNC-8958b763 — group devices and check their cross-references.
- REQ-FUNC-3f13f78d — reconcile devices with the model as proposed operations.
- REQ-FUNC-2e3af206 — DOL, reversing and star-delta candidates from a current motor_drives assembly.
- REQ-FUNC-07c03695 — validate a candidate's connections and interlocks from its written XML.
- REQ-REL-3e094ff0 — write .qet files only through the prepared change with a base hash.
- REQ-DATA-6609a3b6 — edits as splices keeping unaffected bytes and UUIDs.
- REQ-FUNC-b21bd414 — store a QET check result stamped with the project's sha256.
- REQ-TEST-7eb1927d — self-authored QET fixtures compared byte for byte.
- REQ-DATA-a8bf1713 — accept only a strictly valid format-1 panel file.
- REQ-FUNC-a0fb1b98 — BOM reconciled with assemblies, the board's loads and devices and the schematics.
- REQ-FUNC-cc5f6c3c — an accessory only when its host's catalog item lists it.
- REQ-FUNC-a7c2c1de — terminal strips against motor terminals and schematic devices, spare.
- REQ-FUNC-4017a1ee — 24 V budget per scenario with cited derating and declared reserve.
- REQ-FUNC-0487d376 — 2D placement on rails with collisions, zones, segregation, depth and missing data.
- REQ-FUNC-39b7793a — dissipation per scenario from stated losses, unknown never zero.
- REQ-FUNC-c3a96daf — enclosure air temperature by the stated heat balance with its domain.
- REQ-FUNC-865665b6 — short-circuit withstand and busbars not evaluated without assembly data.
- REQ-FUNC-f761244d — verification report without a conformity claim.
- REQ-FUNC-b0b55ff0 — panel result stored through an approved prepared change.
- REQ-REL-665727e6 — a missing, foreign or stale motor_drives result or a non-board is refused.
- REQ-FUNC-40a5f935 — impact of a changed device on a stored panel result.
- REQ-FUNC-dd7ad54a — BOM CSV and layout SVG exports of a stored result.
- REQ-FUNC-7a0835ed — equipment draft from current assemblies.
- REQ-TEST-265439fc — cited panel fixture and an independent thermal reference.
- REQ-DATA-aa83ed5c — accept only a strictly valid documentation request and result section.
- REQ-DATA-9ca17c7a — read a declared tag file strictly or refuse it.
- REQ-FUNC-68911c98 — traceable lists from the model, the panel and the schematics.
- REQ-FUNC-9a06c922 — numbering, wire ends and duplicate connections per schematic.
- REQ-FUNC-e7ad9a1c — missing device references, assembly connections and cable ends.
- REQ-FUNC-df08e0a4 — device, terminal, I/O address and tag chain, against the tag file.
- REQ-FUNC-59134b83 — logical revision only from the model, revision conflicts.
- REQ-FUNC-cc872eff — change report against a previous run.
- REQ-FUNC-3d4e6392 — documentation result through an approved prepared change, sources untouched.
- REQ-REL-500b461c — refuse a documentation run on missing, foreign or invalid inputs.
- REQ-FUNC-c0be3443 — CSV, XLSX and PDF exports as new files with the controlled header.
- REQ-FUNC-359d4b0a — live changes since a stored documentation run.
- REQ-TEST-e9acd927 — plant M documentation reference with planted defects.
- REQ-DATA-203d52e6 — accept only a strictly valid EPLAN mapping profile.
- REQ-DATA-e601f922 — read an EPLAN exchange table strictly, keeping unmapped columns.
- REQ-FUNC-f415fdc8 — reconcile EPLAN devices, parts, terminals and connections with the documentation lists.
- REQ-FUNC-0103d4c6 — device list import candidate keeping every untouched record and cell.
- REQ-REL-f8d51ff3 — refuse an EPLAN candidate or check on a changed base or invalid inputs.
- REQ-FUNC-8b2ae38f — EPLAN check result with reconcile and round-trip criteria.
- REQ-REL-803299e7 — no import counted as applied without a completed outcome and matching re-export.

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
- `05_Software/src/libraries/core/src/electrical/xml-strict.ts` — strict span-keeping XML reader (no DTD, no entities).
- `05_Software/src/libraries/core/src/electrical/qet.ts` — QElectroTech project reader: folios, elements, conductors, potentials, devices.
- `05_Software/src/libraries/core/src/electrical/qet-symbols.ts` — self-authored QET element definitions of the templates.
- `05_Software/src/libraries/core/src/electrical/qet-templates.ts` — DOL, reversing and star-delta candidate rendering.
- `05_Software/src/libraries/core/src/electrical/qet-check.ts` — candidate, numbering, cross-reference and device-list checks, reconcile.
- `05_Software/src/libraries/core/src/electrical/qet-tool.ts` — the qelectrotech, qelectrotech_change and qelectrotech_check tools.
- `05_Software/src/libraries/core/src/electrical/qet.test.ts` — strictness refusals, mapping, legacy ids, reports, xref problems.
- `05_Software/src/libraries/core/src/electrical/qet-templates.test.ts` — templates against fixtures, mutation checks.
- `05_Software/src/libraries/core/src/electrical/qet-tool.test.ts` — candidates, refusals, edits, conflicts, check result, reconcile, plugin.
- `05_Software/tests/fixtures/qelectrotech/` — the three generated candidates (golden files).
- `05_Software/src/libraries/shared/src/panel.ts` — panel file format-1 schema (result section in electrical-model.ts).
- `05_Software/src/libraries/core/src/electrical/panel-file.ts` — panel file checks and confined reading.
- `05_Software/src/libraries/core/src/electrical/panel.ts` — the panel engine, draft, impact and exports.
- `05_Software/src/libraries/core/src/electrical/panel-tool.ts` — the panel_engineering and panel_engineering_check tools.
- `05_Software/src/libraries/core/src/electrical/panel.test.ts` — format, heat balance, losses, accessories, terminals, placement, 24 V, report.
- `05_Software/src/libraries/core/src/electrical/panel-tool.test.ts` — upstream chain, reconcile, refusals, impact, exports, draft.
- `05_Software/tests/fixtures/panel-engineering/` — cited panel catalog and the fictional plant M panel.
- `05_Software/tests/support/panel_thermal_check.py` — independent dissipation and heat-balance reference.
- `05_Software/src/libraries/core/src/electrical/documentation.ts` — tag file, list derivation, checks, revision, change report.
- `05_Software/src/libraries/core/src/electrical/documentation-export.ts` — CSV, XLSX and PDF writers.
- `05_Software/src/libraries/core/src/electrical/documentation-tool.ts` — the three documentation tools.
- `05_Software/src/libraries/core/src/electrical/documentation.test.ts` — tag file, section schema, export writers.
- `05_Software/src/libraries/core/src/electrical/documentation-tool.test.ts` — plant M lists, planted defects, revision, changes, refusals, exports.
- `05_Software/tests/fixtures/electrical-documentation/` — fictional documentation model and tag file.
- `05_Software/src/libraries/shared/src/eplan.ts` — EPLAN profile and outcome schemas, limits.
- `05_Software/src/libraries/core/src/electrical/eplan.ts` — profile, tables, tags, reconcile, candidate, check result.
- `05_Software/src/libraries/core/src/electrical/eplan-tool.ts` — the three EPLAN tools.
- `05_Software/src/libraries/core/src/electrical/eplan.test.ts` — profile, table reader, tags, record text.
- `05_Software/src/libraries/core/src/electrical/eplan-tool.test.ts` — reconcile, candidate, check, outcome, refusals, gating.
- `05_Software/src/libraries/core/src/electrical/plant-m.test-support.ts` — the plant M bench shared by the documentation and EPLAN tool tests.
- `05_Software/tests/fixtures/eplan/` — fictional EPLAN profile, device list, terminal and connection tables of plant M.

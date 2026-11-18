# Motor drives, power factor correction and lighting engines

## Routing

Select for the motor drives engine: `motor_drives`, DOL, reversing, star-delta, softstarter and VFD comparison,
acceleration model, starter and drive sizing, the result's `assemblies` connection and interlock scheme (spec
.agentic/specs/REQ-DATA-79118f9a.md, core electrical/motor-drives.ts, motor-drives-tool.ts), the power factor
correction engine: `power_quality`, measurement files `electrical-automation-measurements/<id>.json` (+ `.csv`),
displacement versus total power factor, compensation need, fixed or automatic capacitor banks, detuned steps and
resonance (spec .agentic/specs/REQ-DATA-4dc5e2c7.md, core electrical/measurements.ts, power-quality.ts,
power-quality-tool.ts), and the lighting engine: `lighting_design`, lighting projects and report records
`electrical-automation-lighting/<id>.json`, photometry files `electrical-automation-photometry/` (IES LM-63,
EULUMDAT), lumen method, utilisation and maintenance factor, direct component, DIALux evo report mapping (spec
.agentic/specs/REQ-DATA-affb2e6b.md, core electrical/photometry.ts, lighting-files.ts, lighting.ts,
lighting-tool.ts). Start at 05_Software/src/libraries/core/src/electrical/ (motor-drives.ts, power-quality.ts,
lighting.ts). Tests: core/src/electrical/{motor-drives,motor-drives-tool,measurements,power-quality,
power-quality-tool,photometry,lighting-files,lighting,lighting-tool}.test.ts. The model, the result contract with
its `assemblies` format, the industrial catalog and the tool gating belong to [electrical model](electrical-model.md); the network and protection
results these engines read, and `prepareResultChange`, belong to [network and protection engines](electrical-model-network-protection.md).

## Purpose and boundaries

Three first-party calculation engines over the electrical project model: the motor drives engine, the power
factor correction engine with its measurement files, and the lighting engine with its project, report and
photometry files. Each engine is a pure function of the model, earlier results, its input files and a request;
its write tool prepares one new result file through `prepareResultChange` and writes nothing else.

## Public interface

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

## Invariants

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

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Motor drives engine, request, criteria, scheme | electrical/motor-drives.ts, spec REQ-DATA-79118f9a | electrical/motor-drives.test.ts |
| Motor drives tool | electrical/motor-drives-tool.ts, result-change.ts | electrical/motor-drives-tool.test.ts |
| Measurement file format and reading | shared power-measurements.ts, electrical/measurements.ts, spec REQ-DATA-4dc5e2c7 | electrical/measurements.test.ts |
| PFC engine, request, criteria | electrical/power-quality.ts, spec REQ-DATA-4dc5e2c7 | electrical/power-quality.test.ts |
| PFC tool | electrical/power-quality-tool.ts, result-change.ts | electrical/power-quality-tool.test.ts |

## Key behaviors

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

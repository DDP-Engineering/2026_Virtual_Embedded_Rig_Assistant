# REQ-DATA-affb2e6b — Lighting project file, report record, photometry files, request and lighting result

## Behavior

The plugin `lighting-design` (ecosystem `electrical`) brings the skill; VERA brings the engine and the write tool
`lighting_design`, offered only while the plugin `lighting-design` is loaded (never read-only). One run reads the
electrical model (REQ-DATA-06c0bd54), ONE lighting project file, the photometry files its luminaire types name,
optionally ONE industrial catalog (REQ-DATA-d7e27def) and, at level verification, ONE report record. It prepares one new
result file `electrical-automation-results/<run-id>/result.json`. Nothing else is written; DIALux or another engine is
never started by VERA.

Two declared levels:

- `preliminary`: lumen (utilisation-factor) method estimate of the maintained average illuminance and the direct
  illuminance component on the calculation grid from the photometry. Result `preliminary: true`. Maintained
  illuminance, uniformity and glare stay `not-evaluated`; VERA never computes uniformity or UGR.
- `verification`: the same calculation plus the mapping of a report record of a demonstrated photometric engine
  (target DIALux evo) for the same room and photometry. Only this level gives `maintained-illuminance`, `uniformity`
  and `glare-ugr` verdicts, taken from the engine's values. `preliminary: false` only for a matched record of origin
  `engine` whose evidence file VERA hashed.

Engine "VERA lighting 1" (`vera-lighting-1`). Profiles `emergency` and `exterior` have their own criteria and
sources (escape routes, open areas, high-risk task areas; exterior work places, obtrusive light) and are not supported
in this delivery: such a project gives a blocked result.

## Files

Lighting projects and report records live in `electrical-automation-lighting/<id>.json` (file name = id, the
electrical ID pattern `^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$`, at most 64 characters, at most 1 MiB, ordinary file inside
the workbench). Photometry files live in `electrical-automation-photometry/<name>` with
`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(ies|IES|ldt|LDT)$`, at most 1 MiB, read as Latin-1 text. Files are read through
the workbench path guard; a symlink or a non-file is refused. VERA never writes these files; the engineer writes them
with the ordinary approved write.

### Lighting project (kind `vera-lighting-project`, format 1)

```json
{"kind": "vera-lighting-project", "format": 1, "id": "lgt-office-a", "title": "Office A (fictional)",
 "origin": "fictional", "profile": "interior", "lengthUnit": "m",
 "room": {"length": 8, "width": 6, "height": 3},
 "reflectances": {"ceiling": 0.7, "walls": 0.5, "floor": 0.2},
 "plane": {"height": 0.75, "border": 0.5, "spacing": 0.25},
 "maintenanceFactor": {"value": 0.8, "source": "user: LED, clean office, 3-year cleaning (fictional)"},
 "types": [{"id": "typ-panel", "photometry": "fict-panel.ldt", "orderCode": "FICT-P40", "load": "lod-l1"}],
 "luminaires": [{"id": "lum-1", "type": "typ-panel", "x": 1.333, "y": 1.5, "z": 2.8, "rotation": 0, "tilt": 0}],
 "requirements": [{"id": "req-office", "title": "Writing, typing, reading", "maintainedIlluminance": 500,
   "uniformityMin": 0.6, "ugrMax": 19, "source": "user-entered from the applicable standard (fictional)"}],
 "scenarios": [{"id": "scn-work", "title": "Work", "requirement": "req-office", "dimming": 1}],
 "utilisationFactors": [{"type": "typ-panel", "roomIndex": 1.5, "ceiling": 0.7, "walls": 0.5, "floor": 0.2,
   "value": 0.62, "basis": "luminaire", "source": "fictional UF table, row k = 1.5"}]}
```

- `origin`: `project` (real project data) or `fictional`.
- `profile`: `interior` | `emergency` | `exterior`.
- `lengthUnit`: `m` | `mm`; every length (room, plane, positions) is in this unit. VERA converts to metres.
- `room`: rectangular box, `length` along x, `width` along y, `height` along z; origin at a floor corner; > 0.
- `reflectances`: 0..1 each (the UF entries are matched on them exactly, to 0.005).
- `plane`: horizontal calculation plane at `height` above the floor (>= 0), `border` (>= 0) excluded at each wall,
  grid `spacing` (> 0). Points are cell centres: nx = ceil((L - 2b) / s), x_i = b + (i + 0.5)(L - 2b)/nx (same for y).
- `maintenanceFactor.value` 0 < MF <= 1 with a `source` text (user-entered; VERA has no MF table).
- `types` 1..10 `{id, photometry, orderCode?, load?}`: `load` is a model `load` with attribute `category: lighting`.
- `luminaires` 1..500 `{id, type, x, y, z, rotation, tilt}`: `z` is the photometric centre height above the floor;
  `rotation` (degrees, any value) turns the C0 direction from +x toward +y about the vertical; `tilt` (0..180 degrees)
  tips the nadir toward the luminaire's C0 direction. C angles count counter-clockwise seen from above.
- `requirements` 1..8 `{id, title, maintainedIlluminance (lx > 0), uniformityMin? (0..1), ugrMax? (5..40), source}`:
  values the engineer enters from the applicable standard and edition; VERA ships no standard table.
- `scenarios` 1..8 `{id, title, requirement, luminaires? (IDs; default all), dimming? (0 < d <= 1, default 1)}`.
- `utilisationFactors` 0..200 `{type, roomIndex (> 0), ceiling, walls, floor, value (0 < UF <= 1.5), basis luminaire|lamp,
  source}`: cited utilisation factors, typically one manufacturer UF table row per room index.
- IDs are unique across the file; references must resolve.

### Report record (kind `vera-lighting-report`, format 1)

The mapped values of one photometric engine report for one lighting project. The assisted flow: the engineer builds
the same room in the engine from the project data and the same photometry files, calculates there, exports the
report, and the agent or engineer transcribes it into this record (approved write). VERA checks the record; it does
not parse proprietary files.

```json
{"kind": "vera-lighting-report", "format": 1, "id": "rep-office-a", "project": "lgt-office-a", "origin": "fictional",
 "engine": {"name": "DIALux evo", "version": "13.1"},
 "evidence": {"path": "electrical-automation-lighting/office-a-report.pdf", "sha256": "<64 hex>"},
 "mapping": "Report page 'Results overview', table 'Calculation objects'; values copied as printed.",
 "room": {"length": 8, "width": 6, "height": 3}, "lengthUnit": "m", "maintenanceFactor": 0.8,
 "photometry": [{"type": "typ-panel", "file": "fict-panel.ldt"}],
 "surfaces": [{"scenario": "scn-work", "name": "Working plane", "height": 0.75, "border": 0.5, "luminaires": 12,
   "average": 540, "minimum": 360, "maximum": 610, "uniformity": 0.67, "ugr": 18.2}]}
```

- `origin`: `engine` (values from a real engine export) | `fictional`.
- `evidence` (optional): a workbench file (at most 64 MiB) whose sha256 VERA computes and compares.
- `surfaces` 1..8, one per scenario: `average` (lx), `minimum` (lx), `maximum` (lx, optional), `uniformity`
  (Emin/Eavg, optional - else minimum/average), `ugr` (number or null when the report gives none).

## Photometry (validated domain)

- IES LM-63: a leading UTF-8 byte order mark is ignored; optional first line `IESNA:LM-63-1995`, `IESNA:LM-63-2002`, `IES:LM-63-2019` (or `IESNA91`); keyword lines
  `[KEY] value` (`[MANUFAC]`, `[LUMINAIRE]`, `[LUMCAT]` are kept); `TILT=NONE` only. Numbers: lamps, lumens per lamp
  (-1 = absolute photometry), candela multiplier, vertical count, horizontal count, photometric type (1 = C only),
  units type (1 feet, 2 metres), width, length, height (absolute value; negative = round), ballast factor, ballast-lamp
  factor (files without header, 1991, 1995) or future use (2002/2019, ignored), input watts, vertical angles (0..90, 0..180 or
  90..180, ascending), horizontal angles (first 0, last 0 / 90 / 180 / 360), candela per horizontal angle. Candela x
  multiplier x ballast factor x ballast-lamp factor.
- EULUMDAT: the fixed line layout (company, Ityp, Isym, Mc, Dc, Ng, Dg, report, name, number, file, date, dimensions in
  mm, DFF, LORL %, conversion factor, tilt during measurement, lamp sets with count/type/flux/colour/CRI/watts, 10
  direct ratios, Mc C angles, Ng gamma angles, intensities in cd/klm). Isym 0 (Mc planes), 1 (one plane), 2 (C0..C180),
  4 (C0..C90); Isym 3 is outside the domain. Candela = value x conversion factor x lamp flux of set 1 / 1000; a
  negative lamp count means absolute photometry (flux of set 1 is the luminaire flux).
- Symmetries expand to the full C range: rotational; quadrant I(180-C) = I(180+C) = I(360-C) = I(C); bilateral
  I(360-C) = I(C); full (periodic, 360 = 0). Intensity between stored angles: bilinear; outside the gamma range: 0.
- Luminaire flux: integral of I dOmega with 1-degree C steps and 0.5-degree gamma zones over the interpolated
  distribution. Lamp flux: lamps x lumens per lamp (IES) or set-1 flux (LDT); null for absolute photometry. Light output
  ratio = luminaire flux / lamp flux.

## Request (`lighting_design` arguments)

```json
{"project": "lgt-office-a", "level": "verification", "report": "rep-office-a", "catalog": "cat-lighting",
 "scenarios": ["scn-work"]}
```

`level` `preliminary` | `verification`; `report` required at verification and forbidden at preliminary; `catalog`
required when a type has an `orderCode` that should be checked (without it the catalog criterion is not-evaluated);
`scenarios` 1..8 IDs of the project (default all).

## Catalog convention (industrial catalog)

A luminaire item: family category `luminaire`; attribute `photometry` (file name); parameters `luminousFlux` (lm,
luminaire flux) and `activePower` (W, input power), each cited. Selection uses `findItems` by exact order code.

## Method

1. Profile: `emergency` or `exterior` -> criterion `profile` (subject project) not-evaluated, status `blocked`,
   nothing else.
2. Geometry (subject project), `geometry` criterion: room length/width in 0.5..500 m, height in 1.5..100 m, plane
   height below the room height, 2 x border below length and width. Outside -> fail ("check the length unit") and
   every scenario blocked. Grid above 10000 points -> refused.
3. Photometry per type, `photometry` criterion (subject type): fail for a relative photometry with light output
   ratio above 1.05, or an EULUMDAT file whose integrated flux differs from lamp flux x LORL by more than 5 %; a failed
   type blocks the scenarios that use it. Messages for a luminaire dimension above 5 m ("check the units") and a missing
   input power (efficacy unknown). A missing, unparsable or lightless file (zero integrated flux) refuses the run.
4. Catalog per type with order code, `catalog` criterion (subject type): category luminaire, `photometry` attribute =
   file name, `luminousFlux` and `activePower` within 10 % of the photometry's flux and input watts; a value that is
   absent or extracted -> unknown; no request catalog -> not-evaluated.
5. Placement per luminaire, `placement` criterion (subject luminaire) emitted only on failure: x or y outside the room,
   z above the room height, z at or below the plane. A failed placement blocks the scenarios that use the luminaire.
6. Direct component per scenario: E_i = sum MF d I(C, g) cos(theta) / r^2 over the scenario's luminaires above the
   plane, theta the incidence angle on the upward horizontal plane. A luminaire whose mean contribution is below 1 % of
   the scenario's mean per luminaire is named in a message ("almost no direct light to the plane: check rotation, tilt
   or the photometry orientation").
7. Lumen method per scenario: hm = z - plane height (all luminaires within 1 cm, else unknown); k = L W / (hm (L + W));
   UF from entries of each type with the room's reflectances: exact k (to 0.005) or linear between the nearest lower
   and higher k; E = sum_types N_t Phi_t UF_t MF d / (L W), Phi_t the luminaire flux (basis luminaire) or lamp flux
   (basis lamp; unknown for absolute photometry); luminaires needed = ceil(Em A / (Phi UF MF d)) for a single-type
   scenario.
8. Verification (level verification): the record's surface for the scenario; match = room length/width/height within
   1 % (after unit conversion), plane height and border within 0.01 m, MF within 0.005, the same photometry file per
   type, the scenario's luminaire count, and the evidence sha256 when given (reflectances and positions are not in the
   record and are not compared - a stated limit). Consistency: engine average >= 0.95 x VERA direct average. A record
   without a surface for the scenario fails report-match and leaves the scenario's verdicts not-evaluated.

## Result (`producer` `lighting-design` / `lighting`, method `vera-lighting-1`)

- `method.title`: "Lighting - preliminary lumen-method estimate and direct component" or "Lighting - verification
  against a photometric engine report"; `catalog` `{id, version}` when a catalog was read.
- `inputs`: the model project and every model load named by a type.
- `conditions`: `level`, `profile`, `lengthUnit`, `maintenanceFactor` (1), `planeHeight` (m), `gridSpacing` (m),
  `engine` and `reportOrigin` (verification).
- `sources`: the lighting project, each photometry file and the report record with their sha256; the MF, UF and
  requirement source texts.
- Intermediate - project: `roomArea` (m²); type: `luminaireFlux` (lm), `lampFlux` (lm), `inputPower` (W), `efficacy`
  (lm/W), `lightOutputRatio` (1); scenario: `luminaireCount` (1), `mountingHeight` (m), `roomIndex` (1),
  `utilisationFactor` (1), `estimatedAverageIlluminance` (lx), `luminairesNeeded` (1), `gridPoints` (1),
  `directIlluminanceMin`/`Average`/`Max` (lx), `installedPower` (W, undimmed), `powerDensity` (W/m²); verification:
  `reportAverage`, `reportMinimum` (lx), `reportUniformity`, `reportUgr` (1).
- Criteria: `profile`, `geometry` (project); `photometry`, `catalog` (type); `placement` (luminaire); per scenario
  `estimated-average-illuminance` (preliminary estimate vs Em: pass/fail/unknown), `maintained-illuminance`,
  `uniformity` (only when the requirement gives U0), `glare-ugr` (only when it gives UGR max), and at verification
  `report-match` and `report-consistency`.
- `status`: `blocked` for an unsupported profile, failed geometry or every scenario blocked; `completed` when every
  criterion is pass or fail; otherwise `incomplete`.
- Texts are cut to the result format's limits (sources 200, notes and messages 1000 characters); placement failures
  beyond 20 are summarised in one `placement` criterion of the project; a blocked note names 5 blockers and "and N more".
- `limits`: preliminary level statement, report-match without reflectances and positions, direct-only grid, rectangular rooms, no daylight, no VERA uniformity/UGR,
  file freshness not tracked (sha256 in sources).

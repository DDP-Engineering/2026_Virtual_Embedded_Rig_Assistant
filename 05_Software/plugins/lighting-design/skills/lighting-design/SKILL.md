---
name: lighting-design
description: Design and check interior lighting - write a lighting project from the room and luminaire data, collect IES or LDT photometry and cited utilisation factors, run lighting_design for a preliminary lumen-method estimate and direct component, fix the diagnostics, and verify with a photometric engine report such as DIALux evo through the assisted flow. Use when asked about illuminance, lux levels, luminaire layout, lumen method, utilisation or maintenance factor, IES/LDT files, uniformity, UGR or DIALux.
---

The host tool `lighting_design` evaluates and stores a result; it never changes a file and never starts DIALux or
another engine.

## 1. Write the lighting project

Write `electrical-automation-lighting/<id>.json` (kind `vera-lighting-project`, format 1, approved write). Ask the user
for every value that is not on a drawing or datasheet - never guess:

- `lengthUnit` (`m` or `mm`) and the rectangular `room` (length along x, width along y, height); the origin is a floor
  corner. Use one unit for every length in the file.
- `reflectances` of ceiling, walls and floor (0..1); the `plane` height, border and grid spacing.
- `maintenanceFactor` with its `source` (the user's maintenance schedule; VERA has no MF table).
- `requirements`: maintained illuminance, and if they apply uniformity and UGR limit, typed by the user from the
  standard and edition that apply to the project, with that `source`. Never copy a standard's table.
- luminaire `types` (photometry file, optional `orderCode` of a catalog item, optional model `load` with
  `category: lighting`), `luminaires` with x, y, photometric-centre height z, `rotation` (C0 from +x toward +y) and
  `tilt` (0 = pointing down), and `scenarios` (requirement, luminaires, dimming).
- `utilisationFactors` only from the manufacturer's UF table for that luminaire, with the row as `source`; mark
  fictional data `origin: fictional`.

## 2. Collect the photometry

Put the manufacturer's `.ies` or `.ldt` files, unchanged, in `electrical-automation-photometry/`. Ask the user where
they come from and whether their terms allow use; never download one without the user's go-ahead. A luminaire item in
an industrial catalog (category `luminaire`, attribute `photometry`, cited `luminousFlux` and `activePower`) lets VERA
check the file against the datasheet.

## 3. Run the preliminary level

`lighting_design {"project": "<id>", "level": "preliminary", "catalog": "<id>"}`. Explain:

- the room index, the utilisation factor and its source, the estimated maintained average and the luminaires needed;
- the direct component on the grid as a lower bound only - never call it the illuminance or the uniformity;
- each failed `geometry`, `placement`, `photometry` or `catalog` criterion and the messages (wrong length unit,
  luminaire outside the room or above the ceiling, a luminaire that gives almost no direct light, impossible light
  output ratio, IES units) and what to fix;
- that maintained illuminance, uniformity and UGR stay not-evaluated until an engine report is verified.

## 4. Verify with DIALux evo (assisted flow)

VERA has no interface to DIALux: no headless run, no project or STF file. The engineer, in DIALux evo on Windows:
builds the same room (dimensions, reflectances, calculation surface with the same height and border), inserts the same
IES/LDT files at the project's positions and orientations, sets the same maintenance factor, calculates each scenario
and exports the report. Then write `electrical-automation-lighting/<id>.json` (kind `vera-lighting-report`): `origin:
engine`, the DIALux version, `evidence` = the exported report in the workbench with its sha256, `mapping` = the page
and table the values come from, and per scenario the surface's average, minimum, maximum, uniformity and UGR (null
when the report gives none), copied as printed. Run `lighting_design` with `"level": "verification", "report":
"<id>"` and explain the `report-match` and `report-consistency` criteria before the verdicts. A mismatch means the
engine calculated another room - fix the model in DIALux, never the record's values.

Emergency and exterior lighting are separate profiles and are not supported yet; say so instead of estimating them.
Preliminary results are engineering support, not a verified design and no conformity statement.

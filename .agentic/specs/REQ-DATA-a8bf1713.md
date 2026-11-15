# REQ-DATA-a8bf1713 - Panel file and panel engineering

Panel engineering turns a board of the electrical model, the current motor_drives assemblies, optional
QElectroTech schematics and the industrial catalogs into a checked control-panel design: a BOM with accessories,
terminal strips, 24 V supply budgets, a 2D arrangement on rails, dissipation, a thermal estimate and an assembly
verification report. Plugin `panel-engineering`, producer `panel-engineering` / `panel`, engine `vera-panel` 1.0.0.

## Behavior

### Panel file

`electrical-automation-panels/<id>.json`, UTF-8 JSON, at most 1 MiB, read through PathGuard. Strict: kind
`vera-panel`, format 1, no unknown keys, no defaults. Geometry numbers are millimetres on the mounting plate, origin
at the plate's top-left corner, x to the right, y downwards. Problems are `{path, message}`, at most 20, thrown as
`Invalid panel file <id>: <path>: <message>; ...`.

Semantic checks after the schema: the file name equals `id`; one tag namespace across equipment, terminal strips,
rails, ducts, zones and rules; a rail's `zone`, an equipment's `rail`, `mountedOn` (another equipment, not itself,
not mounted itself), `supply` (another equipment), a terminal strip's `rail`, a segregation rule's two zones, a
scenario's `active` tags (equipment or strips) and every `source.id` (panel `sources`) exist; `mountedOn` and `rail`
/ `x` exclude each other; `mounting` is given exactly with `mountedOn`; `x` needs `rail`; a quantity's unit belongs to
the dimension of its property name (units.ts `knownProperties`).

### Catalog values

Every catalog value is read only from items of the catalogs the panel names (`catalogs`, each read with
`readCatalogFile`) or of the motor_drives result's catalog for assembly comparison. A value is usable when its
status is `confirmed`; with several values the ones whose conditions cover the equipment's `conditions` (restricted to
the keys the value names; text by folded equality, numbers by exact/Min/Max as in catalog selection) are kept, and the
largest counts (the conservative choice). Equipment `declared` quantities stand in for missing catalog values and are
listed as assumptions; a `null` value stays unknown. Text taken from files into notes (QET labels, catalog names)
loses control characters and is cut to 60 characters per list item; ids and titles to 200, notes to 1000.

### BOM and reconciliation

One BOM line per equipment (file order) and per terminal strip, with fingerprint sha256 of
`canonicalJson({entry, item, model, motor})` (panel entry, catalog item, model object and motor object or null).
Criteria:

- `bom-items` (one for all lines): fail naming the lines whose catalog or item is missing, else unknown naming the
  lines without item (order code unknown), else pass.
- `assembly:<motor ref>`: every device of the motor's assembly (motors = distinct `motor` of equipment) is an entry with
  that motor and `schematicTag ?? tag` equal to the device tag; item must equal the assembly's item in the result's
  catalog. Missing entries or other items fail; an assembly device without item is unknown.
- `model-loads`: every motor or load fed (feeds) by a circuit fed by the board is covered by a panel motor or an
  equipment `model`/`motor` or an `excluded` entry; otherwise fail naming the refs.
- `model-devices`: every device, protection or terminal object the board contains is an entry by `model` ID or `tag`
  equal to its ref; otherwise fail.
- `schematic:<path>`: each labelled QET device (labels compared trimmed and case-folded, reported as drawn) other than the scoped motor's own ref matches an entry
  (with the scoped motor: `motor` equal and `schematicTag ?? tag` equal; or no motor and `tag` equal) or a strip
  label; each entry of the scoped motor that is not mounted on a host must be drawn. Differences fail.

### Accessories

`accessory:<tag>` for each mounted equipment and `accessory:plate` for the enclosure's plate: pass only when the
host's (enclosure's) catalog item lists the accessory's item in `accessories` (citing role and note); unknown
otherwise. A mounted equipment adds to the host's footprint: `mounting: below` adds its height under the host,
`side` adds its width to the right; unknown dimensions make the host's placement unknown.

### Terminals

Strip width = (count + spare) x the item's `width`; height and depth from the item. Required terminals: for a strip with
`motor`, the distinct terminals of `to` endpoints `motor` / `motor:<list>` in that motor's assembly connections (a bare
`motor` counts 3); for a strip whose tag equals a schematic label (in a schematic scoped to the strip's motor or
unscoped), the connected terminals of that device's elements. `terminals:<strip>` passes when count >= every
requirement, fails when smaller, unknown when none applies. `terminal-spare:<strip>` passes when spare >=
ceil(count x reserve.terminalsPercent / 100).

### Placement

Plate size = the plate item's `width` x `height`. A rail is horizontal from (x, y) to (x + length, y), inside its
zone and the plate (checked by the engine, criterion `rail:<id>` fail). Placement order: per rail, pinned entries
(`x` = offset from the rail start), then the others in file order at the first free offset (a `gap` from the rail's
`gap` on each side between neighbours); an entry without `rail` goes to the first rail (file order) whose zone accepts
its `class` and still has room. Footprint: x-span [offset, offset + w], y-span [y - h/2, y + h/2]. Criteria
`placement:<tag>` (only when not passing): fail on overlap with another footprint, a duct or a keep-out area, outside the plate, beyond the
rail end (pinned) or no rail with room (auto), on a zone that does not accept the class; unknown when a dimension is
missing (left unplaced); it also fails when depth + rail profile height (7.5 or 15 mm from `TH35-7.5`/`TH35-15`) <=
`mountingDepth`. `layout` sums them up (fail, else unknown, else pass). `segregation:<rule>`: fail when the smallest gap
between placed footprints in the two zones is below `distance`; otherwise unknown while an entry on a rail of either
zone, or without a rail, is not placed; pass otherwise. `reserve-rails`: fail when total free length / total rail
length < reserve.railPercent, otherwise unknown with any unplaced entry, else pass. Rail positions: `rails[].tag`. Door and field equipment is not placed.

### 24 V supply

A supply is an equipment named by some entry's `supply`. Per scenario (active = `active` or all) and supply:
load = sum of active consumers' `powerConsumption` / supply `outputVoltage`, or their stated `current`. Available = `outputCurrent`
whose `ambientTemperatureMax` condition >= Ti; above it, derated by `ambientDeratingPerKelvin` within its
`ambientTemperatureMin..Max` conditions: I x (1 - f x (Ti - Tmin)); outside: unknown. Ti is the scenario's air
temperature (or the declared ambient without thermal block: unknown). `supply:<tag>:<scenario>` passes when load <=
available x (1 - reserve.supplyPercent / 100). Values `supplyLoad:<tag>:<s>`, `supplyAvailable:<tag>:<s>` (A).

### Dissipation

Per scenario, active plate and door equipment: `powerLoss`, else `powerLossPerPole` x poles (parameter `poles`, else
attribute `poles` like `3P`), plus `coilPowerLoss` (required when the item states a `controlVoltage`: it has a coil); a supply: Pout x (1/eta - 1) with eta = the smallest
`efficiency`, else its `powerLoss`; a 24 V consumer without loss values: its consumption or current x output voltage; a supply's
efficiency counts only within (0, 1]. Mounted accessories count
like the others. Plus `thermal.wiringLoss` when declared. Any active entry without a value makes `dissipation:<s>`
null and its criterion unknown naming the tags. Values `dissipation:<s>` (W), `loss:<tag>` (W, non-supply entries).

### Thermal

Method `enclosure-heat-balance`: S (m2) from the enclosure item's height H, width W, depth D (m) by installation:
free-standing 1.8H(W+D)+1.4WD; wall 1.4W(H+D)+1.8DH; end-free 1.4D(H+W)+1.8WH; end-wall 1.4H(W+D)+1.4WD; middle
1.8WH+1.4WD+DH; middle-wall 1.4W(H+D)+DH; middle-wall-covered 1.4WH+0.7WD+DH (Schneider Electric enclosure catalogue,
Thermal management system, p. 8/110, after IEC 890). dT = P / (K x S + V / 3.1), V the fan's `airflow` (m3/h, 0
without fan), 3.1 m3*K/(W*h) (p. 8/111). Ti = Te,max + dT. Limit = min(declared internalTemperatureMax, each active
plate/door entry's and terminal strip's largest `ambientTemperatureMax`); an entry without it makes the verdict unknown unless Ti already
exceeds a known limit (fail). A heat-transfer coefficient <= 0 makes the panel file invalid; a non-finite
rise is unknown. `thermal:<s>` pass/fail/unknown; not-evaluated without `thermal`. Values
`effectiveSurface` (m2), `temperatureRise:<s>` (K), `internalTemperature:<s>` (degC). Limits stated: mean air
temperature (the top is warmer), no solar radiation, losses at rating, air at sea level, the fan case only meaningful
when Ti >= Te + 5 K.

### Short-circuit and busbars

`short-circuit-withstand`: not-evaluated without `assembly.shortCircuitRating`; otherwise pass when rating >= the
network result's `ik3Max` of the board (the run named by the protection result the motor_drives result names), unknown
when absent; the note says the rating is declared, not verified. `busbars`: always not-evaluated.

### Verification report

Thirteen characteristics: strength of materials and parts; degree of protection of enclosures; clearances; creepage
distances; protection against electric shock and integrity of protective circuits; incorporation of switching devices
and components; internal electrical circuits and connections; terminals for external conductors; dielectric
properties; temperature-rise limits; short-circuit withstand strength; electromagnetic compatibility; mechanical
operation. Each: `{characteristic, method, evidence: criterion IDs, state: partial | not-covered}`. Partial:
incorporation (catalog data, placement, depth, accessories), terminals (terminal checks), temperature rise
(enclosure heat balance), short-circuit (only with a declared rating). Limits: "No IEC 61439 conformity is claimed".

### Result

Status `completed`, or `incomplete` with any unknown or not-evaluated criterion; preliminary true; inputs = the board,
its circuits and their fed objects, contained objects, excluded and `model` objects; sources `panel:<path>@sha256:<hex>`,
`catalog:<id>@sha256:<hex>`, `qet:<path>@sha256:<hex>`, `motor-drives:<run>`. Optional result section `panel`:
{id, path, board, frame (sha256 of the file without equipment and strips), plate {width, height} | null, bom[] {tag,
kind equipment|strip, role, location, catalog, item, orderCode, manufacturer, name, motor, mountedOn, supply,
scenarios, sha256}, rails[] {tag, x, y, length, used | null}, zones[], ducts[], placements[] {tag, rail | null, x, y, width,
height | null, state placed|unplaced|mounted|door|field}, verification[] (evidence limited to stored criteria)}. Over
200 criteria, passing ones are left out first.

### Tools

`panel_engineering` (read) {view draft|impact|export, motorDrivesRun?, motors?, runId?, format? bom-csv|layout-svg}.
Impact: changed/added/removed tags, `frameChanged`, `schematics` (stored `qet:` sources whose file changed or is
missing), affected {bom, layout (rails of changed entries; all rails when the frame changed or an entry is placed
automatically), supplies (a changed supply in every scenario, a consumer where active, every supply in each scenario
whose air temperature may change), dissipation, thermal (also a changed strip's scenarios), verification}. Draft tags
are `<tag>-<motor ref>` whenever the run has several assemblies. CSV: comma-separated, a field quoted when it holds a
comma, quote, semicolon or line break, a cell starting with = + - @ prefixed with '. SVG: viewBox the plate in mm, 12 mm
added below for the list of unplaced tags.
`panel_engineering_check` (write) {panel, motorDrivesRun, schematics? <= 8 {path, motor?}}. Both offered only while
plugin `panel-engineering` is loaded; the write tool never in read-only sessions.

## Examples

Published example: 2000 x 800 x 400 mm against a wall, K 5.5, 800 W: S = 4.128 m2, dT = 35.24 K.
Mounted LRD21 under LC1D18P7: the footprint height 77 + 66 = 143 mm, width 45 mm.

## Acceptance

The requirement verifications of REQ-DATA-a8bf1713, REQ-FUNC-a0fb1b98, -cc5f6c3c, -a7c2c1de, -4017a1ee, -0487d376,
-39b7793a, -c3a96daf, -865665b6, -f761244d, -b0b55ff0, -40a5f935, -dd7ad54a, -7a0835ed, REQ-REL-665727e6 and
REQ-TEST-265439fc hold.

## Assumptions and open decisions

Device losses at rating (upper bound); devices centred on the rail; a mounted accessory stacks its whole height or
width onto the host (conservative); door devices count in the dissipation. Dimensions and losses of LAD9V2, fuse
holders for C10G and a star-delta timer are not in reachable cited data and stay missing in the fixture.

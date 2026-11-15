# panel-engineering

Control panel engineering on VERA's electrical project model: a checked equipment list, terminals, 24 V supply, a 2D
arrangement on rails, dissipation and the enclosure air temperature, with an assembly verification report that keeps
uncovered checks visible.

- **The panel file** `electrical-automation-panels/<id>.json` (format 1, written by the engineer) names the model's
  board, the catalogs, the enclosure and its mounting plate (catalog items), zones with the classes they accept, the
  documented rules (segregation distance between two zones, keep-out areas, each with its source), rails (position,
  length, TH35 profile, gap), ducts, equipment (tag, catalog item or none, role, class, plate/door/field, rail and
  position, host for a mounted accessory, motor and schematic tag, 24 V supply, conditions selecting catalog values,
  declared values for missing data), terminal strips, scenarios, the declared reserve, thermal conditions (maximum
  ambient, heat-transfer coefficient, optional fan, wiring loss) and declared exclusions. Geometry is in mm on the plate.
- **The tool `panel_engineering_check`** (write) reads the model, the panel file, its catalogs, a CURRENT `motor_drives`
  result (and the network result it chains to) and optional `.qet` schematics, and stores one result in
  `electrical-automation-results/<run-id>/`: BOM lines, reconciliation with the assemblies, the board's loads and
  devices and each schematic's labels; accessories (an accessory or the plate counts as compatible only when the host's
  catalog item lists it); terminal counts against motor terminals and schematic devices, spare; the 24 V budget per
  scenario with the cited derating; placements with collisions, ducts, keep-out areas, zones, depth and segregation;
  dissipation and air temperature per scenario; short-circuit withstand only from a declared assembly rating; busbars
  never; the verification report of the thirteen design verification characteristics.
- **The tool `panel_engineering`** (read) - `draft`: equipment entries from the assemblies of a current motor_drives
  result with the accessories their items list; `impact`: which BOM lines, rails, 24 V budgets, dissipation and thermal
  scenarios of a stored result a changed device, panel or model affects; `export`: the stored BOM as CSV or the layout
  as SVG (mm).
- **Skill**: `panel-engineering`, from motor results to a checked panel file and its result.

The thermal estimate is the enclosure heat balance of the Schneider Electric enclosure catalogue (Thermal management
system, pp. 8/110-8/111; effective surfaces after IEC 890): the mean air temperature, losses at their stated rating.
Results are preliminary engineering support: no verified design, no IEC 61439 conformity, no 3D layout or machining
data. The exact formats are the specifications REQ-DATA-a8bf1713 and REQ-DATA-06c0bd54 in VERA's `.agentic/specs/`.

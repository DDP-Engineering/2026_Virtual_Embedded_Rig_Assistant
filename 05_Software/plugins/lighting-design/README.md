# lighting-design

Interior lighting for a room of VERA's electrical project: a preliminary estimate from photometry files, and the
verification of a photometric engine's report (target DIALux evo) for the same room.

- **The tool `lighting_design`** is VERA's own write tool, offered only while this plugin is loaded (never in read-only
  sessions). It reads `electrical-automation-model.json`, one lighting project in `electrical-automation-lighting/`,
  the photometry files in `electrical-automation-photometry/`, optionally one catalog in
  `electrical-automation-catalogs/` and, for verification, one report record. It stores a new
  `electrical-automation-results/<run-id>/result.json` after approval, like a file write, with copies of the model
  project and of the lighting loads its luminaire types name. It changes no file and starts no engine.
- **Lighting project** `<id>.json` (kind `vera-lighting-project`, format 1): origin (project or fictional), profile,
  the declared length unit (m or mm), a rectangular room, ceiling/wall/floor reflectances, the calculation plane
  (height, border, grid spacing), the maintenance factor with its source, luminaire types (photometry file, optional
  order code and model load), luminaires (x, y, z, rotation, tilt), requirements entered by the engineer from the
  applicable standard with their source, scenarios (requirement, luminaires, dimming) and cited utilisation factors.
- **Photometry**: IES LM-63 (1995, 2002, 2019; type C; TILT=NONE) and EULUMDAT (symmetry 0, 1, 2 or 4). Other files
  are refused with the reason.
- **Preliminary level**: room index, utilisation factor from the cited entries (linear between two tabulated room
  indices), estimated maintained average illuminance and luminaires needed; the direct component on the grid
  (minimum, average, maximum); installed power and power density. Diagnostics: room size outside plausible limits
  ("check the length unit"), luminaires outside the room, above the ceiling or below the plane, a luminaire giving
  almost no direct light (rotation, tilt or photometry orientation), photometry with an impossible light output ratio,
  luminaire dimensions that suggest the wrong IES units, catalog flux or power that disagree with the photometry.
  Maintained illuminance, uniformity and glare stay not-evaluated.
- **Verification level** with a report record `<id>.json` (kind `vera-lighting-report`, format 1): the engine, origin
  (engine or fictional), an optional evidence file (the exported report, hashed by VERA), the mapping, and the room,
  maintenance factor, photometry files and per scenario the surface's average, minimum, maximum, uniformity and UGR.
  VERA checks that it matches the project and only then gives the maintained-illuminance, uniformity and glare
  verdicts; it compares the engine average with its own direct component.
- **DIALux evo** (assisted flow, Windows): VERA does not start DIALux, has no headless interface to it and writes no
  DIALux or STF project. The engineer builds the room in DIALux evo from the project values and the same IES/LDT
  files, calculates, exports the report, and the record is written from that report (approved write).
- **Skill**: `lighting-design`, the workflow from the data to a reviewed result.

Results at the preliminary level are engineering support, not a photometric verification and not a conformity
statement. Emergency and exterior lighting are separate profiles with their own criteria and are not supported yet.
The exact formats are the specifications REQ-DATA-affb2e6b, REQ-DATA-d7e27def and REQ-DATA-06c0bd54 in VERA's
`.agentic/specs/`.

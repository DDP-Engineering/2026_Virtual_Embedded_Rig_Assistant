# qelectrotech

QElectroTech schematics for VERA's electrical project model: strict reading of native `.qet` projects, schematic
candidates for the PWR motor starters and checks of numbering, cross-references and the device list.

- **The tool `qelectrotech`** (read) reads a `.qet` file of the workbench with a strict XML reader that refuses every
  document type declaration, entity and processing instruction (no XXE). Views: `project` (version, folios, counts,
  problems), `devices` (a coil or other master with its linked contacts, each with folio and column/row position),
  `potentials` (terminals joined by conductors and folio reports, with conductor numbers) and `reconcile` (device labels
  against the model's visible references and the QET UUID recorded in `attributes.qetUuid`, with the
  `electrical_model_change` operations that record them - never applied by this tool).
- **The tool `qelectrotech_change`** (write) - `candidate`: a new `.qet` file for one motor of a CURRENT `motor_drives`
  result whose assembly is DOL, reversing or star-delta (stale results and other methods are refused). Folio 1 draws
  the assembly's power connections phase by phase (supply X0, Q1, contactors, F1, motor); folio 2 is the method's
  control circuit (X1 L/N, F1 95-96, S0, start buttons with seal-in, interlock NC contacts, coils, for star-delta the
  timer KT1). The written XML is read back and checked before the preview: each phase on its own potential, every
  electrical interlock as an NC contact on every path to the coil, F1's NC on every coil path, the star point, the
  contact links. The mechanical interlock is the motor_drives verdict, never the drawing. `edit`: element information
  (label, comment, manufacturer_reference, ...) by element UUID and the project title, with the file's base sha256;
  only those text spans change, every other byte and every UUID stays.
- **The tool `qelectrotech_check`** (write) stores one result in `electrical-automation-results/<run-id>/`: project
  read, labels, conductor numbering (one number per potential, distinct across potentials), cross-references, the
  device list against the model and, with `motorDrivesRun` + `motor`, the candidate checks; it names the `.qet` file's
  sha256 and goes stale when a compared model object changes.
- **Element symbols** of the templates are self-authored (category `embed://import/vera/`); no element of QElectroTech's
  collection is copied.
- **Skill**: `qelectrotech-schematics`, from a motor result to a checked candidate and a mapped model.

QElectroTech itself is not started by VERA: its command line (0.90, 0.100) only opens files and prints its version,
with no headless export. Open the candidates in QElectroTech, inspect them, number the conductors there and save.
Results are preliminary engineering support: no verified design and no validated safety function. The exact formats
are the specifications REQ-DATA-963cbdf6 and REQ-DATA-06c0bd54 in VERA's `.agentic/specs/`.

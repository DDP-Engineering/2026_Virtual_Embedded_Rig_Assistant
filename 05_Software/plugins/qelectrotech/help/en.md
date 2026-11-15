# QElectroTech schematics

QElectroTech schematics lets the agent read your QElectroTech projects (.qet) and work with them next to the electrical project model. It lists folios, devices with their linked contacts and cross-references, and the potentials joined by conductors, and it maps the devices to the model's references. For a motor with a current motor-starting result it drafts a two-folio schematic (power and control circuit) from the DOL, reversing or star-delta template and checks it before you approve it. It also relabels elements in an existing project and stores a check of numbering, cross-references and the device list.

## What it needs

- **No program.** The agent uses VERA's built-in tools `qelectrotech`, `qelectrotech_change` and `qelectrotech_check`, which are offered only while this plugin is enabled. There is nothing to install or download, so **Install dependencies** has nothing to do here.
- QElectroTech itself (tested with 0.100 on Windows and 0.90 on Ubuntu) to open, inspect, number and save the projects. VERA never starts it: QElectroTech has no command-line export.
- For a candidate: a current motor-starting result (plugin Motor starting and drives) whose method is DOL, reversing or star-delta.

## How to use it

- "Read schematics/plant.qet and list its folios and any problems." (skill `qelectrotech-schematics`)
- "Which contacts belong to KM1, and on which folio and column are they?"
- "Draft the star-delta schematic for pump M2 from the latest motor result."
- "Rename KM1 to KM10 in the project I just saved."
- "Check the numbering and cross-references and compare the device list with the model."
- "Record the QElectroTech devices in the electrical model."

Candidates are new files. A check result is stored in `electrical-automation-results/<run-id>/` with the project file's hash; if the model changes, it is marked stale.

## Risk and approvals

`qelectrotech` only reads. `qelectrotech_change` and `qelectrotech_check` are write tools: they ask for your approval like a file write and are not offered in Read-only sessions. A candidate is never written over an existing file; an edit names the hash of the file it read and fails if the file changed meanwhile, so nothing you saved in QElectroTech is overwritten. Only the edited texts change; every other byte stays. The electrical model is changed only through the model tool, with your approval. There are no device-read, device-write or irreversible actions.

## Limits

- Verified on Windows x64 and WSL2; not yet run on native Ubuntu x64.
- Files with a document type declaration or entities are refused (protection against XML external entities).
- An electrical interlock counts only as an NC contact on every path to the coil; a mechanical interlock comes from the motor-starting result, never from the drawing. Softstarter and drive templates are not part of this version.
- The templates' control supply, buttons and timer are proposals you confirm. Conductor numbering stays open until you number the conductors in QElectroTech.
- No PDF or image is converted into a schematic.
- Results are preliminary engineering support: no verified design, no conformity statement and no safety function is claimed.

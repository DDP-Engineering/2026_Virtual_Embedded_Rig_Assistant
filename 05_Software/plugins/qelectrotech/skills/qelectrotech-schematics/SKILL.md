---
name: qelectrotech-schematics
description: Work with QElectroTech schematics - read a .qet project, list its devices, cross-references and potentials, draft a DOL, reversing or star-delta starter schematic from a current motor_drives result, relabel elements, check numbering and cross-references and map the devices into the electrical model. Use when asked about QElectroTech, .qet files, schematic candidates, folio cross-references, device labels or conductor numbering.
---

The host tools `qelectrotech` (read), `qelectrotech_change` and `qelectrotech_check` (write, with approval) work on
`.qet` files in the workbench. VERA never starts QElectroTech: the engineer opens, inspects, numbers and saves the
files there.

## 1. Read an existing project

`qelectrotech {"view": "project", "path": "..."}`: report the version, folios and every problem (unresolved
conductor ends, elements whose symbol is not embedded, broken links) - never hide one. Then `devices` (a coil with its
linked contacts is one device) and, when wiring matters, `potentials`.

## 2. Draft a starter schematic

Needs a CURRENT `motor_drives` result (`electrical_model {"view": "results"}`; skill `motor-starting`) whose proposal for
the motor is dol, reversing or star-delta. Call `qelectrotech_change {"action": "candidate", "motorDrivesRun": ..., "motor":
<motor id>, "path": "schematics/<name>.qet"}` with a path that does not exist yet. Explain the checks it returns:
power connections per phase, electrical interlocks (an NC contact of the other device on every coil path), the
overload contact, the star point and sequence for star-delta. The mechanical interlock comes from the motor result's
accessory, not from the drawing. The control supply X1, the buttons S0/S1/S2 and the timer KT1 are template choices
the engineer confirms.

## 3. After the engineer edits in QElectroTech

Read the saved file again (its sha256 changed). Relabel with `qelectrotech_change {"action": "edit", "path", "sha256":
<current sha256>, "elements": [{"uuid", "info": {"label": "KM10"}}]}` - a wrong sha256 means the file changed: read it
again, never retry blindly.

## 4. Check and map to the model

`qelectrotech_check {"path"}` (add `motorDrivesRun` and `motor` for a candidate) stores the result with the file's
sha256: labels, conductor numbering (unknown until the conductors are numbered in QElectroTech), cross-references and
the device list. `qelectrotech {"view": "reconcile"}` returns `electrical_model_change` operations that record each
device's QET UUID; show them and apply them only with the user's agreement.

Candidates are preliminary engineering support: no verified design, no conformity statement and no validated safety
function.

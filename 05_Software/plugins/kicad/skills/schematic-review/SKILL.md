---
name: schematic-review
description: Review a KiCad 10 schematic - hierarchy, symbol instances, nets, BOM and KiCad's ERC - and report functional observations as facts or hypotheses. Use when asked to check, explain or review a KiCad schematic.
---

Use `run_program` with program `kicad-tool`. It runs KiCad on a copy of the project and never changes it; do not
try to run `kicad-cli` directly (blocked).

## 1. Read the project

```text
kicad-tool inspect --project <folder>/<name>.kicad_pro
```

The printed document lists the sheets, symbol instances and nets; when it says `truncated`, read the full
`result.json` it names with the file tools. Identify an instance by its `uuidPath` and sheet path: in a sheet
used several times the reference alone is not an identity. Nets come from KiCad's netlist.

## 2. Run KiCad's checks

```text
kicad-tool erc --project <folder>/<name>.kicad_pro
kicad-tool review-report --project <folder>/<name>.kicad_pro
```

Report ERC findings as KiCad's: type, severity, sheet path, objects and positions, and `libraryIssues` (missing
symbol libraries). Keep them apart from your own review. KiCad 10's ERC does not report duplicate references;
`kicad-tool erc` lists them itself under `duplicateReferences` (kicad-tool's check, not KiCad's).
Unannotated symbols (`R?`) are KiCad's ERC finding, not a duplicate. Exclusions and
ignored checks stay visible; say which checks KiCad ignored.

## 3. Review the function, separately

Go through supplies and their regulators, logic levels between parts, reset, boot and debug pins, pull-ups and
pull-downs, decoupling, protection (ESD, reverse polarity, overcurrent) and component stress. For every
observation give:

- the component, pin or net it concerns (`R101 pin 2`, net `/EN_A`),
- the condition you see,
- the source (`result.json`, a datasheet page you read, the user's statement),
- whether it is a **fact** (read from the design or a document) or a **hypothesis** (an inference to confirm).

Never declare a net, a resistor or a supply adequately sized without the electrical requirements it serves
(current, voltage, timing, tolerances); say what is missing instead. Never invent a datasheet value. Use the
electronics-calc plugin (`elec-calc`) for any number a conclusion rests on.

## 4. Deliver

Use `kicad-tool bom` and `kicad-tool netlist` when the user needs the BOM or the netlist, and
`kicad-tool export --kind sch-pdf` for a PDF to look at. Cite the run folder (`result.json`, `report.md`) of
every run you rely on.

---
name: panel-engineering
description: Engineer and check a control panel - draft the equipment from motor starter assemblies, write the panel file (enclosure, plate, rails, ducts, zones, rules, equipment, terminal strips, 24 V supply, scenarios, reserve, thermal conditions), check BOM, accessories, terminals, 24 V budget, 2D layout, dissipation and enclosure temperature, show what a changed device affects and export the BOM and layout. Use when asked about panel layout, BOM, terminal strips, 24 V supply sizing, panel heat or the assembly verification of a control panel.
---

The host tools `panel_engineering` (read) and `panel_engineering_check` (write, with approval) work on
`electrical-automation-panels/<id>.json` and the electrical model. Nothing physical is changed.

## 1. Start from current motor results

Find a CURRENT `motor_drives` result (`electrical_model {"view": "results"}`; skill `motor-starting`). Call
`panel_engineering {"view": "draft", "motorDrivesRun": ..., "motors": [...]}` and use its entries as the panel's
equipment. `accessoryHints` are what the catalog item lists, with its cited note - add an accessory (`mountedOn`,
`mounting` below or side) only from those hints or another cited catalog entry, never because it "should fit".

## 2. Write the panel file

Ask the engineer for the enclosure and plate items, the rails, ducts and zones, the segregation and keep-out rules with
their source, the 24 V consumers (`supply`), the scenarios (`active` tags), the reserve and the thermal conditions
(maximum ambient, heat-transfer coefficient with its source, fan item, wiring loss). Missing data stays missing: give a
`declared` value only when the engineer states it, with basis and note. Write the file with the write tool.

## 3. Check

`panel_engineering_check {"panel", "motorDrivesRun", "schematics": [{"path", "motor"}]}` stores the result. Report the
failed and unknown criteria first: reconciliation, accessories, terminals, placement (collisions, ducts, zones, depth,
missing dimensions), the 24 V budget, dissipation and air temperature per scenario. Short-circuit withstand and busbars
stay not evaluated without the assembly's data; never call the panel IEC 61439 compliant - point to the verification
report's uncovered characteristics.

## 4. After a change

`panel_engineering {"view": "impact", "runId"}` lists the BOM lines, rails, 24 V budgets and scenarios to redo; run the
check again. `{"view": "export", "runId", "format": "bom-csv" | "layout-svg"}` returns the BOM or the layout as text.

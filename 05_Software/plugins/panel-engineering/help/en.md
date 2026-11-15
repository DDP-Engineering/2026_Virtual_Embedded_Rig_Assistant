# Panel engineering

Panel engineering lets the agent plan and check a control panel next to the electrical project model. You describe the enclosure and mounting plate, rails, ducts, zones with your rules, the equipment, terminal strips, the 24 V supply, scenarios, reserve and thermal conditions in a panel file; the check reconciles the equipment list with the motor starters, the model and your QElectroTech schematics, places every device on the rails with its real dimensions, budgets the 24 V supply and estimates the air temperature in the enclosure.

## What it needs

- **No program.** The agent uses VERA's built-in tools `panel_engineering` and `panel_engineering_check`, which are offered only while this plugin is enabled. There is nothing to install or download, so **Install dependencies** has nothing to do here.
- A current motor-starting result (plugin Motor starting and drives) and industrial catalogs with the devices' dimensions, losses and accessories (plugin Industrial catalog and documented selection).
- Optionally the QElectroTech schematics of the motors (plugin QElectroTech schematics).

## How to use it

- "Draft the panel equipment for M1 and M2 from the latest motor result." (skill `panel-engineering`)
- "Write the panel file for MCP1: 600 x 400 x 200 enclosure against a wall, three rails, a 24 V supply for the PLC."
- "Check the panel against the motor result and the two schematics."
- "Which devices could not be placed, and why?"
- "I replaced KM1-M1 - what do I have to redo?"
- "Export the BOM as CSV and the layout as SVG."

The result is stored in `electrical-automation-results/<run-id>/` with the hashes of the panel file, catalogs and schematics; if the model changes, it is marked stale.

## Risk and approvals

`panel_engineering` only reads. `panel_engineering_check` is a write tool: it asks for your approval like a file write and is not offered in Read-only sessions. It writes only its new result file; the model, the panel file, the catalogs and the schematics are not changed. There are no device-read, device-write or irreversible actions.

## Limits

- An accessory counts as compatible only when the catalog lists it for its host; otherwise it stays open.
- A missing dimension or loss stays unknown: the device is not placed and the dissipation is not summed, never counted as zero.
- The air temperature is the enclosure heat balance of the Schneider Electric enclosure catalogue (mean value, losses at rating); the top of the enclosure is warmer.
- Short-circuit withstand needs the assembly's declared rating; busbars are not evaluated.
- No IEC 61439 conformity is claimed, no 3D layout or machining data. Verified on Windows x64 and WSL2; not yet run on native Ubuntu x64.
- Results are preliminary engineering support: no verified design and no safety function.

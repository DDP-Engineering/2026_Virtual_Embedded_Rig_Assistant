# Lighting design

Lighting design gives the agent VERA's built-in `lighting_design` tool for interior lighting of one rectangular room. The preliminary level reads IES LM-63 or EULUMDAT photometry and gives a lumen-method estimate with cited utilisation factors, the luminaires needed, installed power and the direct component on the calculation grid, with diagnostics for a wrong length unit, scale, orientation or photometry. The verification level checks a DIALux evo report that you export for the same room and only then gives maintained illuminance, uniformity and glare verdicts. Every result states its sources, units, assumptions and limits. VERA writes no DIALux file and does not run DIALux.

## What it needs

- No programs: the plugin brings a skill, and the agent uses VERA's built-in tool, which is offered only while the plugin is enabled. There is nothing to install.
- A lighting project the agent writes with you: the declared length unit, the room, reflectances, calculation plane, maintenance factor with its source, luminaire types, positions and orientations, and the requirements typed by you from the standard that applies, with their source.
- The manufacturer's `.ies` or `.ldt` files, unchanged, and the utilisation factors from the manufacturer's table. The agent asks where files come from and never downloads one without your go-ahead.
- For verification: DIALux evo on Windows, where you build the same room from the project values and the same photometry files, calculate and export the report.

## How to use it

- "Write a lighting project for this 8 by 6 m office from these IES files and check the preliminary result." (skill `lighting-design`)
- "How many of these luminaires do I need for 500 lx maintained?"
- "Why does the direct component look so low? Check the diagnostics for unit, tilt and rotation."
- "Compare the catalog flux and power with what the photometry file says."
- "Walk me through the DIALux evo steps to rebuild this room."
- "Verify the exported DIALux report against the project, then give the uniformity and glare verdicts."

Project, photometry and report files go to `electrical-automation-lighting/` and `electrical-automation-photometry/`; each result goes to `electrical-automation-results/<run-id>/` and never overwrites an earlier one.

## Risk and approvals

The tool is a write tool: it is not offered in Read-only sessions, and VERA asks before it stores a result or a project file, as for any file write. It changes no other file and starts no program. There are no device-read, device-write or irreversible commands.

## Limits

- Windows x64 and Linux x64. Verified on Windows x64 and WSL2; not yet run on native Ubuntu x64.
- The preliminary level is an estimate, never a detailed photometric verdict: maintained illuminance, uniformity and UGR stay not-evaluated until a matching engine report is verified. VERA computes no uniformity or UGR itself.
- Missing data stays unknown and never passes. A report that does not match the project is rejected; the model is fixed in DIALux, never the record.
- Emergency and exterior lighting are not supported in this version. Photometry must be IES LM-63 type C or EULUMDAT; other files are refused with the reason.

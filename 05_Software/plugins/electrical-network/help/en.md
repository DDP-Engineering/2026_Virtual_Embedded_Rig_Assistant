# Electrical network and cable sizing

Electrical network and cable sizing lets the agent calculate a radial low-voltage network of the workbench's electrical model instead of estimating it. It covers the P/Q/S load balance per scenario with simultaneity and load factors, phase and neutral currents, design currents, cable cross-sections checked or proposed from a cited cable table, single- and three-phase voltage drop, and maximum and minimum fault currents by the impedance method after IEC 60909-0:2016. Every result states its method, inputs, units, assumptions and limits. It runs offline and touches no hardware.

## What it needs

- No programs and nothing to install: the plugin has none. The agent uses VERA's built-in `electrical_network` tool, which is offered only while the plugin is enabled and never in read-only sessions.
- An electrical model in the workbench, `electrical-automation-model.json`, with one transformer or LV supply point, its circuits, cables and loads.
- A cable table in `electrical-automation-tables/` with cited values. VERA ships no IEC 60364-5-52 table; type values from a datasheet or a standard you hold.
- Installation method, ambient temperature, grouping and fault level. The agent asks for a missing value instead of inventing it.

## How to use it

- "Calculate the load balance of the main board for normal operation and with the pump stopped." (skill `network-sizing`)
- "Check the cable cross-sections of all circuits against this cable table."
- "What cross-section do you propose for the cable to motor M1, and which criterion decides?"
- "What is the voltage drop at the end of the longest circuit against a 4 % limit?"
- "What are the maximum and minimum fault currents at the board and at the circuit ends?"
- "Show the stored result again and tell me whether it is stale."

A result is stored as a new `electrical-automation-results/<run-id>/result.json` with its inputs, so a later model change marks it stale. A proposed cross-section is a proposal; accepting it goes through a model change that you approve.

## Risk and approvals

`electrical_network` writes one new result file and asks for approval like a file write. It never changes the model, a schematic or an approved selection; changing the model uses `electrical_model_change`, which asks for approval too. Showing a stored result again with `electrical_model` is read-only. There are no device-read, device-write or irreversible commands.

## Limits

- Windows x64 and Linux x64. Verified on Windows x64 and WSL2; not yet run on native Ubuntu x64.
- One transformer (Dyn for earth faults) or LV supply point, three-phase AC up to 1000 V, radial feeds, one cable per circuit. Meshed networks, busbar ties, parallel cables, generators, UPS, PV and DC are not evaluated or block the run.
- Missing data stays unknown and never passes; unsupported sources or topologies are not evaluated. Factors are taken at the next tabulated point, never interpolated.
- Fixtures are small and cited; no IEC tables or full vendor catalogs are shipped. A table without reactance needs an agreed assumed value, recorded as an assumption.
- Results are preliminary engineering support, not a verified design, conformity statement or safety certification. Protective device selection, disconnection times and selectivity belong to protection coordination.

# Electronics calculations

Electronics calculations gives the agent a calculator for the numbers a design decision rests on, so it runs the calculation instead of estimating it. It covers Ohm's law, series, parallel and shunt resistances, voltage dividers, RC time constants, filters and waveforms, losses in linear regulators, resistors, MOSFETs, diodes, capacitors and inductors, power budgets, junction, case and heatsink temperatures, transient Foster networks, and worst-case and Monte Carlo tolerance analysis. Every result states its units, formulas, assumptions, limits and checks. It runs offline and touches no hardware.

## What it needs

- **elec-calc**: a script on the Python standard library, installed automatically by **Install dependencies** on the plugin page. Nothing is downloaded.
- The input values with their units, ideally with the datasheet source and conditions of each one. The agent asks for a missing value instead of inventing it, reading it off a graph or scaling it to other conditions.
- No required plugins, hardware or configuration.

## How to use it

- "What top resistor gives 3.3 V from 5 V with a 10 kΩ bottom resistor?" (skill `electronics-sizing`)
- "How much does the LDO dissipate at 12 V in, 3.3 V out, 300 mA, 5 mA quiescent current?"
- "Will the regulator's junction stay below 125 °C at 40 °C ambient with thetaJA 50 K/W on a JEDEC 2s2p board?" (skill `thermal-analysis`)
- "What heatsink do I need for 10 W at 50 °C ambient?"
- "Check the divider output over 1 % resistors and a 4.9–5.1 V input, worst case and Monte Carlo."
- "Save these power-stage calculations as a report."

A report goes to `electronics-results/<run-id>/` in the workbench as `report.json` and `report.md`; it never overwrites an existing run.

## Risk and approvals

Every command of this plugin is safe and runs without asking in every permission mode, including Read-only. Calculations read their request and change no file; only `report` creates a new results folder in the workbench. There are no device-read, device-write or irreversible commands.

## Limits

- Windows x64 and Linux x64. Verified on Windows x64; not yet run on native Ubuntu x64.
- Tolerance analysis takes up to 6 outputs, 12 parameters and 100,000 Monte Carlo samples; a large run can take about a minute. Corner analysis finds the extremes only where an output is monotonic in each parameter, and the result says where that fails.
- thetaJA is never combined with junction-to-case resistances; it already describes the whole path on its test board (see https://www.ti.com/lit/an/spra953d/spra953d.pdf).
- No thermal certification, CFD or FEM, Cauer networks, repetitive-pulse thermal superposition, magnetic core-loss estimation or insulation sizing.

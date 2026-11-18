# Power quality and reactive compensation

Power quality and reactive compensation gives the agent VERA's built-in `power_quality` tool for power factor correction at one board. It imports P/Q/S and harmonic measurement files in a declared format and, per network scenario and measured interval, gives the active and fundamental reactive power, the displacement factor and the total power factor under distortion, the kvar needed to reach a target, a fixed or automatic bank of equal steps with a proposed control logic, overcompensation at light load, capacitor, detuned reactor, contactor and step protection checks against cited catalog data, and the parallel resonance against the measured harmonic orders. Every result states its sources, units, assumptions and limits. It proposes; it never switches a step or sets a regulator.

## What it needs

- No programs: the plugin brings a skill, and the agent uses VERA's built-in tool, which is offered only while the plugin is enabled. There is nothing to install.
- The board in the electrical project model, ideally with a current network result (skill `network-sizing`), which gives the board's P and Q per scenario and its fault level for the resonance check.
- A measurement file with its declared time, units and sign conventions. When the export does not say whether Q is fundamental or which sign it has, you state the assumption; the agent never guesses it.
- The target and limits that only you can set: target power factor, voltage tolerance, resonance margin, the regulator's outputs. Cited catalog data (capacitors, reactors, contactors, protection) for the equipment checks.

## How to use it

- "Import this analyser export for the main board and show the displacement and the total power factor." (skill `power-factor-correction`)
- "How many kvar do I need to reach 0.95 at this board, in every scenario?"
- "Propose a fixed or automatic bank and explain why, including overcompensation at the lightest load."
- "Check these capacitors, detuned reactors and contactors against the catalog."
- "Does the bank resonate near a measured harmonic order with a 20 MVA fault level?"
- "Treat the Q in this file as fundamental, and note that assumption in the result."

Measurement files go to `electrical-automation-measurements/` and each result to `electrical-automation-results/<run-id>/`; a result never overwrites an earlier one and is marked stale when the model changes.

## Risk and approvals

The tool is a write tool: it is not offered in Read-only sessions, and VERA asks before it stores a result or a measurement file, as for any file write. It changes no model, switches no capacitor step and sets no regulator. There are no device-read, device-write or irreversible commands.

## Limits

- Windows x64 and Linux x64. Verified on Windows x64 and WSL2; not yet run on native Ubuntu x64.
- Preliminary engineering support: no verified design, no conformity statement and no full power-quality report. Capacitors correct the displacement part only.
- Missing data stays unknown and never passes: without a fault level, margin or harmonic data the resonance verdict is unknown, and a capacitor and reactor pairing is accepted only from a cited table.
- No filter design and no switching transients. Resonance is checked at the maximum fault level and, when the network result holds it, at the minimum.

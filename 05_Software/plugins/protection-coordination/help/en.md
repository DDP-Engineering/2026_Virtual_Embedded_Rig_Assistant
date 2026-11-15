# Protection and coordination

Protection and coordination lets the agent check candidate fuses and circuit breakers for the circuits of your electrical project model, instead of judging them by eye. For each candidate it checks rated voltage, poles, breaking capacity of the kind your profile names (Icu, Ics or Icn), Ib <= In <= Iz, I2 <= 1.45 Iz, automatic disconnection from cited tripping bands, let-through energy against k²S² and RCD type and sensitivity. Selectivity, cascading and starter coordination come only from the manufacturer's tables for exactly those products. Every result states its sources, units, conditions and limits.

## What it needs

- **No program.** The agent uses VERA's built-in tool `protection_coordination`, which is offered only while this plugin is enabled. There is nothing to install or download, so **Install dependencies** has nothing to do here.
- A current electrical-network result of the project (skill `network-sizing`); a stale one is refused.
- The industrial-catalog with the candidate fuses and breakers, as items with cited values and conditions.
- Profile values you agree with the agent: the breaking-capacity kind, the disconnection times and the RCD sensitivity. The agent does not choose them itself.

## How to use it

- "Which of these two breakers can protect circuit Q3 against the fault current at its origin?" (skill `protection-selection`)
- "Check the 16 A gG fuse against the cable's Iz and the disconnection time at the end of the circuit."
- "Does the breaker's let-through energy stay below k²S² for this cable?"
- "Is the RCD type allowed by the drive's manual, and is its sensitivity within the profile limit?"
- "Is the breaker selective to the upstream fuse? Use the manufacturer's table."
- "Why is the starter coordination unknown, and what data would settle it?"

The result is stored with its inputs in `electrical-automation-results/<run-id>/` in the workbench. If the model changes afterwards, the result is marked stale.

## Risk and approvals

The tool is a write tool: it stores one new result and asks for your approval like a file write. It is not offered in Read-only sessions. It never changes the electrical model, configures no device and writes no relay or breaker settings. There are no device-read, device-write or irreversible actions.

## Limits

- Verified on Windows x64 and WSL2; not yet run on native Ubuntu x64.
- Selectivity, cascading and type 1 / type 2 coordination are never read from curve overlap. Without a manufacturer table for exactly those products and conditions, the pair is not evaluated.
- Missing data stays unknown and never passes: an extracted, absent or off-condition catalog value, a curve without a band, or a magnetic trip current without tolerance or operating time leaves the criterion open. Icu, Ics and Icn are never substituted for one another.
- Fixtures are small and cited; licensed manufacturer tables are not shipped. Public tables with prospective current, numeric instantaneous operating times, fuse time-current gates and I²t are often download- or licence-only, so those criteria stay open until you provide them.
- Results are preliminary engineering support: no verified design, no conformity statement and no safety function.

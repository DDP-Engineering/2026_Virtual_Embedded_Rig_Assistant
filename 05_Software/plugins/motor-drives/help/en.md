# Motor starting and drives

Motor starting and drives lets the agent compare how each motor of your electrical project model can be started or driven, and size what it needs, instead of choosing by power alone. Per motor it compares direct-on-line, reversing, star-delta, softstarter and variable-speed drive against the process function, the starting-current limit, the accelerating torque, the acceleration time and the starts per hour. It proposes the simplest method that passes, sizes contactors by utilisation category, the overload relay, a softstarter or a drive by current and overload with cited derating, and returns a logical connection and interlock scheme. Every result states its sources, units, assumptions and limits.

## What it needs

- **No program.** The agent uses VERA's built-in tool `motor_drives`, which is offered only while this plugin is enabled. There is nothing to install or download, so **Install dependencies** has nothing to do here.
- A current protection-coordination result (skill `protection-selection`), which itself needs a current electrical-network result; stale ones are refused.
- The industrial-catalog with contactors, overload relays, softstarters and drives, with cited values and conditions.
- Motor and load data in the model (nameplate, torque ratios, inertias, load torque, starts per hour) and the process function and limits you agree with the agent. Missing values stay unknown; the agent asks instead of using a typical value.

## How to use it

- "Compare DOL, star-delta and a drive for the pump motor M2." (skill `motor-starting`)
- "Is star-delta allowed for this motor, and does the line starting current stay under the utility limit?"
- "How long does the conveyor take to accelerate, and is that below the locked-rotor time?"
- "Size the contactors and the overload relay for the proposed method."
- "Which drive duty class covers the continuous and overload current, with derating at 45 °C and 1000 m?"
- "Give me the connection and interlock scheme for the reversing starter."

The result is stored with copies of the motors, circuits and cables it read in `electrical-automation-results/<run-id>/` in the workbench. If the model changes afterwards, the result is marked stale.

## Risk and approvals

The tool is a write tool: it stores one new result and asks for your approval like a file write. It is not offered in Read-only sessions. It never changes the electrical model and never configures or parameterises a drive, softstarter or relay. There are no device-read, device-write or irreversible actions.

## Limits

- Verified on Windows x64 and WSL2; not yet run on native Ubuntu x64.
- Acceleration time and torque curves are model values with stated assumptions, not guaranteed performance.
- Missing data stays unknown and never passes. Braking energy, EMC category, motor cable length and RCD types count only from cited data; anything else is a question for the manufacturer. Softstarter starts per hour, a drive's EMC category and maximum motor cable length are often not on public pages.
- Protective-device and starter-coordination verdicts are copied from the protection result, never read from curve overlap.
- Fixtures are small and cited; licensed manufacturer tables are not shipped.
- Results are preliminary engineering support: no verified design, no conformity statement and no safety function is claimed. The scheme is a logical starting point for drawings.

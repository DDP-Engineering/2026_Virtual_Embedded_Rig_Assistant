# Measurement validation

Measurement validation compares bench captures and simulations with requirements, offline and reproducibly. The agent writes a JSON request that names the sources, signals, measurement windows, alignment, criteria, decision rule and uncertainty, and the program does the work: it imports the data, normalizes units and signs, measures RMS, frequency, duty cycle, rise and fall time, overshoot, settling, ripple and delay, aligns series by declared markers or bounded cross-correlation, and decides each criterion as pass, fail or incomplete. The report, with overlays, differences, conditions and links to the sources, goes to `embedded-lab-results/<run-id>/` in the workbench.

## What it needs

- **lab-validate**: a script on the Python standard library, installed automatically by **Install dependencies** on the plugin page.
- The data in the workbench: scpi-instruments capture folders, CSV files, sigrok-cli CSV exports, or ngspice or LTspice transient run folders. The SPICE plugins do not need to be installed to read their run folders. Raw proprietary formats (`.sr`, `.raw`, scope binaries) must first be converted with their own tool.
- The requirement's limits as written, and the uncertainty and instrument bandwidth you can justify for your setup.
- No required plugins, hardware or configuration parameters.

## How to use it

- "What does the capture in embedded-lab-results/cap1 hold?"
- "Check the rise time and ripple of the scope capture against REQ-PWR-12." (skill `validation-planning`)
- "Compare the measured output with the ngspice run, aligned on the input's rising edge."
- "Why is criterion C2 incomplete?" (skill `difference-explanation`)
- "Summarize these compare runs into one campaign verdict."

The agent never computes a metric or a verdict itself and quotes only what the program reports. It does not widen a limit, window or tolerance to obtain a pass. Differences between measurement and simulation are offered as hypotheses tied to evidence in the result.

## Risk and approvals

Every command of this plugin is safe and runs without asking in every permission mode, including Read-only. It reads files in the workbench without changing them, opens no network connection, starts no other program and only creates new run folders. There are no device-read, device-write or irreversible commands.

## Limits

- Windows x64 and Linux x64.
- A result is not a calibration or a metrological certification; lab-validate does not derive uncertainty.
- Gaps, clipping, evident aliasing, unknown or insufficient bandwidth and missing or differing conditions make a criterion incomplete. Incomplete is not a near-pass.
- Clocks of different instruments are never synchronized by file times; alignment uses declared markers, offsets or cross-correlation.

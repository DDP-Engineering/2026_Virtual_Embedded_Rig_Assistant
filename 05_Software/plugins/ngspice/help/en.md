# ngspice circuit simulation

This plugin lets the agent simulate circuits locally with ngspice. It runs operating point, DC, AC, transient and noise analyses of your SPICE netlist (written by hand or exported from KiCad) with local models, takes measurements over declared windows (ripple, overshoot, settling, RMS, average power), checks pass/fail criteria, sweeps parameters and temperature, runs seeded Monte Carlo, and compares runs and writes reports. Netlists are checked before the engine runs, and every run writes a new folder under `electronics-results/` with the log, the effective netlist, input hashes, a series file, a plot, a result file and a report.

## What it needs

- **ngspice 42 or newer.** On Windows, **Install dependencies** downloads the pinned official ngspice-47 build into VERA's program folder; VERA also uses your own copy in `C:\Spice64`. On Ubuntu there is no official binary: install it yourself with `sudo apt install ngspice`. The **Dependencies** section of the plugin page shows what was found.
- **ngspice-tool**, a Python script in the plugin, which VERA installs itself. The agent always works through it.
- No hardware, no other plugins and no configuration.

## How to use it

The agent uses the `circuit-simulation` skill. It declares the analysis, measurement windows and criteria before it looks at results.

- "Check circuits/buck.cir and list its models and subcircuits."
- "Run a 2 ms transient of the buck converter; the output ripple from 1 ms to 2 ms must be at most 50 mV."
- "Measure the average power in the switch from 1 ms to 2 ms."
- "Sweep RLOAD over 1k and 3k and compare the runs."
- "Run 50 Monte Carlo runs with 5 % tolerance on RLOAD, seed 7, and write a report."
- "Build a lumped RC thermal network for the regulator and find its steady-state temperature."

## Risk and approvals

All ngspice-tool operations (validate, run, sweep, measure, compare, report) are rated **Safe**: they only simulate on your computer, never change the netlist or its models, and run without asking. Running ngspice directly is **Blocked**, because a netlist's control block can run shell commands and write files.

## Limits

- Windows x64 and Linux x64.
- Refused before the engine runs: `.control` blocks, unknown cards, `*#` and `;#` lines (ngspice runs them as commands), XSPICE `A` instances, code loading, `shell`, includes outside the workbench, undefined models or subcircuits and subcircuit instances with the wrong pin count.
- Analysis cards in the netlist (`.tran`, `.ac`, `.meas`, `.print`) are not run; the request decides the analysis.
- A run that does not converge is reported, not retried with relaxed solver settings.
- A simulation is not a hardware measurement: the result is only as good as the models.

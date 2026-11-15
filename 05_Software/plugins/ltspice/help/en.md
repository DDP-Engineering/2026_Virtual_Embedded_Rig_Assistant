# LTspice circuit simulation

This plugin lets the agent simulate circuits in batch mode with your own copy of LTspice on Windows. It runs operating point, DC, AC, transient and noise analyses of a SPICE netlist or an LTspice .asc schematic, steps parameters and temperature, runs seeded Monte Carlo, takes measurements over declared windows (ripple, overshoot, settling, RMS, average power) and checks pass/fail criteria. Requests use the same format as the ngspice plugin, so one request can run on both engines and the results can be compared. Every run writes a new folder under `electronics-results/` with the inputs, LTspice's log and raw file, a plot and a report.

## What it needs

- **LTspice 26 or newer**, which you install yourself from https://www.analog.com/ltspice (LTspice64.msi, Windows 10/11 x64). VERA finds it in the per-user or all-users install folder and never installs it. If the per-user install fails with error 2503, install it for all users from an administrator prompt: `msiexec /i LTspice64.msi ALLUSERS=1`.
- **ltspice-tool**, a Python script in the plugin, which VERA installs itself. The agent always works through it.
- No hardware, no other plugins and no configuration.

## How to use it

The agent uses the `ltspice-simulation` skill.

- "Check circuits/buck.cir and its includes before we simulate it."
- "Convert circuits/filter.asc to a netlist and run an AC sweep from 10 Hz to 100 kHz; the -3 dB point must be above 159 Hz."
- "Run a transient of the buck converter and measure the output ripple after it has settled."
- "Run 50 Monte Carlo runs with 5 % tolerance on RLOAD, seed 7."
- "Run the same request with ngspice and compare the measurements."

## Risk and approvals

All ltspice-tool operations (validate, convert, run, sweep, measure, compare, report) are rated **Safe**: they only simulate on your computer, never change the netlist, the schematic, its models or LTspice's libraries, and run without asking. Running LTspice directly is **Blocked**, because a netlist can write files anywhere and LTspice opens its window without batch mode.

## Limits

- Windows x64 only; the plugin is not offered on Linux or macOS.
- Before LTspice runs, ltspice-tool refuses directives that read or write files (such as `.wave`), unknown cards, encrypted or non-UTF-8 files and includes outside the workbench and LTspice's library. A node named like `profile` is refused too, because LTspice matches `file` by prefix.
- Analysis and `.meas` cards in the netlist are not run; the request decides the analysis.
- A library section needs a quoted file name: `.lib "models/corners.lib" TT`.
- A simulation is not a hardware measurement: the result is only as good as the models.

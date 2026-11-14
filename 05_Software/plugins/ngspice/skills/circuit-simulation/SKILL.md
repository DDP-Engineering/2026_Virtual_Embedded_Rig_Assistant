---
name: circuit-simulation
description: Simulate a circuit with ngspice - operating point, DC, AC, transient and noise analyses, measurements over declared windows, pass/fail criteria, sweeps, Monte Carlo, run comparison and reports. Use when asked to simulate, verify or size a circuit from a SPICE netlist (written by hand or exported from KiCad) with local models.
---

Use `run_program` with program `ngspice-tool`; never run `ngspice` directly (blocked). Every operation writes a new run
folder under `electronics-results/` and never changes the netlist or its models.

## 1. Check the netlist

```text
ngspice-tool validate --netlist circuits/buck.cir
```

It lists the files with their hashes, subcircuits, models, the analysis cards it will not run and the `.option`
cards. A `.control` block, an unknown card, a `*#` line (ngspice runs it as a command), an XSPICE `A` instance (code
models can start programs or read files), code loading (`pre_osdi`, `codemodel`), `shell`, an include outside the
workbench, a model or subcircuit that is not defined and a subcircuit instance with the wrong pin count are refused
before the engine runs. Fix the netlist; never work around a refusal.

## 2. Declare before you run

Write the request with the analysis, the vectors, the measurements with their windows and the criteria **before**
looking at results (`ngspice-tool run --help` lists every field):

```json
{"netlist": "circuits/buck.cir",
 "analysis": {"kind": "tran", "step": "100 ns", "stop": "2 ms"},
 "vectors": ["v(out)", "v(sw,out)", "i(Vsense)"],
 "measurements": [
   {"id": "ripple", "kind": "ripple", "vector": "v(out)", "window": {"from": "1 ms", "to": "2 ms"}},
   {"id": "loss", "kind": "average-power", "voltage": "v(sw,out)", "current": "i(Vsense)", "window": {"from": "1 ms", "to": "2 ms"}}],
 "criteria": [{"measurement": "ripple", "op": "<=", "value": "50 mV"}]}
```

- Windows start after the circuit has settled; say why you chose them. A ripple measurement requires its window.
- `validate` warns when a value such as `1M` is read as milli (SPICE `M` = milli, `MEG` = mega): fix the netlist.
- Average power integrates v(t) x i(t) over the window. Put a 0 V sense source in series and read the stated sign
  convention: positive means the element absorbs power. The peak of p(t) is not the dissipation.
- Analysis cards inside the netlist (`.tran`, `.ac`, `.meas`, `.print`) are not run; the request's analysis runs.

## 3. Run and read

```text
ngspice-tool run --input sim/buck-request.json
```

`status: ok` with criteria `pass`/`fail`; `not-applicable` (exit 0) for a noise run of a circuit without noise
generators; `timeout` (exit 3) when the time limit or a sweep's 1700 s budget runs out; `failed` (exit 3) when the engine reports a singular matrix, no convergence,
a missing model or vector, or writes no data - then every criterion is `not-evaluated`. A run that does not converge
is never retried with relaxed solver settings: report it and fix the circuit or the model. ngspice-tool sets no
solver option; the netlist's own `.option` cards are listed as written.

## 4. Sweeps, Monte Carlo, comparison

```text
ngspice-tool sweep --json '{"netlist": "...", ..., "sweep": {"parameter": "RLOAD", "values": ["1k", "3k"]}}'
ngspice-tool sweep --json '{..., "monteCarlo": {"seed": 7, "runs": 50, "tolerances": {"RLOAD": {"nominal": "1k", "percent": 5, "distribution": "uniform"}}}}'
ngspice-tool compare --run electronics-results/<a> --run electronics-results/<b>
ngspice-tool measure --run electronics-results/<a> --json '{"measurements": [...]}'
ngspice-tool report --run electronics-results/<a> --run electronics-results/<b>
```

Parameters are `.param` names of the netlist. Keep the seed: the same seed gives the same draws.

## 5. Electrothermal

A lumped RC thermal network is a separate circuit where a voltage stands for a temperature (1 V = 1 °C) and a current
for a power (1 A = 1 W): power as a current source, thermal resistances as resistors, thermal capacitances as
capacitors, ambient as a voltage source. Its steady state must equal elec-calc `thermal`. The device's electrical
model reacts to temperature only if the model itself takes the temperature node; adding a node does not make it
electrothermal.

## 6. Report

Give the analysis, the windows, each measurement with its value and the criteria, the engine version and the run
folder. A simulation is not a measurement of hardware: say which models and assumptions the result rests on.

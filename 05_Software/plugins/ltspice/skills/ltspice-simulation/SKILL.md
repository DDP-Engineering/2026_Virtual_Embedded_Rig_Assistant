---
name: ltspice-simulation
description: Simulate a circuit with the user's own LTspice on Windows - operating point, DC, AC, transient and noise analyses of a SPICE netlist or an LTspice .asc schematic, measurements over declared windows, pass/fail criteria, parameter, temperature and Monte Carlo steps, run comparison and reports. Use when the user works with LTspice files or ADI models, or asks to check a result against ngspice.
---

Use `run_program` with program `ltspice-tool`; never run `ltspice` directly (blocked). Every operation writes a new run
folder under `electronics-results/` and never changes the netlist, the schematic, their models or LTspice's library.
The plugin runs on Windows only, with LTspice 26 or newer that the user installed from analog.com; if VERA reports it
as not installed, point the user to the plugin's install hint - never try to install it.

## 1. Check the netlist or convert the schematic

```text
ltspice-tool validate --netlist circuits/buck.cir
ltspice-tool convert --schematic circuits/filter.asc
```

`validate` lists the files with their hashes, subcircuits, models, the analysis cards it will not run and the
`.options` cards. `convert` turns a schematic into a netlist with LTspice on a copy and checks it the same way. Refused
before LTspice runs: `.wave`, `.savebias`, `.loadbias`, `.savestate`, `.loadstate`; outside include cards any text
containing `file`, `scopedata`, `tbl`, `.inc`, `include`, `.lib`, `loadbias`, `savebias`, `loadstate`, `savestate`
or `fastaccess` (LTspice matches them by prefix -
rename a node such as `profile`); quoted strings outside include, library and model cards, `@`/`&` elements, `.machine`,
unknown cards, encrypted or non-UTF-8 files, files with U+0085/U+2028/U+2029 or invisible formatting characters, include
names with `%` or not in Unicode NFC, netlists, includes and schematics whose path inside the working directory is not
in NFC (a folder copied from a Mac may not be), includes outside the workbench and LTspice's library, and schematic
symbols named by an absolute path. Fix the input; never work around a refusal.

## 2. Declare before you run

The request is the same as ngspice-tool's (`ltspice-tool run --help` lists every field), so the same request can run
on both engines:

```json
{"netlist": "circuits/filter.asc",
 "analysis": {"kind": "ac", "sweep": "dec", "points": 100, "start": "10 Hz", "stop": "100 kHz"},
 "vectors": ["vdb(out)"],
 "measurements": [{"id": "corner", "kind": "value-at", "vector": "vdb(out)", "at": "159.155 Hz"}],
 "criteria": [{"measurement": "corner", "op": ">=", "value": "-3.1"}]}
```

- Windows start after the circuit has settled; say why you chose them. A ripple measurement requires its window.
- A library section needs a quoted file name: `.lib "models/corners.lib" TT` (LTspice reads an unquoted
  `.lib models/corners.lib TT` as one file name).
- Analysis, `.step`, `.temp`, `.save` and `.meas` cards of the netlist or schematic are not run; the request's
  analysis, parameters and temperature are. A parameter must be assigned in a top-level `.param` card.
- Average power integrates v(t) x i(t) over the window; positive means the element absorbs power.

## 3. Run and read

```text
ltspice-tool run --input sim/filter-request.json
```

`status: ok` with criteria `pass`/`fail`; `failed` (exit 3) with a problem kind - `model` or `subckt` (LTspice found no
definition), `singular`, `convergence`, `vector`, `partial` or `limit` - and every criterion `not-evaluated`; `timeout`
(exit 3) when the time limit runs out. A run that does not converge is never retried with relaxed settings: report it
and fix the circuit or the model. ltspice-tool adds no `.options`. LTspice's library models (`.lib LTC.lib`, standard
parts) are read in place and listed by name and hash.

## 4. Steps, Monte Carlo, comparison

```text
ltspice-tool sweep --json '{"netlist": "...", ..., "sweep": {"parameter": "RLOAD", "values": ["1k", "3k"]}}'
ltspice-tool sweep --json '{..., "monteCarlo": {"seed": 7, "runs": 50, "tolerances": {"RLOAD": {"nominal": "1k", "percent": 5, "distribution": "uniform"}}}}'
ltspice-tool compare --run electronics-results/<a> --run electronics-results/<b>
```

A sweep needs at least two distinct values (LTspice refuses a single step); all points run in one LTspice `.step`
run. Keep the seed: the same seed gives the same draws. To check a result against ngspice, run the same request
with `ngspice-tool` and compare the measurements; a difference between engines is a model or dialect question until
analysed, not an engine bug.

## 5. Report

Give the analysis, the windows, each measurement with its value and the criteria, the LTspice version and the run
folder. A simulation is not a measurement of hardware: say which models and assumptions the result rests on.

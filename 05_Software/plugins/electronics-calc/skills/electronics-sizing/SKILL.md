---
name: electronics-sizing
description: Size and check circuit parts with reproducible numbers - Ohm's law, dividers, RC filters, regulator, MOSFET, diode and passive losses, worst-case and Monte Carlo tolerances. Use whenever a design decision rests on a calculated value.
---

Use `run_program` with program `elec-calc`. Do not compute these values in
your head: run the operation and cite its result, formulas and assumptions.

## 1. Collect the inputs

Take each value from the user, a schematic or a datasheet you have read, with
its unit. For a datasheet value keep where it comes from and what it holds for:

```json
{"value": 50, "unit": "mΩ", "source": "Datasheet rev. C, table 4", "conditions": "VGS = 10 V, Tj = 125 °C"}
```

Never invent a missing value, read one off a graph by eye, or scale it to other
conditions. Ask for it, or state that the result cannot be computed. A
quiescent current is either given (`iq`) or neglected explicitly
(`neglectIq: true`) and reported as such.

## 2. Run one operation

Pass the request as one line with `--json`, or write it to a file in the
workbench and pass `--input` (required above 4096 characters). In
`run_program` the request is a single item of `args`, for example
`["losses", "--json", "{\"model\": ...}"]`:

```text
elec-calc dc --json {"model":"ohm","voltage":"5 V","current":"10 mA"}
elec-calc divider --json {"model":"resistive","vin":"5 V","vout":"3.3 V","rBottom":"10 kΩ","solveFor":"rTop"}
elec-calc rc --json {"model":"filter","type":"lowpass","resistance":"10 kΩ","capacitance":"100 nF","frequency":"1 kHz","amplitude":"1 V","amplitudeKind":"rms"}
elec-calc losses --json {"model":"linear-regulator","vin":"12 V","vout":"3.3 V","iout":"0.3 A","iq":"5 mA","dropout":"1 V"}
elec-calc losses --json {"model":"mosfet","current":{"shape":"pulse","peak":"4 A","duty":0.25},"rdsOn":{"value":50,"unit":"mΩ","conditions":"VGS = 10 V, Tj = 125 °C"},"frequency":"100 kHz","switching":{"method":"energy","eOn":"100 µJ","eOff":"150 µJ"},"gateDrive":{"qg":"50 nC","vDrive":"10 V"}}
```

Models: `dc` ohm, series, parallel, shunt; `divider` resistive; `rc`
time-constant, filter, waveform; `losses` linear-regulator, resistor, mosfet,
diode, capacitor, inductor, power-budget. Before you use a model for the first
time, run `elec-calc <operation> --help`: it lists every field of every model
of that operation.

Currents are descriptors. `{"rms": "2 A"}` is the RMS over the whole period;
`{"shape": "pulse", "peak": "4 A", "duty": 0.25}` gives RMS 2 A and average
1 A. Never add a duty cycle to an RMS value. State whether an amplitude is
peak, RMS or peak-to-peak (`amplitudeKind`).

## 3. Read the whole result

- `results` carry units; quote `text` and keep the unit.
- `checks`: `fail` is a finding to report; `unknown` and `not-evaluated` mean
  the check could not be made (for example `rdsOn` without conditions) - say so.
- `warnings`, `assumptions` and `limits` belong in your answer when they
  qualify the number.
- `status: "error"`: fix the request from `errors[].path` and `message`. Do not
  work around a refusal by dropping the unit or guessing the missing value.
- A warning that the detail tables, the inputs or the formulas, assumptions
  and limits were left out means the document was too long for one answer: run
  the request through `report` and read them in `report.json`.

## 4. Tolerances

Run `tolerance` on the same request for any value that must hold over
component spread:

```json
{"target": {"operation": "divider", "input": {"model": "resistive", "vin": "5 V", "rTop": "10 kΩ", "rBottom": "10 kΩ"}},
 "outputs": ["vout"],
 "parameters": {"rTop": {"tolerance": "1 %", "distribution": "uniform"},
                "rBottom": {"tolerance": "1 %", "distribution": "uniform"},
                "vin": {"min": "4.9 V", "max": "5.1 V", "distribution": "normal", "sigmas": 3}},
 "monteCarlo": {"samples": 20000, "seed": 12345},
 "limits": {"vout": {"min": "2.4 V", "max": "2.6 V"}}}
```

Report the corner results (`vout.min`, `vout.max`) first: they are the
worst case. `monteCarlo` is optional, needs an explicit `seed` and a
`distribution` for every parameter, and never replaces the corners. If the
`monotonic` check fails, say that the true extreme may lie inside the range.
A run takes at most 6 outputs and 12 parameters; 100000 samples of a large
model can take about a minute.

## 5. Save a report

For results the user will keep, run the calculations once more as a report:

```text
elec-calc report --input calc/power-stage.json --run-id power-stage-rev-b
```

with `{"title": "...", "calculations": [{"id": "ldo", "operation": "losses",
"input": {...}}, ...]}`. It writes `electronics-results/<run-id>/report.json`
and `report.md` and never overwrites; link the Markdown file in your answer.

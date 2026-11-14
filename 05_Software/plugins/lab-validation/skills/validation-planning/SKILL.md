---
name: validation-planning
description: Plan and run a measurement validation - choose sources, windows, metrics, alignment, criteria, decision rule and uncertainty, write the request and run lab-validate. Use when a capture or simulation must be checked against a requirement or against another series.
---

Use `run_program` with program `lab-validate`. Never compute a metric, a lag or
a verdict yourself: write the request and cite what the program reports.

## 1. Find out what the data holds

Run `lab-validate inspect --path <folder or file>` on each source: a
scpi-instruments capture folder (`embedded-lab-results/<run>`), an ngspice or
LTspice run folder (`electronics-results/<run>`), or a CSV/text export. It shows
the channels, points, time span, units, clipping, header and comment lines. It
writes nothing.

## 2. Write the request

A JSON file in the workbench, for example `validation/rc-step.json`:

```json
{"format": 1, "title": "RC step vs REQ-PWR-12", "requirement": "REQ-PWR-12",
 "decisionRule": "guarded", "missingData": "incomplete",
 "conditions": {"vin": "5 V", "load": "1 kohm"},
 "sources": {
   "scope": {"importer": "scpi-capture", "path": "embedded-lab-results/cap1", "bandwidth": "100 MHz",
             "conditions": {"vin": "5 V", "load": "1 kohm"}},
   "sim": {"importer": "spice", "path": "electronics-results/sim1", "conditions": {"vin": "5 V", "load": "1 kohm"}}},
 "signals": {"out": {"source": "scope", "channel": "CHAN1"}, "in": {"source": "scope", "channel": "CHAN2"},
             "ref": {"source": "sim", "channel": "v(out)"}, "refIn": {"source": "sim", "channel": "v(in)"}},
 "measurements": [
   {"id": "tr", "signal": "out", "metric": "rise-time", "window": {"from": "0 s", "to": "200 us"}},
   {"id": "rip", "signal": "out", "metric": "ripple", "window": {"from": "400 us", "to": "500 us"}}],
 "comparisons": [
   {"id": "vs-sim", "signal": "out", "reference": "ref", "window": {"from": "0 s", "to": "500 us"},
    "alignment": {"method": "marker", "measured": {"signal": "in", "level": "50 %", "edge": "rising"},
                  "reference": {"signal": "refIn", "level": "50 %", "edge": "rising"}}}],
 "criteria": [
   {"id": "C1", "value": "tr", "op": "<=", "limit": "50 us", "uncertainty": "1 us"},
   {"id": "C2", "value": "vs-sim.max-abs", "op": "<=", "limit": "50 mV", "uncertainty": "5 mV"},
   {"id": "C3", "value": "rip", "op": "<=", "limit": "20 mV", "uncertainty": "2 mV"}]}
```

- **Sources**: `scpi-capture` (a capture folder; a decode folder is refused), `spice` (a
  transient ngspice-tool or ltspice-tool folder; AC data is refused), `csv`
  (declare `time` {column, unit} or `sampleRate`, and `columns` {name: {column,
  unit}}; `uniform: false` for an export with simulator time steps such as
  LTspice's text export with `"delimiter": "\t"`), `sigrok-csv` (what
  `sigrok-cli -i capture.sr -O csv -o capture.csv` writes; the sample rate comes
  from its `; Samplerate:` line). Add `sha256` to pin a file; state
  `bandwidth` (the instrument or probe band, needed for rise and fall times)
  and each source's `conditions`.
- **Signals**: one channel of one source. `sign: -1` and `scale` are
  explicit; a current probe or a shunt is a `scale`, never a guess.
  `preprocess` runs in order: `{"resample": {"method": "linear", "rate":
  "10 MHz"}}`, `{"filter": {"kind": "moving-average", "width": "1 us"}}`. A
  filter needs uniform samples (resample a simulation first); downsampling
  without a filter at least one new period wide is flagged.
- **Window**: every measurement and comparison has a `window` {from, to} on
  its signal's own time axis. Choose it from the data, not to make a value
  pass: a `ripple` window must be a steady-state part of the record, a
  rise-time window must hold exactly the edge you mean (the first transition
  in the window counts).
- **Metrics**: `min`, `max`, `mean`, `rms`, `peak-to-peak`, `ripple`,
  `frequency`, `duty-cycle`, `rise-time`, `fall-time` (`percent` [10, 90] or
  [20, 80]), `overshoot`, `settling-time` (`band` required: "2 %" of the step
  or "10 mV"; optional `final`, `from`), `delay` (`reference` signal of the
  same source). Levels are derived from the window (medians of the low and
  high states) unless you declare `levels` {low, high}; the result shows which.
- **Alignment** of a comparison: `none` (each source's own time zero - the
  clocks of different instruments are never synchronized by file times),
  `offset`, `marker` (a declared edge on a signal of the same source on each
  side: the usual choice) or `cross-correlation` with `maxLag`. A
  correlation removes the lag: if the delay matters, add a criterion on
  `<comparison>.lag`, or the report marks it `lag-unjudged`.
- **Criteria**: `value` is a measurement id or `<comparison>.max-abs|rms|
  mean|lag|correlation`; `op` `<=`, `>=` or `==` (with `tolerance`); `limit`
  exactly as the requirement states it. Never widen a limit, a window or a
  tolerance to obtain a pass.
- **decisionRule**: `guarded` (pass only when value plus uncertainty is inside
  the limit; inside the uncertainty band the criterion is incomplete) or
  `simple` (the value alone; the uncertainty is reported). Give the
  `uncertainty` you can justify from the instrument and setup; without one, a
  guarded criterion is incomplete. lab-validate does not derive uncertainty
  and is not a calibration.
- **missingData**: `incomplete` (a gap in a window makes its criteria
  incomplete) or `exclude` (amplitude statistics skip the gap and report the
  excluded time; edge-based metrics still become incomplete).

## 3. Run it

`lab-validate compare --request validation/rc-step.json` (or `measure`,
`align`, `normalize` for intermediate steps). Exit 0 pass, 1 fail, 3
incomplete; 2 means the request was refused and nothing was written - read the
problem, which names the field. The result is
`embedded-lab-results/<run-id>/` with `result.json`, `report.md`,
`compare-<id>.csv` and `compare-<id>.svg`. Point the user at `report.md`.

`lab-validate report --run <folder> --run <folder> ...` summarizes several
compare runs (for a test campaign) into one verdict.

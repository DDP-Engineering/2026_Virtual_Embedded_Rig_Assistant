---
name: difference-explanation
description: Explain a lab-validate result - why a criterion passed, failed or is incomplete, what each diagnostic means and which physical causes may explain a difference between a measurement and a simulation. Use after lab-validate compare, measure or align.
---

Read the run's `result.json` and `report.md` (`embedded-lab-results/<run-id>/`).
Quote the numbers the program computed; never recompute or adjust them, and
never present a verdict the result does not state.

## 1. The verdict

- `pass`: every criterion holds under its declared rule. Say which rule
  (`guarded` includes the uncertainty; `simple` does not) and that this is not a
  calibration or a certification.
- `fail`: at least one criterion is violated beyond its uncertainty. Name it,
  its limit as written and the measured value.
- `incomplete`: the data does not support a verdict for at least one
  criterion. Give each reason from `criteria[].reasons` and
  `criteria[].diagnostics`. Incomplete is not a near-pass: say what new data
  or information would decide it.

## 2. Diagnostics

| Code | Meaning | What decides it |
|---|---|---|
| `gap` | samples are missing in the window | a capture without gaps, or `missingData: exclude` for amplitude statistics |
| `clipped` | samples sit at the converter or declared clip limits | recapture with a larger range or offset |
| `source-incomplete` | the capture itself was incomplete | recapture |
| `aliasing-suspect` | fewer than 4 samples per period | a higher sample rate |
| `aliasing-risk` | downsampled without a wide enough moving-average | filter before resampling |
| `under-sampled` | fewer than 3 samples in an edge | a higher sample rate |
| `bandwidth-unknown` | no `bandwidth` for the source of a rise/fall time | state the instrument/probe band |
| `bandwidth-limited` | the edge is shorter than 3 x the system rise time | more bandwidth; the measured edge is the instrument's |
| `conditions-unknown`, `conditions-differ` | a source does not state, or differs on, a required condition | measure or simulate under the required conditions |
| `lag-at-limit` | the correlation peak is at `maxLag` | widen `maxLag` (it bounds the search, not the requirement) |
| `reference-short` | the reference does not cover the window after alignment | a longer simulation or a shorter window |
| `lag-unjudged` | cross-correlation removed a lag no criterion judges | add a criterion on `<comparison>.lag` if the delay matters |

## 3. Differences between measurement and simulation

Look at `compare-<id>.svg` and the statistics. Offer causes only as
hypotheses, each tied to evidence in the result:

- A constant time shift: trigger position, a marker on the wrong edge, or a
  real propagation delay (judge it with a `lag` or `delay` criterion, never by
  aligning it away).
- A slower measured edge: probe or instrument bandwidth (`systemRiseTime` in
  the rise-time details), probe loading, the moving-average width.
- An amplitude or offset error: probe attenuation setting, `scale` or `sign` of
  the signal, the load and supply conditions, component tolerances.
- Ringing or overshoot only in the measurement: layout parasitics, ground lead
  length, ESR and ESL that the model lacks.
- A temperature or operating point the simulation did not use: compare the
  conditions table.

Do not propose to widen a criterion, change a window after seeing the data or
invent a missing value. If the model or the setup must change, say what, and
that a new run is needed.

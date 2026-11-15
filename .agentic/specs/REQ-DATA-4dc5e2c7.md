# REQ-DATA-4dc5e2c7 — Power quality request, measurement file format 1, catalog conventions and the power quality result

## Behavior

The plugin `power-quality-pfc` (ecosystem `electrical`) brings the skill; VERA brings the engine and the write tool
`power_quality`, offered only while the plugin `power-quality-pfc` is loaded (never read-only). One run reads the
electrical model (REQ-DATA-06c0bd54), optionally ONE current `electrical-network` result (REQ-DATA-42ce122f), one
measurement file (this spec) and ONE industrial catalog (REQ-DATA-d7e27def). For one board or busbar of the model it
evaluates displacement and total power factor per scenario, the reactive compensation need to a stated target, a fixed
or automatic capacitor bank with equal steps and a control-logic proposal, the step equipment against cited data and
the parallel resonance against measured harmonic orders, and prepares one new result file
`electrical-automation-results/<run-id>/result.json`. The model, the measurement file and the catalog are only read;
no step is switched, no regulator is set and no filter is designed.

A capacitor bank for reactive compensation is not an electrochemical battery or a UPS; neither is evaluated here.
The engine is "VERA power factor correction 1" (`vera-pfc-1`). It is preliminary engineering support, not a verified
design, no conformity statement and not a full power-quality report (no flicker, unbalance, EN 50160 or voltage
distortion limits).

## Request (`power_quality` arguments)

```json
{"board": "brd-main", "network": "20261115-120000-ab12", "measurements": "meas-fictional-mdb-day",
 "catalog": "cat-pfc", "targetPowerFactor": 0.95, "totalPowerFactorMin": 0.9, "voltageTolerance": 10,
 "resonanceMargin": 0.1, "harmonicThreshold": 1, "maxSteps": 12, "harmonicGeneratorPower": 43, "reactiveAsFundamental": false,
 "steps": [{"capacitor": "itm-blrch125a150b48"}, {"capacitor": "itm-cap-x", "reactor": "itm-lvr07125a40t"}],
 "contactor": "itm-lc1dfkp7", "protection": "itm-c10g32"}
```

Numbers carry fixed units; bounds are refinements.

- `board`: a model object of type `board` or `busbar` (the bank's connection point).
- `network`: run ID of a current `electrical-network` / `network` result; gives the scenarios at the board
  (`activePower:<s>`, `reactivePower:<s>`), the nominal voltage (condition `nominalVoltage`) and the board's maximum
  fault current `ik3Max`. Absent: no network scenarios and no fault level (resonance unknown).
- `measurements`: ID of a measurement file (below) declaring this `board`.
- `catalog`: catalog ID; required when `steps`, `contactor` or `protection` is given.
- `targetPowerFactor` (0.8 <= x <= 1): displacement factor target, lagging.
- `totalPowerFactorMin` (0 < x <= 1): optional tariff minimum of the total power factor.
- `voltageTolerance` (%, 0 <= x <= 20): steady voltage above Un for the capacitor voltage check.
- `resonanceMargin` (share, 0 < x <= 0.5): a resonance order within margin x h of a harmonic order h is a hit.
- `harmonicThreshold` (% of fundamental, 0 <= x <= 100): an order counts when its measured maximum reaches it;
  absent = every order with a measured value above zero counts.
- `maxSteps` (integer 1..32): the regulator's step outputs.
- `harmonicGeneratorPower` (kVA, >= 0): Gh, the sum of the kVA ratings of the harmonic-generating devices at the
  board (stated by the engineer).
- `reactiveAsFundamental` (boolean): read a measurement file's `undeclared` reactive power as Q1 - the engineer's
  stated assumption, recorded in the result's assumptions; without it such a file gives no Q1.
- `steps` (1..4 when given): step candidates `{capacitor, reactor?, units? 1..8}` (catalog items; `units` capacitors or pairs in
  parallel per step, default 1).
- `contactor`, `protection`: catalog items for every step.
- Strict: an unknown key, a board that is not a board or busbar, an item missing from the catalog, a catalog item
  without a catalog, a target outside 0.8..1 or a fifth step candidate throw before anything is prepared. Neither
  network nor measurements, or no scenario with P and Q1, blocks the run.

## Measurement file (`electrical-automation-measurements/<id>.json`, kind `vera-power-measurements`, format 1)

```json
{"kind": "vera-power-measurements", "format": 1, "id": "meas-fictional-mdb-day", "title": "MDB, one day",
 "origin": "fictional", "source": {"title": "Made-up profile", "license": "CC0-1.0", "readAt": "2026-11-15"},
 "board": "brd-main", "interval": {"value": 15, "unit": "min"},
 "conventions": {"power": "load", "reactive": "fundamental", "reactiveSign": "inductive-positive",
                 "powerFactor": "unsigned"},
 "nominalVoltage": {"value": 400, "unit": "V"}, "frequency": {"value": 50, "unit": "Hz"},
 "columns": [{"name": "time", "quantity": "time"}, {"name": "P", "quantity": "activePower", "unit": "kW"},
             {"name": "Q", "quantity": "reactivePower", "unit": "kvar"},
             {"name": "U5", "quantity": "harmonicVoltage", "order": 5, "unit": "%"}],
 "csv": "meas-fictional-mdb-day.csv"}
```

- `id` = file name, lowercase words joined by `-`. `origin` `measured` or `fictional` (a fictional set is labelled
  so in the result). `source` {title, publisher?, revision?, uri?, license, readAt? YYYY-MM-DD, note?}; links follow
  the catalog link rule (no user info or credential-like parameters).
- `board`: the model board or busbar the meter measures; must equal the request's board.
- `interval` {value > 0, unit s|min|h}: the averaging interval; gaps above 1.5 intervals are counted.
- `conventions`: `power` `load` (P > 0 drawn from the supply) or `generator` (signs of P and Q reversed);
  `reactive` `fundamental` (Q1), `nonactive` (sqrt(S² - P²)) or `undeclared`; `reactiveSign` `inductive-positive`
  or `capacitive-positive`; `powerFactor` `unsigned` or `lead-negative` (a negative power or displacement factor is
  leading in the file's own power convention; the generator convention flips it to the load convention).
- `nominalVoltage` (voltage unit), `frequency` (Hz).
- `columns` 2..64, unique names (no comma, quote or control character). The first is the only `time` column (ISO
  8601 with offset, strictly increasing). Quantities and units: `activePower` (power), `reactivePower`
  (reactive-power), `apparentPower` (apparent-power), `voltage` (voltage, line-to-line rms), `current` (current),
  `powerFactor`, `displacementFactor` (unit `1`, magnitude <= 1), `thdCurrent`, `thdVoltage` (unit `%` or `1`),
  `harmonicCurrent`, `harmonicVoltage` (unit `%` or `1` of the fundamental, `order` integer 2..50). One column per
  quantity (per order for harmonics).
- Rows: either `rows` (1..20000 arrays, one cell per column: the time string, then numbers or null) or `csv` (a file
  name `<id>.csv` in the same folder: comma-separated, first line = the column names in order, `.` decimals, an empty
  cell = unknown, no quoting). Each file <= 4 MiB; LF or CRLF.
- Any other key, unit, quantity, order, duplicate, row width, timestamp order or unparsable value invalidates the file
  (first problems listed, at most 20, with the row number).

## Catalog conventions (industrial catalog, REQ-DATA-d7e27def)

| Category | Parameter / attribute | Meaning |
|---|---|---|
| `capacitor` | `reactivePower` (kvar) at conditions `voltage`, `frequency` | rated output at its rated voltage |
| `capacitor` | `overcurrentRatio` (ratio) | continuous overcurrent capacity x In |
| `capacitor` | `capacitanceToleranceMax` (%) | upper capacitance tolerance (raises the current) |
| `capacitor` | `nonLinearShareMax` (%) | permitted share of non-linear loads (Gh / Sn) |
| `capacitor` | attribute `duty` `standard` or `heavy-duty` | duty class for the guide's configuration rule |
| `detuned-reactor` | `tuningFactor` (%), `overcurrentRatio` (ratio) | relative impedance p, permissible current x I1 |
| table kind `detuned step` | entry [capacitor, reactor] at conditions `voltage`, `frequency` with `reactivePower` (kvar, step output at that network voltage), `tuningFactor` (%), optional `overcurrentRatio`, `harmonicVoltageMax` (%, condition `harmonicOrder`), `thdVoltageMax` (%) | the cited capacitor/reactor combination |
| `capacitor-contactor` | `reactivePowerMax` (kvar) at condition `voltage` | capacitor bank power it may switch |
| protection (`fuse-link`, `circuit-breaker`, ...) | `ratedCurrent` or `settingCurrentMax` (A), `magneticTripCurrent` (A) or `magneticTripMultiple` | step protection |

Values go through `selectItems` on a one-item catalog (coverage, confirmed status, most conservative value) or
`findItems`; combinations only through `coordinationFor` with the network voltage and frequency.

## Method

Per sample (a network scenario or a measured interval), in the load convention with inductive Q positive:

- Q1 = Q for `reactive: fundamental` (or `undeclared` with `reactiveAsFundamental`); else from a displacement-factor column, Q1 = P tan(acos|DPF|) with the sign
  from `lead-negative` or from the sign of Q; else unknown. Network scenarios use the board's P and Q (from load power
  factors, i.e. fundamental).
- DPF = P / sqrt(P² + Q1²), lagging when Q1 > 0, leading when Q1 < 0. Total power factor λ = P / S with S measured
  (or P / |PF| from a power-factor column); without both, λ ~ DPF / sqrt(1 + THDi²) (sinusoidal voltage, stated
  approximation); else unknown. Distortion power D² = S² - P² - Q1² (0 when within 1 % below zero, else a message).
- Intervals with P <= 0 (export or idle) or unknown P/Q1 are counted, not compensated.
- Need Qc = max(0, P (tan phi1 - tan phi_t)) with phi_t = acos(target); governing need = the largest.

Bank and steps:

- The network voltage Un comes from the network result (else the measurement file), the frequency f from the measurement
  file (else the source's `frequency` property); an unknown f leaves every step output unknown.
- Step output at the network voltage Un and frequency f: plain capacitor Qs = units x Qn (Un / Ur)² (f / fr) from its
  cited `reactivePower` at (Ur, fr); a capacitor with a reactor only from an applicable `detuned step` entry, Qs =
  units x entry `reactivePower`, p = entry `tuningFactor`. Step current I1 = Qs / (sqrt(3) Un).
- Steps N = ceil(governing need / Qs) (without a candidate: the largest equal step that reaches the target in every
  sample without leading, min P tan phi_t over samples with need, is reported as `stepOutputMax`).
- `fixed-bank`: N x Qs (or the need) <= Q1 in every sample, else fail naming the worst sample (overcompensation).
  `fixed-share`: bank <= 15 % of the supplying transformer's `apparentPower` (EIG commonly applied rule), unknown
  without it. Bank type: fixed when both pass (fixed and conditional when the share is unknown), else automatic.
- Automatic regulation model (the proposal, never applied): per sample n = min(N, ceil(Qc / Qs)), backed off to
  floor(Q1 / Qs) when n Qs > Q1 (never leading). `step-size:<step>` fails when a sample needs n Qs > Q1;
  `step-count:<step>` fails when N > maxSteps (not-evaluated without maxSteps).
- After compensation: Q1' = Q1 - n Qs; DPF' and λ' = P / sqrt(P² + Q1'² + D²) (distortion unchanged).
  `target:<scenario>` DPF' lagging >= target; `total-power-factor:<scenario>` λ' >= totalPowerFactorMin.

Equipment per step candidate `<step>` (`<capacitor code>` or `<capacitor code>+<reactor code>`, `x<units>` when > 1):

- `step-combination:<step>`: a reactor needs an applicable cited `detuned step` entry (pass), else unknown.
- `capacitor-voltage:<step>`: Ur >= max(Un (1 + voltageTolerance), measured maximum U) / (1 - p); unknown without
  voltageTolerance.
- `harmonic-duty:<step>`: plain - Irms / In_r = (Un / Ur)(1 + tol) sqrt(1 + sum (h uh)²) with the measured maximum
  uh per order <= cited `overcurrentRatio`; detuned - every measured maximum Uh and THDu within the entry's cited
  limits. Unknown without voltage harmonics or cited limits.
- `non-linear-share:<step>`: Gh / Sn <= cited `nonLinearShareMax`.
- `configuration:<step>`: EIG Fig. L34 general rule on Gh / Ssc (<= 1/120 standard, <= 1/70 heavy-duty, <= 1/30
  detuned, above: harmonic filtering necessary - not designed here, fails every candidate); the candidate's class is
  detuned with a reactor, else its `duty`.
- `resonance:<step>`: Ssc = sqrt(3) Un ik3Max (maximum fault level, cmax included); for each state n = 1..N the
  parallel resonance order h_n = 1 / sqrt(p + n Qc' / Ssc) with Qc' = Qs (1 - p). Fail when |h_n - h| <= margin x h
  for a significant measured order h; unknown when such an order was not measured, h_n lies above the highest measured
  order, or Ssc, the margin or harmonic columns are missing, or the automatic bank has more than 64 steps (states
  beyond 64 are not evaluated).
- `contactor:<step>`: category `capacitor-contactor` and cited `reactivePowerMax` at Un and f >= Qs; another category
  is unknown.
- `protection:<step>`: rated current (or the top of the setting range) >= Imp = r x I1, r = the capacitor's
  `overcurrentRatio` (plain) or the entry's, else the lower of capacitor and reactor ratios (detuned) - the guide's
  long-time setting rule. `inrush:<step>`: magnetic trip >= 10 x I1 (guide's short-time rule) for breakers with a
  cited magnetic value; fuses not-evaluated.
- `step:<step>`: pass when every evaluated criterion passes (not-evaluated ones, such as a fuse's inrush or an unstated
  maxSteps, are listed and neither pass nor block), fail on a fail, unknown otherwise. `proposal`: the bank type with
  the passing step candidate of the largest step output; unknown (conditional) when a candidate is unknown, no
  candidate is named or a fixed bank's 15 % check is unknown; fail when every candidate fails; pass without a need.

## Result (`producer` `power-quality-pfc` / `pfc`, method `vera-pfc-1`)

- `inputs`: the network result's inputs (stale with them) plus the board, every object fed below it and the source
  feeding it; `catalog` {id, version}.
- `conditions`: `board`, `networkRun`, `measurements` (id, sha256 prefix, origin, rows), `targetPowerFactor`,
  `bankType` (fixed|automatic|none), `step`, `stepOutput` (kvar), `steps`, `bankOutput` (kvar), `controlLogic`
  (text <= 200 characters: target, steps, connect/disconnect rule, reconnection only after the discharge time; no
  setting; the IEC 60831-1 discharge figure is in `limits`).
- `intermediate` (subject = board): per scenario `<s>` (network IDs, `measured-peak`, `measured-light`)
  `activePower:<s>` kW, `reactivePower:<s>` kvar, `displacementFactor:<s>`, `totalPowerFactor:<s>`,
  `compensationNeed:<s>` kvar, `displacementFactorAfter:<s>`, `totalPowerFactorAfter:<s>`; `compensationNeed` (kvar,
  governing), `shortCircuitPower` kVA, `transformerRating` kVA, `measuredIntervals`, `measuredEvaluated`,
  `measuredSkipped`, `measuredGaps`, `thdCurrentMax`, `thdVoltageMax` (%), `harmonicVoltageMax@<h>` (%); per step
  `stepOutput:<step>` kvar, `stepCurrent:<step>` A, `permissibleCurrent:<step>` A, `steps:<step>`,
  `capacitorCurrentRatio:<step>`, `resonanceOrder:<step>@<n>`; `stepOutputMax` kvar.
- `criteria` (subject = board): `fixed-bank`, `fixed-share`, `step-size|step-count|step-combination|capacitor-voltage|
  harmonic-duty|non-linear-share|configuration|resonance|contactor|protection|inrush|step:<step>`, `target:<s>`, `total-power-factor:<s>`, `proposal`. `measured` stands for every measured interval
  in `target:measured`.
- `messages`: the measurement source's full attribution (title, publisher, revision, link, licence, read date,
  changes), the FICTIONAL label for a fictional set, counts of skipped, undetermined and inconsistent intervals.
- `status` `completed` only when every criterion is pass or fail; `blocked` without any scenario.

---
name: power-factor-correction
description: Size reactive power compensation at a board - confirm a current network result, import P/Q/S and harmonic measurements with declared conventions, agree the target and the limits, pick cited capacitors, detuned reactors, contactors and protection, run power_quality and explain displacement versus total power factor, the need, the fixed or automatic bank, overcompensation, equipment and resonance. Use when asked about power factor correction, cos phi, kvar, capacitor banks, detuned reactors, harmonics with capacitors or tariff penalties for reactive energy.
---

The host tool `power_quality` evaluates and stores a result; it never changes the model, switches no step and sets
no regulator. It reads an optional current `electrical_network` result, a measurement file and an industrial catalog.

## 1. Confirm the network result

`electrical_model {"view": "results"}`: take the newest `electrical-network` result whose freshness is `current`
(skill `network-sizing`). It gives the board's P and Q per scenario and the maximum and minimum fault levels for the resonance;
without it the resonance and the guide's configuration rule stay unknown.

## 2. Import the measurements

Write `electrical-automation-measurements/<id>.json` (approved write) for the analyser export: `origin` (`measured`,
or `fictional` for made-up data), `source` with its licence, the `board`, the averaging `interval`, `conventions`
(`power` load or generator, `reactive` fundamental, nonactive or undeclared, `reactiveSign`, `powerFactor` unsigned
or lead-negative), `nominalVoltage`, `frequency` and one column per quantity with its unit; keep the export as
`<id>.csv` with exactly the column names as header. Ask the user for every convention the export does not state -
never guess the sign of Q or whether it is fundamental. When the source does not say, declare `reactive: undeclared`;
only if the user decides to assume fundamental Q, pass `reactiveAsFundamental: true` and say that the displacement
factor and the need rest on that assumption. Keep a third-party set's licence and attribution in `source`.

## 3. Agree the target and the limits with the user

Never choose these yourself: `targetPowerFactor` (displacement, lagging; from the tariff), `totalPowerFactorMin`,
`voltageTolerance` (%), `resonanceMargin`, `harmonicThreshold` (%), `maxSteps` of the regulator and
`harmonicGeneratorPower` (kVA of the drives, rectifiers and other non-linear loads).

## 4. Pick catalog items and run

`industrial_catalog` items of categories `capacitor`, `detuned-reactor`, `capacitor-contactor` and the step
protection; a capacitor with a reactor needs a cited `detuned step` table of the manufacturer. Call `power_quality`
with 1..4 step candidates, then explain:

- per scenario: P, Q1, displacement factor and total power factor, the need and both factors after compensation -
  capacitors correct the displacement part only;
- why the bank is fixed or automatic (overcompensation at the lightest load, the 15 % rule), the steps and the
  control-logic proposal;
- per step candidate the open or failing checks (output, voltage, harmonic duty, non-linear share, configuration,
  resonance, contactor, protection, inrush) and what data would close them;
- the limits: no filter design, no switching transients, no full power-quality report.

It is preliminary engineering support: no verified design and no conformity statement.

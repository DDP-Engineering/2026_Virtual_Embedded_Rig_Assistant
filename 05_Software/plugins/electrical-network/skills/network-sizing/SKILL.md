---
name: network-sizing
description: Calculate a radial LV network of the electrical model - check the model data, choose a cited cable table, define scenarios with simultaneity, run electrical_network, and explain the load balance, cable sections with their governing criterion, voltage drop and fault currents, with every unknown and not-evaluated point. Use when asked for a load balance, cable sizing, voltage drop, short-circuit or fault-level calculation of a low-voltage installation.
---

The host tool `electrical_network` calculates and stores a result; it never changes the model. Read the model with
`electrical_model` first and propose missing data with `electrical_model_change` (the user approves it).

## 1. Check the inputs

`electrical_model {"view": "summary"}`, then the objects of the network. The engine reads these names:

- source: attributes `kind` (`transformer` or `supply`), `system` (TN-S, TN-C, TN-C-S, TT, IT), `vectorGroup`;
  properties `ratedVoltage`, `phases` (3); transformer `apparentPower`, `impedanceVoltage` (%), `loadLosses`,
  `networkShortCircuitPower` and `networkShortCircuitPowerMin` (MVA); supply `shortCircuitCurrent`,
  `shortCircuitCurrentMin`, `resistanceReactanceRatio`, `earthFaultLoopImpedance`.
- circuit: `phases` and attribute `phase` (L1/L2/L3) for single-phase circuits; exactly one cable `routes` it.
- cable: `length`, `crossSection` (null: the engine proposes one), attribute `installationMethod` (a method id of
  the table), `ambientTemperature`, `groupedCircuits`, optional `protectiveConductorCrossSection`.
- load: `power` or `apparentPower`, `powerFactor`, `phases`, optional `demandFactor`, attribute `category`
  (`lighting` uses the lighting voltage-drop limit); motor: `ratedPower`, `efficiency`, `powerFactor` or
  `ratedCurrent`; protection that `protects` the circuit: `ratedCurrent`.

Ask the user for every missing value; never invent an installation method, an ambient temperature, a grouping or
a fault level. A missing value is reported unknown, never as a pass.

## 2. Choose the cable table and the scenarios

Cable tables are files in `electrical-automation-tables/` (`list` the folder, read the one that matches the cable
type). Each value cites its source; tell the user which table and revision you use, and that factors outside the
table are not covered. Agree with the user on the scenarios (normal, peak, one machine stopped), the simultaneity
factors per board, the voltage-drop limits and whether to check the short-circuit withstand (`faultDuration`).
When the table gives no reactance (for example a product page), agree an `assumedReactance` in Ω/km with the
user (it is recorded as an assumption); without it the voltage drop and fault currents stay unknown.

```text
electrical_network {"cableTable": "<id>", "voltageTolerance": 10,
  "scenarios": [{"id": "normal", "title": "Normal operation", "simultaneity": {"brd-main": 0.9}},
                {"id": "pump-off", "title": "Pump stopped", "loads": {"mot-p1": 0}}],
  "voltageDropLimit": {"value": 4, "unit": "%"}, "voltageDropLimitLighting": {"value": 3, "unit": "%"}}
```

## 3. Explain the result

Read the returned report (or `electrical_model {"view": "report", "runId": "<run>"}`):

- per scenario the boards' P, Q, S, phase and neutral currents;
- per circuit the design current, the checked or proposed cross-section and the governing criterion
  (current-capacity, voltage-drop or short-circuit-withstand) with its scenario, the corrected rating Iz with the
  temperature and grouping factors, and the cumulative voltage drop against its limit;
- the fault currents Ik3 max and peak at boards and circuit origins (for breaking capacity) and Ik3 min / Ik1 min
  at circuit ends (for disconnection, checked by protection coordination);
- every `unknown` and `not-evaluated` criterion with its reason, the assumptions and the method's limits.

Say that the result is preliminary and not a conformity statement. A proposed cross-section is a proposal: when the
user accepts it, propose `electrical_model_change` (the cable's `crossSection` with basis `proposal`) for
approval. After any model change, the stored result is stale; run the calculation again.

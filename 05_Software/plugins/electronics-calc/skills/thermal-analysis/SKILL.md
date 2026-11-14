---
name: thermal-analysis
description: Estimate junction, case and heatsink temperatures from dissipated power - thetaJA estimates, junction-to-case paths with a heatsink, heatsink sizing and transient Foster networks. Use when a part's temperature or thermal margin is in question.
---

Use `run_program` with program `elec-calc`. A temperature estimate is only as
good as its thermal data: keep every thermal resistance with its `source` and
`conditions`. Never invent a thermal resistance or a power; ask for it.

## 1. Get the power

Compute the dissipation first with `elec-calc losses` (skill
`electronics-sizing`) or take it from a measurement, and say which.

## 2. Choose one thermal path

thetaJA and a junction-to-case path are two descriptions of the same heat
flow. Use exactly one; the program refuses a mix.

- No heatsink, board-mounted part: model `junction-ambient` with `thetaJA` and
  its conditions (board, copper area, airflow). It is an estimate valid for
  that test board, not for every layout.
- Heat leaves through the case into a heatsink: model `junction-case-sink`
  with `thetaJC`, `thetaCS` (interface) and `thetaSA` (heatsink), or `thetaCA`
  when the case cools directly to air.

```text
elec-calc thermal --json {"model":"junction-ambient","power":"1 W","tAmbient":"40 °C","thetaJA":{"value":50,"unit":"K/W","conditions":"JEDEC 2s2p board, still air","source":"Datasheet rev. B, section 6.4"},"tJunctionMax":"125 °C"}
elec-calc thermal --json {"model":"junction-case-sink","power":"10 W","tAmbient":"25 °C","thetaJC":"1.5 K/W","thetaCS":"0.5 K/W","thetaSA":"5 K/W","tJunctionMax":"150 °C"}
```

Give `tJunctionMax` from the datasheet so the `junction-limit` check and
`junctionMargin` are evaluated. Use the highest ambient the product must work
in, not room temperature.

## 3. Size a heatsink

```text
elec-calc thermal --json {"model":"junction-case-sink","power":"10 W","tAmbient":"50 °C","thetaJC":"1.5 K/W","thetaCS":"0.5 K/W","tJunctionMax":"125 °C","solveFor":"thetaSA"}
```

`thetaSAMax` is the largest sink-to-ambient resistance that keeps the junction
at its maximum; choose a heatsink below it with margin. `heatsink-feasible:
fail` means no heatsink can meet the limit - reduce the power or the path
resistances.

## 4. Transients

For a power step shorter than the thermal settling time, use the Foster
network of the datasheet (pairs of R and tau, or R and C) with model `foster`:

```text
elec-calc thermal --json {"model":"foster","power":"10 W","tReference":"25 °C","stages":[{"resistance":"1 K/W","tau":"1 ms"},{"resistance":"2 K/W","capacitance":"0.05 J/K"}],"times":["1 ms","10 ms","1 s"]}
```

It covers one step from thermal equilibrium. Repetitive pulses, Cauer networks
and board-level heat spreading are outside the program; say so instead of
approximating them.

## 5. Report

- Quote junction, case and sink temperatures as separate values with °C.
- `thetaja-conditions: unknown` means the thetaJA came without conditions:
  state that the estimate may not describe this board.
- Repeat the `limits` of the result: steady state, one heat source, no
  neighbouring heat.
- For a value that must hold over tolerances, run `elec-calc tolerance` with
  the thermal request as `target` and `min`/`max` for the ambient temperature.
- Save the calculations with `elec-calc report` when the user will keep them.

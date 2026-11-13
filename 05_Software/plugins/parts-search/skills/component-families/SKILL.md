---
name: component-families
description: Checks per component family for evidence-based selection - MOSFETs, linear and switching regulators, op-amps, resistors, capacitors (MLCC DC bias), diodes and inductors - with the parameters, conditions and pitfalls to confirm in the datasheet. Use with component-selection when writing hard constraints.
---

Write each check as a `parts-compare` constraint with the conditions it needs. A value is evidence only at the
stated conditions and with a guaranteed basis (`max` for an upper limit, `min` for a lower one, `rating` for an
absolute maximum); a typical value is context, not proof.

## MOSFET

- `VDS >=` bus voltage plus margin (rating); `ID` at the case temperature the datasheet states.
- `RDS(on) <=` limit **at VGS <= the real gate drive** and at the junction temperature you expect: take the max
  value of the table row with that VGS. VGS(th) is not evidence of conduction at 3.3 V.
- Linear or pulsed operation: the SOA curve at the pulse width - curves are read by a person and recorded as
  confirmed only after that.
- Gate charge `Qg` at the drive voltage for switching losses; body-diode `trr` for synchronous use.

## Regulator

- Linear: dropout `max` at the load current and temperature; `Vin` rating; quiescent current; thermal resistance
  and the dissipation `(Vin - Vout) * Iout` (elec-calc `losses`).
- Switching: input range, output current, switching frequency, minimum on-time at the input/output ratio, and the
  inductor and capacitor requirements of the datasheet's application section.

## Op-amp

- Supply range; input common-mode range and output swing **at your supply and load** (rail-to-rail claims have
  conditions); GBW and slew rate (`V/µs`); offset `max` and its drift; input bias current at temperature; stability
  with a capacitive load.

## Resistor

- Value and tolerance (nominal), power rating with its derating temperature, voltage rating, TCR (`ppm/°C`, a unit
  text that compares only with itself), pulse capability for surge paths.

## Capacitor

- MLCC: capacitance **under DC bias** at your voltage (the manufacturer's DC-bias data; a person reads curves),
  dielectric (C0G, X7R), voltage rating, temperature range. Electrolytic: ripple current at frequency and
  temperature, ESR, lifetime at temperature.

## Diode

- `VRRM` rating; `IF(AV)`; `VF` max at the current and temperature; reverse leakage at temperature; `trr` or the
  Schottky capacitance for switching; surge `IFSM`.

## Inductor

- Inductance at the operating current; `Isat` (with its definition, a drop in %) and `Irms` (temperature rise)
  from the datasheet; DCR max; shielding; self-resonant frequency.

## Before calling a part a replacement

Compare pinout and footprint with the replaced part from datasheet pages; pinout variants have different MPNs and
are different devices.

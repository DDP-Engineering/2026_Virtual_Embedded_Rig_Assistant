---
name: motor-starting
description: Choose how a motor is started or driven and size its starter - confirm current network and protection results, agree the process function and limits, complete the motor and load data, pick cited contactors, overload relays, softstarters or drives, run motor_drives and explain the method comparison, the proposal, the assembly and its connection and interlock scheme. Use when asked about DOL, reversing, star-delta, softstarter or VFD selection, starting current or time, contactor or overload relay sizing, drive duty class, braking or motor cable limits.
---

The host tool `motor_drives` evaluates and stores a result; it never changes the model and never configures or
parameterises a device. It needs a current `protection_coordination` result (which needs a current
`electrical_network` result) and an industrial catalog.

## 1. Confirm the stored results

`electrical_model {"view": "results"}`: take the newest `protection-coordination` result whose freshness is
`current`. A stale one is refused - run `electrical_network` and `protection_coordination` again (skills
`network-sizing`, `protection-selection`). Name the motor circuit's protective device as a candidate there, and the
starter pair (protection + contactor, type 1 or 2) when the user wants coordination.

## 2. Agree the process function and limits with the user

Never choose these yourself: `reversing`, `speedControl`, `inching`, the network or utility `startingCurrentMax`
(A, line), `accelerationTimeMax` and `stopTimeMax` (s), the star-delta `switchover` speed (share of rated speed), a
softstarter `currentLimit` (x In) and the panel `ambientTemperature` (°C) and `altitude` (m).

## 3. Complete the motor data

From the motor and machine datasheets, through `electrical_model_change` approved by the user: nameplate
(`ratedPower`, `ratedVoltage` with attribute `connection`, `ratedCurrent`, `speed`, `frequency`, `terminals`), the
torque and current ratios (`startingCurrentRatio`, `startingTorqueRatio`, `pullUpTorqueRatio`,
`breakdownTorqueRatio`), `inertia`, `loadInertia`, `loadTorque`, `breakawayTorque`, attribute `loadCharacteristic`,
`lockedRotorTime`, `startsPerHour` and `startsPerHourMax`. A missing value stays unknown and keeps the dependent
checks open - never fill it with a typical value.

## 4. Pick catalog items and run

`industrial_catalog` items of categories `contactor`, `overload-relay`, `softstarter` and `variable-speed-drive`
(drives with `ratedCurrent` and `overloadCurrent` per `dutyClass`). Call `motor_drives` with 1..4 motors, then explain:

- per motor the method table: function, eligibility, starting current, accelerating torque (stall), acceleration
  time and starts per hour, and why each method passes, fails or stays open;
- the proposal and whether it is conditional, with the open or failing assembly checks (contactor per position and
  utilisation category, interlock accessory, overload relay setting and band, softstarter or drive current and
  overload, protective device and starter coordination from the protection result);
- the curve points (`motorTorque:<method>@<pct>`, `loadTorque@<pct>`) and the acceleration time as model values with
  the stated assumptions, not guaranteed performance;
- braking, EMC and motor cable only as far as cited data reach; anything else is a question for the manufacturer.

The scheme in `assemblies` is a logical starting point for drawings. It is preliminary engineering support: no
verified design, no conformity statement and no validated safety function.

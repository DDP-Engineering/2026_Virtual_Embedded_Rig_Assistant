# REQ-DATA-79118f9a — Motor drives request, model and catalog conventions and the motor drives result, format 1

## Behavior

The plugin `motor-drives` (ecosystem `electrical`) brings the skill; VERA brings the engine and the write tool
`motor_drives`, offered only while the plugin `motor-drives` is loaded (never read-only). One run reads the
electrical model (REQ-DATA-06c0bd54), ONE stored `protection-coordination` result (REQ-DATA-a5673202) that is current,
the `electrical-network` result that protection result names (also current) and ONE industrial catalog
(REQ-DATA-d7e27def). Per requested motor it compares direct-on-line (`dol`), reversing (`reversing`), star-delta
(`star-delta`), softstarter (`softstarter`) and variable-speed drive (`vfd`) against the process function, proposes the
simplest feasible method, sizes the assembly for that method and prepares one new result file
`electrical-automation-results/<run-id>/result.json` with a logical connection and interlock scheme (`assemblies`).
The model, the catalog and every device are only read; no drive is configured or parameterised and no safety function
is claimed.

The engine is "VERA motor drives 1" (`vera-motor-drives-1`). It is preliminary engineering support, not a verified
design and no conformity statement.

## Request (`motor_drives` arguments)

```json
{"protection": "20261115-111500-ab12", "catalog": "cat-motor-drives", "ambientTemperature": 35, "altitude": 400,
 "motors": [{"motor": "mot-p2", "startingCurrentMax": 80, "accelerationTimeMax": 10, "switchover": 0.85,
             "protection": "itm-c10g32", "contactor": "itm-lc1d18p7", "starContactor": "itm-lc1d09p7",
             "overloadRelay": "itm-lrd21"}]}
```

Numbers carry fixed units; bounds are refinements.

- `protection`: run ID of a current `protection-coordination` / `protection` result; its condition `networkRun`
  names the network result, which must exist, come from `electrical-network` / `network` and be current too.
- `catalog`: catalog ID (read strictly with `readCatalogFile`).
- `ambientTemperature` (°C, -50 < x <= 100) and `altitude` (m, 0 <= x <= 6000): panel conditions for the devices;
  absent = not stated (values whose catalog conditions need them stay covered only if the item names no bound).
- `motors` 1..4, unique `motor`; each a model object of type `motor` fed by exactly one circuit (`feeds`).
  - `reversing`, `speedControl`, `inching` (booleans, default false): the process function.
  - `startingCurrentMax` (A, line, > 0): network or utility limit on the starting current.
  - `accelerationTimeMax` (s, 0 < t <= 600), `stopTimeMax` (s, 0 < t <= 600): process limits.
  - `switchover` (ratio of rated speed, 0 < x < 1): star-delta switch-over speed.
  - `currentLimit` (ratio x In, 1 < x <= 10): softstarter current limit (else the device's `currentLimitMax`).
  - items (catalog IDs): `protection` (the circuit's protective device, a candidate of the protection run),
    `contactor` (line, reversing, delta or bypass contactor), `starContactor` (else `contactor`), `overloadRelay`,
    `softstarter`, `drive`.
- Strict: an unknown key, a motor that is not a motor of the model or not fed by one circuit, an item missing from
  the catalog, a repeated motor or an invalid number throw before anything is prepared.

## Model data read (motor object; absent or `null` = unknown, never zero)

| Property / attribute | Unit | Meaning |
|---|---|---|
| `ratedPower`, `ratedVoltage`, `ratedCurrent` | W, V, A | nameplate at the stated connection |
| `speed`, `frequency` | rpm, Hz | rated speed and supply frequency; synchronous speed = 120 f / p with p the even pole count 2 x floor(60 f / n) |
| `startingCurrentRatio` | ratio | locked-rotor current Ist / In |
| `startingTorqueRatio`, `pullUpTorqueRatio`, `breakdownTorqueRatio` | ratio | Tst, Tu, Tk over the rated torque |
| `inertia`, `loadInertia` | kg·m² | rotor and load inertia (load referred to the motor shaft) |
| attribute `loadCharacteristic` | text | `constant`, `linear` or `quadratic` |
| `loadTorque`, `breakawayTorque` | Nm | load torque at rated speed; at standstill (needed for linear and quadratic) |
| `lockedRotorTime` | s | permissible locked-rotor (starting) time from the motor data |
| `startsPerHour`, `startsPerHourMax` | 1/h | required starts; permissible motor starts |
| `terminals` | ratio | terminals brought out (6 for star-delta) |
| attribute `connection` | text | `delta` or `star`: winding connection at `ratedVoltage` |
| attribute `duty` | text | duty type (S1..S10), reported only |

From the stored results: the network's `nominalVoltage` condition (Un); the protection result's
`selection:<orderCode>` and `starter-type-<n>:<protection>/<contactor>` criteria of the motor's circuit. From the model:
the cable that `routes` the circuit (`length`).

## Catalog conventions read

Family categories: `contactor`, `overload-relay`, `softstarter`, `variable-speed-drive`; protective devices are named
only to find their verdicts in the protection result (by order code).

| Parameter / attribute | Unit | Meaning |
|---|---|---|
| `ratedCurrent` (conditions `utilisationCategory`, `voltage*`, `ambientTemperature*`) | A | contactor Ie per utilisation category |
| `ratedVoltage` (condition `circuit` power or `currentKind` AC) | V | Ue |
| accessory role `mechanical-interlock` | - | interlock for reversing and star-delta contactor pairs |
| `settingCurrentMin`, `settingCurrentMax` | A | overload relay setting range |
| `tripTimeMin`, `tripTimeMax` (condition `currentMultiple`) | s | tripping time band from cold at that multiple of the setting |
| attribute `tripUnit` containing `thermal` | text | a protective device that also protects against overload |
| attribute `motorThermalProtection` `integrated` | text | softstarter or drive protecting the motor thermally |
| softstarter `ratedCurrent` (condition `dutyClass`, ambient/altitude bounds), `currentLimitMax` | A, ratio | IcL and the maximum current limit x In |
| attribute `bypass` `internal` | text | built-in bypass; otherwise a bypass contactor is needed |
| `ambientDeratingPerKelvin` (condition `ambientTemperatureMin/Max`), `altitudeDeratingPer100m` (`altitudeMin/Max`) | % | current derating above the bound of the base rating |
| drive `ratedCurrent` and `overloadCurrent` (conditions `dutyClass`, `overloadTime`) | A, s | continuous and transient output current per duty class |
| `supplyVoltageMin`, `supplyVoltageMax`, `inputCurrentMax` | V, A | supply range and maximum input current |
| attributes `brakingChopper`, `emcCategory`, `rcdTypes`; `motorCableLengthMax` | text, m | braking, EMC and protection data |

Values follow the catalog selection rules (REQ-FUNC-742db7ea): confirmed, covering the requested conditions, the most
conservative decides.

## Method (implemented)

Motor: In, Tn = P / (2 pi n / 60), synchronous speed ns, rated slip sN. Torque curve: Kloss
T = 2 Tk / (s/sk + sk/s) from breakdown speed to synchronous speed with sk = sN (k + sqrt(k² - 1)), k = Tk/Tn; below
breakdown speed the torque is the smaller of Tu (when stated; by definition the lowest torque in that range) and Tst.
When Tu is not stated, Tst stands in, the result says so and the `starting-torque` verdict of the non-VFD methods stays
unknown, because Tst is not a lower bound of the curve. Load: constant Tl = loadTorque; linear and quadratic
Tl = Tb + (Tload - Tb)(n/nN)^k. Acceleration time t = (J + JL) 2 pi / 60 x integral dn / (Tm(n) - Tl(n)), midpoint
rule over 2000 steps from 0 to 98 % of the steady speed where Tm = Tl (VFD: to rated speed). A non-positive
accelerating torque below the end speed = stall.

Per method: `dol`/`reversing` Tm, Ist. `star-delta` Tm/3 and Ist/3 up to `switchover` x nN, then Tm (the switch-over
transient is not modelled). `softstarter` Tm x (r / I(n))² with I(n) = Ist/In below breakdown speed falling linearly to 1
at rated speed, line current min(r, Ist/In) x In with r = `currentLimit` or the device's `currentLimitMax`. `vfd` constant torque min(Iov / In, Tk/Tn) x Tn to rated speed (Iov = the selected drive's
transient current; a current of k x In with k >= 1 gives at least k x Tn at rated flux), line current = the drive's
`inputCurrentMax`.

Criteria per motor (subject = motor) and method `<check>:<method>`: `function` (reversing not required -> method `reversing` not
evaluated; speed control -> every other method fails; reversing -> dol fails, reversing and vfd pass, star-delta and
softstarter not evaluated; inching -> star-delta and softstarter not evaluated), `star-delta-eligibility` (terminals >= 6,
connection delta, |ratedVoltage - Un| <= 1 % Un), `starting-current` (<= startingCurrentMax), `starting-torque` (no
stall; star stage reaches `switchover`), `acceleration-time` (<= accelerationTimeMax and < lockedRotorTime for the
non-VFD methods; with a limit stated but no lockedRotorTime a non-VFD pass is unknown), `starts-per-hour` (<= motor `startsPerHourMax` and the softstarter's), and `method:<m>` (fail when
one fails; not-evaluated when `function` is; unknown when one is unknown; else pass). `proposal`: the first passing
method in the order dol, reversing, star-delta, softstarter, vfd; conditional (unknown) when an earlier method is
unknown, its assembly is not established or no method passes but one is unknown; fail when every method fails.

Assembly for the proposed method: contactor currents In (dol/reversing, AC-3; AC-4 with inching), In/sqrt(3) line and
delta and In/3 star (AC-3), external bypass In (AC-1); `mechanical-interlock` accessory for reversing and star-delta;
overload relay at In (dol/reversing, unless the protective device has a thermal trip), at In/sqrt(3) (star-delta), at
In for a softstarter or drive unless its attribute `motorThermalProtection` is `integrated`; relay start check: pass when the starting current multiple <= the
cited `currentMultiple` and t <= `tripTimeMin`, fail when the multiple >= it and t > `tripTimeMax`; softstarter IcL >=
In after cited derating; drive: the first cited duty class (light, normal, heavy, then others by name) with continuous
current >= In after derating, transient current >= required current (k x In, k = (max Tl + J ω / accelerationTimeMax) / Tn) and t <=
`overloadTime`. Braking (with `stopTimeMax`): kinetic energy and mean braking power reported, verdict unknown with the
drive's chopper attribute; EMC category, motor cable length and RCD types only from cited data. Protection: the
protection result's `selection:<code>` and `starter-type-*` verdicts are copied, never recomputed.

## Result written

`producer {plugin: "motor-drives", operation: "motor-starting", engine {name: "vera-motor-drives", version:
"1.0.0"}}`, `method {id: "vera-motor-drives-1", ...}`, `preliminary: true`, `catalog {id, version}`. `inputs`: every
input of the protection result plus the motors, their circuits, cables and relations this run read. `conditions`:
`protectionRun`, `networkRun`, `catalog`, `ambientTemperature`, `altitude`, `proposal<N>` (text `<motor> <method>`).
Intermediate per motor: `ratedTorque` Nm, `synchronousSpeed` rpm, `totalInertia` kg·m²; per method
`startingCurrent:<m>` A, `startingTorque:<m>` Nm, `accelerationTime:<m>` s; for the proposed method torque curve
points `motorTorque:<m>@<pct>` and `loadTorque@<pct>` (pct 0, 25, 50, 75, 90, 100 of synchronous speed); braking
`brakingEnergy` J and `brakingPower` W. `assemblies`: per proposed motor `{motor, circuit, method, conditional,
devices [{tag, role, item, orderCode, setting?}], connections [{from, to, kind}], interlocks [{kind, devices, note}]}`
(REQ-DATA-e3d5c15f). Status `completed` only when every criterion is pass or fail.

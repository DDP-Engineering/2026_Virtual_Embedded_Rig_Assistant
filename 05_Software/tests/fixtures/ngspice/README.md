# ngspice fixtures

Fictional circuits for `ngspice-tool`. Every expected value below is derived by hand, with its tolerance, before any
engine run; the test asserts these numbers.

## Analytic references (E04-A, E04-B)

| Fixture | Request | Expected | Tolerance | Derivation |
|---|---|---|---|---|
| divider.cir | op, final v(out) | 2.163934 V | 1e-6 relative | 12 V x 2.2k / (10k + 2.2k) |
| divider.cir | op, RB = 10k | 6.000000 V | 1e-6 relative | 12 V x 10k / 20k (alterparam) |
| rc.cir | tran 1 us..5 ms, v(out) at 1 ms | 0.632121 V | 0.2 % | 1 - e^-1, tau = 1k x 1u = 1 ms |
| rc.cir | ac dec 100, vdb(out) at 159.155 Hz | -3.0103 dB | 0.01 dB | 1/(2 pi R C) = 159.155 Hz, 20 log10(1/sqrt 2) |
| rectifier.cir | tran 10 us..40 ms, max v(out) | 9.0 .. 9.6 V | range | 10 V peak minus a forward voltage of 0.4..1.0 V |
| rectifier.cir | average v(out) 20..40 ms | max/pi | 5 % | half-wave average of a sine of that peak; the diode's conduction angle lowers it slightly |
| switch.cir | average power v(a) x i(Vsense) 1..2 ms | 7.058 W | 0.5 % | I_on = 12/(10 + 0.1) A, P_on = I_on^2 x 10 = 14.116 W, duty 0.5 |
| switch.cir | peak instantaneous power | 14.116 W | 0.5 % | differs from the average by the duty factor |
| thermal.cir | tran 1 ms..10 s, final v(tj) | 90 (degC) | 0.1 % | 40 + 1 W x 50 K/W; tau = 50 x 0.01 = 0.5 s, e^-20 negligible; elec-calc thermal gives 90 °C |
| noise.cir | noise v(out) V1 dec 5 10..1k Hz, onoise | 2.8789e-9 V/sqrt(Hz) | 1 % | sqrt(4 k T R), T = 300.15 K, R = 1k parallel 1k = 500 ohm |

The voltage of `v(tj)` stands for a temperature (1 V = 1 °C) and the source current for a power (1 A = 1 W): a lumped
thermal network, not an electrothermal device model.

## Failures (E04-C)

- missing-model.cir: D1 names `DNOPE` - refused before the engine (`model`, exit 2).
- pins.cir: X1 connects 2 nodes to the 3-port `AMP` - refused (`pins`, exit 2).
- singular.cir: two DC sources in parallel - the engine reports a singular matrix and gmin/source stepping failures,
  writes no series: status failed, exit 3, criteria not-evaluated.
- divider.cir with vector `v(nonode)`: "Error: no such vector", no series - failed, exit 3.

## Sweeps (E04-D)

- load.cir: R2 = RLOAD below R1 = 1k from 10 V: v(out) = 10 x RLOAD / (1k + RLOAD) - 1k gives 5 V, 3k gives 7.5 V.
- Monte Carlo on RLOAD (nominal 1k, 10 %, uniform, seed 7, 5 runs): the same seed gives the same drawn values; seed 8
  gives others; every drawn value lies within 900..1100 ohm.

## Hostile netlists (E04-E), all refused with exit 2 before the engine

| File | Refusal |
|---|---|
| hostile/control.cir | `.control` / `.endc` cards and the word `shell` |
| hostile/exec.cir | unknown card `.exec` |
| hostile/osdi.cir | `pre_osdi` on a continuation line |
| hostile/outside.cir | include `../../outside.lib` leaves the working directory |
| hostile/nested.cir | the included nested.lib holds the word `shell` |
| hostile/missing.cir | the include does not exist |
| hostile/deep.cir | an include chain deeper than 16 files |
| hostile/star-hash.cir, star-hash-include.cir (+ star-hash.lib) | a `*#` line - ngspice runs it as a control command - in the netlist and in an include |
| hostile/semi-hash.cir, semi-hash-include.cir (+ semi-hash.lib), bang-hash.cir | `;#` and `!#` lines: ngspice turns the leading punctuation into `*` |
| hostile/xspice.cir | an XSPICE `A` instance of a `d_process` model (code models start programs or read files) |

hostile/title-include.cir is accepted: its `.include title-evil.cir` stands on the title line, which the effective copy
replaces, so the file is never read (the log has no `TITLE-INCLUDE-RAN`).

## Further references (review cases)

- rc.cir AC, v(out) at 10 Hz: |H| = 1 / sqrt(1 + (2 pi x 10 Hz x 1 ms)^2) = 0.998031, within 1e-6.
- A circuit without noise generators (E1 gain stage driving C1): output noise zero everywhere -> status not-applicable.
- switch.cir, supply power v(vin) x i(V1) over 1..2 ms: -(12 V x 12/10.1 A x 0.5) = -7.129 W, 0.5 %; rms of i(Vsense):
  12/10.1 A x sqrt(0.5) = 0.8401 A, 0.5 %.
- rc.cir step: min 0, peak-to-peak = ripple = 1 - e^-5 = 0.993262, overshoot 0, settling within 2 % of the final value at
  -ln(0.026603) ms = 3.627 ms (0.5 %).

## Limits

- slow.cir with a transient of 2 000 000 points on the standard profile is refused (limit, exit 2); with the long
  profile and a 1 s time limit the engine is stopped (status timeout, exit 3).

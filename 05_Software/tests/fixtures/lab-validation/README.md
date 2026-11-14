# lab-validation fixtures

`tests/integration/lab-validation.test.ts` generates its synthetic signals from the closed forms below (in
TypeScript, never through the plugin), writes them as CSV files or as ngspice-tool/ltspice-tool run folders that follow
spec REQ-DATA-29b9a988 section 6, and compares `lab-validate` with the solutions derived here. Every expected value and
tolerance was fixed by hand before the helper existed (work package criterion L02-A); none was copied from program
output.

`guard/sitecustomize.py` is put on `PYTHONPATH` by the no-network test: it makes every socket, `subprocess` and
`os.system` call raise, so an operation that tried one would fail.

LAB-01 captures are not fixtures: the test runs the real scpi-instruments helper against its fake PyVISA
(`tests/fixtures/scpi-instruments/fake-pyvisa`, offline, no instrument) and imports the run folder it writes.

## Signals and solutions

**Sine.** v(t) = 2 sin(2 pi 1000 t) V, sampled at 100 kHz from 0 to 10 ms (1001 samples). Window [0.25 ms, 5.25 ms]
holds exactly five periods. RMS = 2 / sqrt(2) = 1.41421356 V: the trapezoid rule over whole periods of a sampled
sinusoid with 100 samples per period equals the sample mean of sin^2, which is exactly 1/2, so the tolerance is 1e-6
relative. Mean 0 V (+-1e-9 V). Rising 50 % crossings at 1, 2, 3, 4 and 5 ms: frequency 1000 Hz (1e-6 relative).

**PWM.** Period 100 us; within each period the level rises linearly 0 -> 3.3 V over [0, 1 us], stays 3.3 V to 30 us,
falls linearly over [30, 31 us], stays 0 V. Sampled at 10 MHz (0.1 us) from 0 to 1 ms. 50 % points at 0.5 us and
30.5 us of each period: frequency 10 kHz, duty cycle 30 % (both 1e-6 relative). Derived levels: 0 V and 3.3 V (the
medians below and above 1.65 V). Rise time 10-90 % of the ramp = 0.8 us; fall time 0.8 us (1e-6 relative; the 10 %
and 90 % points fall on samples).

**RC step.** v(t) = 0 for t < 0 and 5 (1 - exp(-t / tau)) V for t >= 0, tau = 10 us, sampled at 10 MHz from -20 us
to 200 us. With declared levels 0 V and 5 V: rise time 10-90 % = tau ln 9 = 21.9722458 us. Linear interpolation
between samples errs by about dt^2 / (8 tau) = 1.25e-10 s per crossing, so the tolerance is 1e-4 relative. Settling
to +-2 % of the step (0.1 V) around 5 V, counted from the 50 % crossing tau ln 2: the signal enters the band at
tau ln 50, so the settling time is tau ln 25 = 32.1887582 us (1e-4 relative). A window ending at 30 us is shorter
than that: the value is a lower bound of 30 us - tau ln 2 = 23.0685282 us.

**Second-order step.** v(t) = 1 - exp(-zeta wn t) (cos wd t + zeta / sqrt(1 - zeta^2) sin wd t) V for t >= 0,
zeta = 0.5, wn = 2 pi 10 kHz, wd = wn sqrt(1 - zeta^2), sampled at 10 MHz from 0 to 500 us. Overshoot with declared
levels 0 V and 1 V: 100 exp(-zeta pi / sqrt(1 - zeta^2)) = 16.3033535 %. The sampled peak is within
v'' (dt / 2)^2 / 2 < 1e-6 V of the true peak, so the tolerance is 0.001 % absolute.

**Ripple.** 3.3 V plus a triangle of 20 mV peak-to-peak at 100 kHz (apexes on the 0.1 us sample grid), sampled at
10 MHz from 0 to 300 us. Ripple over [100 us, 200 us] = 20 mV (1e-6 relative); mean 3.3 V (1e-6 relative).

**Units (L02-B).** The PWM written as seconds/volts and as milliseconds/millivolts with sign -1 (the column holds
-1000 x the voltage) gives the same normalized series and metrics after `sign: -1`.

**Delay and lag (L02-D).** Reference: a 5 V pulse from 0 to 100 us through tau = 10 us (rising as the RC step,
falling from its value at 100 us as v(100 us) exp(-(t - 100 us) / tau)), as an ngspice-tool run folder on a
non-uniform grid (0.1 us steps to 150 us, 0.5 us steps to 300 us). Measured: the same pulse delayed by 30 us, sampled
at 10 MHz from -50 us to 300 us. Cross-correlation within 100 us finds a lag of 30 us (+-0.1 us); the error after the
shift stays below 5 mV, so `max-abs <= 50 mV` passes while `lag == 0 s +- 10 us` fails: verdict fail. Without
alignment the maximum error is near 5 V. With `maxLag` 20 us the peak lies at the bound: `lag-at-limit`.

**Simulation from t = 0.** The same reference sampled from 0 s (0.1 us to 150 us, 0.5 us to 300 us). Against the
measured pulse in [0, 250 us], the reference shifted by 30 us starts 30 us into the window: `reference-short`, so
`max-abs <= 50 mV` is incomplete, while the lag (30 us +-0.1 us, from the overlapping samples) fails `<= 10 us`.
With `offset` 30 us against the reference from -50 us the maximum error stays below 5 mV.

**Delay.** One CSV at 10 MHz from 0 to 200 us: `in` = 10 (1 - exp(-(t - 20 us) / tau)) V from 20 us, `out` =
1 - exp(-(t - 50 us) / tau) V from 50 us. With declared levels 0/1 V and 0/10 V both 50 % points lie tau ln 2 after
their starts, on the same sample offsets: delay 30 us (1e-10 s). With derived levels (medians of the states, 0 V and
about 0.9996 V or 9.991 V) the 50 % points move by a few ns: 30 us +-0.2 us; declaring only the `out` levels must not
give the reference 0/1 V levels (that would put its edge at 0.5 V of a 10 V step, 6.4 us later).

**Cross-correlation bounds.** 1000 samples at 1 MHz, a 20 s gap and 1000 more, against itself with maxLag 10 us: lag
0, within seconds (the work is 2000 x 21 points, not the 20 s span). 5 V plus 1 uV x sin(2 pi 10 kHz t), `m` lagging
`r` by 40 us, window [500 us, 1500 us], maxLag 50 us: lag 40 us (+-1 us) and a correlation of at most 1.

**Filter width.** A moving average of 2.1 us at 1 MHz takes the odd count nearest 2.1, 3 samples: realized width
3 us, 10-90 % time 2.4 us.

**Decisions.** A constant 1.000 V for 1 ms has mean 1 V exactly. Limits around it under `<=`: 1.05 V with uncertainty
0.02 V passes (guarded), 1.01 V with 0.02 V is incomplete (guarded) and passes (simple), 0.97 V with 0.02 V fails
(guarded), guarded without uncertainty is incomplete, `== 1.02 V +- 1 %` (interval [1.0098, 1.0302] V) fails. On the limit:
`<= 1 V` with uncertainty 0 V passes, `>= 1 V` simple passes, `<= 1 V` with 1 mV is incomplete.

**Diagnostics (L02-E).** The sine at 1 kHz sampled at 3 kHz has 3 samples per period: `aliasing-suspect`. The
capture of the fake PyVISA has its first two samples at the converter limits: a window holding them gives `clipped`.
A CSV at 1 MHz missing the rows from 400 us to 600 us has a gap there. A PWM rise time with a source bandwidth of
1 MHz: 3 x 0.35 / 1 MHz = 1.05 us > 0.8 us, `bandwidth-limited`; at 100 MHz none; without bandwidth
`bandwidth-unknown`.

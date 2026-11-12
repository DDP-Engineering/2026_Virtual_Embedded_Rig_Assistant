# electronics-calc fixtures

`cases.json` drives `tests/integration/electronics-calc.test.ts`: each case is a
request for `elec-calc` and what the result must hold. A case names result
values (`results`, relative tolerance `rel`, default 1e-9), result units
(`units`), check statuses (`checks`), text that an assumption or warning must
contain, values in `details` by dot path, input records (`inputs`), result keys
that must be missing (`absent`), the exact engineering text of a result
(`texts`), or the refusal (`error`: exactly one problem with that code and
path, and a message that contains `message` when given; `errors`: these
problems among the reported ones).

`montecarlo_reference.py` computes the Monte Carlo statistics of the 1 %
divider from the algorithm the specification documents, with its own divider
formula and without importing the plugin; the test compares the program's
statistics with its output to 1e-11.

`odd_name.py` creates request files whose names are not valid Unicode text (a
lone surrogate on NTFS, a byte that is not UTF-8 elsewhere) and runs the
program on them, because Node cannot pass such a name as an argument.

`internals.py` reaches four states no command line can arrange reliably:
`swap` puts a link in place of the results directory while `report.run`
computes; `fit` hands `contract.fitted` the largest documents (78 results with
long request text; text beyond the Basic Multilingual Plane) and reports what
it left out; `escape` lets a link resolve to names a Linux file system may hold
(quotation marks, control characters) and reports which the path check admits;
`change` runs the real command line and appends a space to the request file
while the first calculation is computed, so the report must be discarded.

Every expected number was derived by hand from the formulas below: the first
162 cases before the program existed, the review additions afterwards, still
by hand. None was copied from program output, so the cases can be
checked with a pocket calculator and stay independent of the implementation
(work package criterion E01-E). Circuit values are fictional.

## Derivations

**dc.** 5 V / 10 mA = 500 Ω, 5 V · 10 mA = 50 mW. P = 1 W in 100 Ω: V = √(P·R) =
10 V, I = √(P/R) = 0.1 A. Series 1 kΩ + 2 kΩ on 3 V: 3 kΩ, 1 mA, drops 1 V and
2 V, 2 mW in the second, 3 mW in total. Parallel 1 kΩ ∥ 1 kΩ with 2 mA: 500 Ω,
1 V, 1 mA per branch, 2 mW. Shunt 10 mΩ at 5 A: 50 mV, 0.25 W, × 50 = 2.5 V;
0.25 W / 0.5 W = 0.5 (pass), / 0.2 W = 1.25 (fail).

**divider.** 5 V, 10 kΩ / 10 kΩ: 2.5 V, Thevenin 5 kΩ, 5 V / 20 kΩ = 0.25 mA,
0.625 mW per resistor. With a 10 kΩ load: bottom ∥ load = 5 kΩ, Vout = 5 · 5/15
= 1.6667 V, error (1.6667 − 2.5)/2.5 = −1/3, top current 5 V / 15 kΩ = 0.33333
mA, P_top = I²·R = 1.1111 mW, bottom and load each 1.6667² / 10 kΩ = 0.27778
mW, load current 0.16667 mA. Solve rTop for 3.3 V: 10 kΩ · (5 − 3.3)/3.3 =
5151.515 Ω. Solve rBottom for 2.5 V with rTop 10 kΩ and a 20 kΩ load: needed
bottom ∥ load = 10 kΩ, so rBottom = 1/(1/10 kΩ − 1/20 kΩ) = 20 kΩ; a 5 kΩ load
is already below the needed 10 kΩ, so no resistor reaches the target.

**rc.** 10 kΩ · 100 nF = 1 ms; fc = 1/(2π · 1 ms) = 159.154943 Hz; rise time
ln 9 · τ = 2.19722458 ms; 1 % settling ln 100 · τ = 4.60517019 ms. Step 0 → 5 V
at t = τ: 5 · (1 − e⁻¹) = 3.16060279 V; half the step after τ · ln 2 =
0.693147181 ms (also for 5 V → −5 V crossing 0 V). At f = fc: gain 1/√2 =
0.707106781, 20·log10 = −3.01029996 dB, phase −45° (low-pass), +45°
(high-pass). At f = 10·fc: gain 1/√101 = 0.0995037190, −10·log10(101) =
−20.0432137 dB, −atan(10) = −84.2894069°.

**Waveforms.** Sine, peak 1: RMS 1/√2, average 0, rectified average 2/π =
0.636619772, crest √2, form factor π/(2√2) = 1.11072073. Pulse 0..4 A at duty
0.25: RMS 4·√0.25 = 2 A, average 4·0.25 = 1 A, crest 2, form 2. Triangle with
RMS 1: peak √3 = 1.73205081, rectified average peak/2 = 0.866025404, form
2/√3 = 1.15470054. Filter input 1 V RMS at fc: output RMS 0.707106781 V, peak
1 V; input 2 V peak-to-peak: output peak 0.707106781 V, RMS 0.5 V.

**Linear regulator (E01-A).** (12 − 3.3) · 0.3 = 2.61 W; P_in = 12 · 0.3 = 3.6
W; P_out = 3.3 · 0.3 = 0.99 W; η = 0.99/3.6 = 0.275. With Iq = 5 mA: + 12 · 5
mA = 2.67 W, P_in = 12 · 0.305 = 3.66 W, η = 0.99/3.66 = 0.270491803.

**Conduction (E01-B).** 2 A RMS in 50 mΩ: 4 · 0.05 = 0.2 W. The 4 A pulse at
duty 0.25 has the same 2 A RMS, hence the same 0.2 W (not 0.2 · 0.25). 1 V RMS
across 5 Ω: 0.2 W. A sine of peak 2√2 A has 2 A RMS.

**MOSFET.** 10 A RMS in 10 mΩ: 1 W. (100 µJ + 150 µJ) · 100 kHz = 25 W; device
26 W. Gate drive 50 nC · 10 V · 100 kHz = 50 mW, not part of the device loss.
Linear overlap ½ · 400 V · 10 A · 50 ns · 100 kHz = 10 W.

**Diode.** 0.7 V · 1 A = 0.7 W; + 50 mΩ · (2 A)² = 0.9 W; recovery 100 nC ·
400 V · 100 kHz = 4 W; total 4.9 W.

**Derating.** 0.2 W in a 0.25 W resistor: utilization 0.8. At 112.5 °C on the
line 70 °C → 155 °C: (155 − 112.5)/(155 − 70) = 0.5, allowed 0.125 W,
utilization 1.6. Above 155 °C the allowed power is 0.

**Passives and budget.** (1 A)² · 30 mΩ = 30 mW. (3 A)² · 20 mΩ = 0.18 W; +
0.1 W core loss = 0.28 W. 3.3 V · 0.5 A + 1 W = 2.65 W; / 0.9 = 2.94444 W; loss
0.294444 W; / 12 V = 0.245370 A.

**Thermal (E01-C).** 40 °C + 1 W · 50 K/W = 90 °C; margin to 125 °C is 35 K, to
85 °C −5 K; 313.15 K is 40 °C; −40 °C + 50 K = 10 °C. Case path, 10 W from 25
°C: sink 25 + 10·5 = 75 °C, case + 10·0.5 = 80 °C, junction + 10·1.5 = 95 °C,
total 7 K/W. Largest heatsink for 125 °C: 100 K / 10 W − 1.5 − 0.5 = 8 K/W;
for 40 °C: 1.5 − 2 = −0.5 K/W (not feasible). Case to ambient 20 K/W: case 225
°C, junction 240 °C, 21.5 K/W, margin to 150 °C −90 K.

**Foster.** Stages 1 K/W, τ = 1 ms and 2 K/W, τ = 2 · 0.05 = 0.1 s. At 1 ms:
1·(1 − e⁻¹) + 2·(1 − e⁻⁰·⁰¹) = 0.632120559 + 0.019900333 = 0.652020891 K/W,
rise 6.52020891 K, 31.5202089 °C. At 1 s: 1 + 2·(1 − e⁻¹⁰) = 2.9999092 K/W,
54.999092 °C. Steady 3 K/W, 55 °C.

**Worst case (E01-E).** Two 10 kΩ 1 % resistors on 5 V: minimum 5 · 9900 /
(10100 + 9900) = 2.475 V (top high, bottom low), maximum 5 · 10100 / 20000 =
2.525 V. With the supply at ±2 %: 4.9 · 0.495 = 2.4255 V and 5.1 · 0.505 =
2.5755 V; top current 4.9/20200 = 0.242574257 mA to 5.1/19800 = 0.257575758 mA.
Bottom-resistor power with rBottom 5 kΩ..15 kΩ: 0.555556 mW at 5 kΩ, 0.625 mW
at the nominal 10 kΩ, 0.6 mW at 15 kΩ - the nominal lies above both ends, so
the output is not monotonic. Junction with ambient 30..50 °C and thetaJA 45..55
K/W at 1 W: 75 °C to 105 °C. Pulse peak 4 A ± 10 % at duty 0.25 in 50 mΩ: RMS
1.8 A and 2.2 A, 0.162 W and 0.242 W. 1 kΩ + 2 kΩ ± 5 %: 2.9 kΩ to 3.1 kΩ.

**Review additions.** 1 GOhm x 1 fF = 1e9 x 1e-15 = 1 us. 0.5 V / 0.5 A = 1 Ohm,
0.25 W. With only rTop at +-1 %: 5 x 10000 / 20100 = 2.48756219 V and 5 x 10000 /
19900 = 2.51256281 V. 0.5 W x (0.1 + 0.2 + 199.7) K/W = 100 K above 25 degC is
exactly 125 degC: margin 0 K. (28 - 25) K / 10 W - 0.1 - 0.2 = 0 K/W: no room
for a heatsink. A pulse at duty 1 is a constant 3 A: RMS = average = 3 A,
peak-to-peak 0. Texts: 99.996 degC rounds to 100.0; 999.96 Ohm to 1.000 kOhm;
9.9996e11 Ohm is above the G prefix, 5e-16 s below f: scientific notation.

**Monte Carlo (E01-E).** For Vout = 5·R2/(R1 + R2) with two independent,
identically distributed resistors, f(R1, R2) + f(R2, R1) = 1, so the mean is
exactly 2.5 V. To first order Vout ≈ 2.5·(1 + (δ2 − δ1)/2). Uniform ±1 %:
sd(δ) = 0.01/√3, sd(Vout) = 2.5 · √2 · 0.01/√3 / 2 = 10.2062 mV; δ2 − δ1 is
triangular on ±0.02, so P(|Vout − 2.5| ≤ 10 mV) = 1 − (1 − 0.008/0.02)² = 0.64
and the 5 % / 95 % points are 2.5 ∓ 0.025·(1 − √0.1). Normal with the 1 % limit
at 3σ: sd(δ) = 0.01/3, sd(Vout) = 5.89256 mV. With 20000 samples the standard
error of the mean is 0.07 mV and of the standard deviation 0.5 %, so the tests
allow 0.5 mV (0.02 %) and 3 %.

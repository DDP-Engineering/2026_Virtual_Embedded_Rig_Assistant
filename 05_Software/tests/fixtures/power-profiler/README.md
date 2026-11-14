# power-profiler fixtures

Offline evidence only: these files and the fake driver prove the helpers' arithmetic and handling, never a real
JS220, board or battery.

- `fake-driver/pyjoulescope_driver/` - a scripted stand-in for pyjoulescope_driver 2.5.5 (see its docstring): a
  simulated JS220 with persistent settings, option metadata, streamed current/voltage/power/range/GPI messages with
  sample ids, and injected sample-id skips, NaN samples, overflow, removal and stalls. Every call is logged.
- CSV files, written by `make_fixtures.py` (integer sample arithmetic, so each edge lies on a sample). Closed forms of
  the trapezoid integrals the analyzer must report:

| File | Samples | Expected |
|---|---|---|
| `uniform-constant.csv` | 1001, 1 ms, 10 mA at 3.3 V | charge 0.01 C, energy 0.033 J, mean 10 mA |
| `gap.csv` | as above, rows t = 0.400...0.449 s empty | energy and charge null; the gap runs from 0.399 to 0.450 s (0.051 s); covered charge 0.01 x 0.949 = 0.00949 C, covered energy 0.033 x 0.949 = 0.031317 J |
| `nonuniform-ramp.csv` | 101, t = (k/100)^2 s, i = 0.02 t A, v = 2 V | charge 0.01 C, energy 0.02 J (the trapezoid rule is exact for a linear signal on any grid) |
| `sleepwake-a.csv` | 2000 at 2 kHz, period 0.1 s, 40 samples at 20 mA (marker high), else 10 uA, 3.0 V | see below |
| `sleepwake-b.csv` | as A with 30 active samples | see below |
| `sleepwake-b-3v3.csv` | as B at 3.3 V | a setup difference against A |

Sleep/wake (dt = 0.5 ms, I_a = 20 mA, I_s = 10 uA, V = 3.0 V, n active samples): an event runs from the rising edge
(first high sample) to the falling edge (first low sample), so its trapezoid charge is
dt x ((n - 1) I_a + (I_a + I_s) / 2) and its energy V times that.

- A (n = 40): 9 complete events (the one at t = 0 starts before the window: partial); charge 3.950025e-4 C, energy
  1.1850075e-3 J, duration 20 ms each. Start-to-start period (0.1 s): charge dt x (n I_a + (200 - n) I_s) = 4.008e-4 C,
  so 8 periods of mean current 4.008 mA and mean power 12.024 mW. States by the marker over [0, 0.9995] s: high 0.2 s,
  low 0.7995 s.
- B (n = 30): charge 2.950025e-4 C, energy 8.850075e-4 J per event; the per-event energy difference B - A is
  -3.0e-4 J exactly.

Battery examples from profile A (mean current 4.008 mA, mean power 12.024 mW), computed by hand in the test with its
own formula:

- linear regulator, 220...240 mAh, usable 0.8...0.9, quiescent 1...2 uA: low = 0.8 x 792 C / (4.008 mA + 2 uA) =
  158 005 s, high = 0.9 x 864 C / (4.008 mA + 1 uA) = 193 964 s; reported 150 000...200 000 s, 43...54 h,
  1.8...2.3 days (two significant figures, rounded outwards).
- buck converter, 220...240 mAh at 3.6...3.8 V, efficiency 0.85...0.9, quiescent 2...5 uA, usable 0.8...0.9,
  self-discharge 1...3 %/month (30.44 days): low = 0.8 x 2851.2 J / (12.024 mW / 0.85 + 3.8 V x 5 uA + 3 % x 2851.2 J
  per month), high = 0.9 x 3283.2 J / (12.024 mW / 0.9 + 3.6 V x 2 uA + 1 % x 3283.2 J per month).

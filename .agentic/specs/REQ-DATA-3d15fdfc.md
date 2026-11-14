# REQ-DATA-3d15fdfc — elec-calc 1.0.0: command line, quantities, result documents and models

Program `elec-calc` of the official plugin `electronics-calc`
(`05_Software/plugins/electronics-calc/scripts/elec_calc.py`, standard library only, with the support
package `scripts/elec_support/`). Every requirement of the plugin refers to this file for exact names.

## 1 Command line

```text
elec-calc --version                      prints "elec-calc <version>"
elec-calc --help | -h
elec-calc <operation> (--json TEXT | --input FILE) [--run-id ID]
elec-calc report      (--json TEXT | --input FILE) [--run-id ID] [--results-dir DIR]
```

- `<operation>`: `dc`, `divider`, `rc`, `losses`, `thermal`, `tolerance`, `report`. It is the first
  argument; option abbreviations are not accepted.
- `--json TEXT`: the request as one JSON object. `--input FILE`: a UTF-8 JSON file of at most 1 MiB that
  resolves (links followed) to a regular file inside the working directory; a byte-order mark is
  skipped. Exactly one of the two; an option given twice is a usage error.
- `--run-id ID`: 1..64 characters of `[A-Za-z0-9._-]` that start and end with a letter or digit and are
  not a Windows device name; default `<UTC yyyymmddThhmmssZ>-<8 random hex>`.
- `--results-dir DIR` (report only): default `electronics-results`; see §8.
- `elec-calc <operation> --help` lists the models of the operation with every field of §5, the forms
  of a quantity and, for `losses`, of a current descriptor.
- Paths (`--input`, `--results-dir`) are at most 1024 UTF-16 units (a character beyond the Basic
  Multilingual Plane counts twice) of valid Unicode text without control
  characters (C0, DEL) and are judged from their text before the file system is asked anything: a network or device path
  (`\\host\share`, `//host/share`, `\\.\NUL`), another drive, a drive-relative path (`C:x`) and a path
  that leaves the working directory are `path`; on Windows a device name such as `NUL` is a device
  path by its text and is refused the same way. An absolute path may name the working directory as
  it resolves or as the caller entered it (`$PWD` when its normalised text is the same directory;
  the current directory on Windows); on Windows a drive letter is compared with the resolved working
  directory's drive, so an absolute path through a `subst` or mapped drive letter is refused as another
  drive even when the working directory was entered through it (a relative path is accepted). A path that lies inside the working
  directory by its text is then resolved with links followed and must still lie inside it, with a
  relative form of valid Unicode text without control characters and of at most 1024 UTF-16 units as
  JSON writes it (a quotation mark or backslash, legal in Linux file names, counts twice): documents
  repeat that form. A `--run-id` is never a Windows device name (`NUL`, `CON`, `AUX`, `PRN`,
  `COM1`..`COM9`, `LPT1`..`LPT9`, with or without an extension), on any platform.
- Standard output is UTF-8 with LF line ends whatever the console code page, with one top-level field
  per line; a list prints one item per line, and a map whose entries are all lists or objects one
  entry per line. Nothing is read from standard input.
- Exit codes: `0` a result with `status: "ok"`; `2` refused arguments or request (`status: "error"`, or
  the usage text of the argument parser on standard error); `3` an input or output failure after the
  request was accepted (`status: "error"`).
- The script sets `sys.dont_write_bytecode` before it imports the support package: a run creates no
  file in the plugin folder.

## 2 Request rules

- JSON objects with unique keys; a duplicate key, `NaN`, `Infinity`, `-Infinity`, a number that is not
  finite after parsing or that is not zero but too small to represent, an integer too long to read, a
  string that UTF-8 cannot carry (a lone surrogate), text that is not UTF-8, or a top level that is not
  an object is refused (`json`, with an empty path).
- Keys are exact and case-sensitive; an unknown key, a missing required key or a wrong JSON type is
  refused (`schema`). Free text (`source`, `conditions`, `note`, `title`, `name`) is 1..500 characters
  on one line, without control characters.
- All problems of a request that can be found in one pass are reported together.

## 3 Quantities

A quantity is a string `"<number><optional space><unit>"` or an object
`{"value": <number>, "unit": "<unit>", "source"?: text, "conditions"?: text, "note"?: text}`.
`<number>` in a string is a decimal number with an optional sign, digits on at least one side of the
decimal point and an optional exponent `e` or `E` (`12`, `3.3`, `.5`, `5.`, `4.7e-6`); a comma is refused.

Unit = optional prefix + base. Prefixes (case-sensitive): `f` 1e-15, `p` 1e-12, `n` 1e-9, `u`/`µ`/`μ`
1e-6, `m` 1e-3, `k` 1e3, `M` 1e6, `G` 1e9. An exact base name wins over prefix + base.

| Dimension | Bases accepted | Result unit |
|---|---|---|
| voltage | `V` | `V` |
| current | `A` | `A` |
| resistance | `Ω` (also the ohm sign U+2126), `Ohm`, `ohm` | `Ω` |
| power | `W` | `W` |
| capacitance | `F` | `F` |
| frequency | `Hz` | `Hz` |
| time | `s` | `s` |
| energy | `J` | `J` |
| charge | `C` | `C` |
| temperature (absolute or difference, by field) | `K`, `°C` (also `℃` U+2103), `degC` (no prefix on the Celsius spellings) | `°C` absolute, `K` difference |
| thermal resistance | `K/W`, `°C/W`, `degC/W` | `K/W` |
| thermal capacitance | `J/K`, `J/°C`, `J/degC` | `J/K` |
| ratio | `%` (value / 100), `1`, or no unit; a bare JSON number is accepted for ratio fields only | `1` |

- Absolute temperatures convert with `K = °C + 273.15` and must be at least 0 K; differences use the
  same scale for `K` and `°C`.
- A field states its dimension; another dimension, an unknown unit or a missing unit is refused
  (`unit`); a malformed number, or a value that is not finite or becomes zero once its prefix is
  applied, is refused (`number`). A quantity written as text is at most 100 characters (`number`),
  a unit likewise (`unit`).
- Every model computes in SI. A result quantity is `{"value": <number rounded to 12 significant
  digits>, "unit": "<result unit>", "text": "<engineering notation, 4 significant digits>"}`.
  Phase results use unit `deg`, decibel results `dB`.
- `text` has four significant digits and an SI prefix from f to G taken from the rounded value
  (`1.000 kΩ` for 999.96 Ω, `333.3 µA`); `°C`, `deg`, `dB` and ratios take no prefix; a value outside
  the prefix range, or an unprefixed one outside 1e-4..1e6, is scientific (`1.000e+12 Ω`); zero is `0`.
- Magnitudes: voltages, currents, powers, energies, charges, times and frequencies are not negative
  unless a field says so; resistances, capacitances and frequencies used as divisors are positive.
  A violation is refused (`domain`).

Current descriptor (used by `losses`), exactly one form:

| Form | Meaning | RMS | Average |
|---|---|---|---|
| `{"rms": Q, "average"?: Q}` | values over the whole period, as given | `rms` | `average` when given |
| `{"dc": Q}` | constant current | `dc` | `dc` |
| `{"shape": "pulse", "peak": Q, "duty": D}` | rectangular pulses 0..peak, duty `0 < D <= 1` | `peak*sqrt(D)` | `peak*D` |
| `{"shape": "sine" \| "triangle" \| "square", "peak": Q}` | symmetric about zero | `peak/sqrt(2)`, `peak/sqrt(3)`, `peak` | `0` |

`duty` together with `rms` or `dc` is refused (`contradiction`): a duty cycle applies to an on-state
peak, and an RMS value already covers the whole period. `average` above `rms` is a `contradiction`.

## 4 Result document (standard output)

```json
{
  "format": 1,
  "kind": "elec-calc-result",
  "tool": {"name": "elec-calc", "version": "1.0.0"},
  "operation": "losses",
  "model": "linear-regulator",
  "runId": "20261112T101500Z-1a2b3c4d",
  "startedAt": "2026-11-12T10:15:00.123Z",
  "finishedAt": "2026-11-12T10:15:00.125Z",
  "status": "ok",
  "request": {"origin": "inline", "sha256": "<hex of the exact request bytes>"},
  "inputs": [{"name": "vin", "given": "12 V", "value": 12, "unit": "V"}],
  "assumptions": ["..."],
  "formulas": ["P_diss = (V_in - V_out) * I_out + V_in * I_q"],
  "results": {"pDissipated": {"value": 2.61, "unit": "W", "text": "2.610 W"}},
  "details": {},
  "checks": [{"id": "dropout", "status": "not-evaluated", "detail": "..."}],
  "warnings": [],
  "limits": ["..."],
  "artifacts": []
}
```

- `request.origin` is `inline` or `file`; a file adds `"path"` relative to the working directory with
  forward slashes. `sha256` covers the exact bytes of the `--json` text (UTF-8) or of the file.
- `inputs` lists every quantity the model read, in the order it reads them: `name` (its path, such as
  `switching.eOn` or `resistances.0`), `given` (as written), `value` and `unit` in the result unit of
  its dimension, and `source`, `conditions`, `note` when the request carried them.
- `results` is a flat map of scalar quantities; tables go to `details`. `model` is absent for
  `tolerance`.
- A check has `id`, `status` (`pass`, `fail`, `unknown`, `not-evaluated`) and `detail`. A failed check
  does not change `status` or the exit code: the calculation itself succeeded.
- Refusal: the same header with `"status": "error"` and
  `"errors": [{"code": ..., "path": "<request path or empty>", "message": ...}]`, without `inputs`,
  `results`, `details` or `checks`. Codes: `json`, `schema`, `unit`, `number`, `domain`,
  `contradiction`, `insufficient`, `limit`, `path`, `output`. A refusal carries no `model`, and no
  `request` when it comes before the request is read: an `--input` file that cannot be read or a
  refused `--results-dir`.
- A value that is not finite never appears: a request whose arithmetic overflows, divides by an
  underflowed zero or has no finite result is refused (`domain`, empty path). A finite value next to
  the largest number is printed, with its text in scientific notation.
- Size: VERA's runner returns the last 12 000 characters of a run, counted as UTF-16 code units, so
  the printed document is at most 11 000 such units (a character beyond the Basic Multilingual Plane
  counts twice). Text repeated from the request is bounded in the same unit - a problem's path 200, a
  message, warning or check detail 600 - and longer text ends in `...`; a message quotes a refused
  path option by its first 120 characters. A file path (`request.path`, an artifact path) is never
  shortened: the resolved `--input` or `--results-dir` path is refused beyond 1024 units (§1), and an
  artifact path adds only the run id and the file name to the results directory; a quantity written as text is at most 100 characters.
  Left out in this order, each with a warning: `details` (becomes `{}`), `inputs` (becomes `[]`), then
  `formulas`, `assumptions` and `limits` (become `[]`); in a report summary the `results` of every
  calculation. An `errors` list is cut and then ends with a `limit` problem that says how many are not
  shown. `results` and `checks` are never left out, and `report.json` always holds everything.

## 5 Models

`model` is required for `dc`, `divider`, `rc`, `losses` and `thermal`. Q = quantity, R = ratio.

### 5.1 dc

| Model | Fields | Results |
|---|---|---|
| `ohm` | exactly two of `voltage`, `current`, `resistance`, `power`; `signal`? `"dc"` (default) or `"rms"` | all four; `P = V*I = I^2*R = V^2/R`. A pair that divides by zero is `domain` |
| `series` | `resistances` [1..64 Q > 0]; at most one of `voltage`, `current`; `signal`? | `totalResistance`; with a source `current`, `voltage`, `totalPower`; `details.elements[]` {index, resistance, voltage, current, power} |
| `parallel` | `resistances` [1..64 Q > 0]; at most one of `voltage`, `current` (total); `signal`? | `totalResistance`; with a source `voltage`, `current`, `totalPower`; `details.elements[]` |
| `shunt` | `resistance`, `current`; `gain`? R > 0; `ratedPower`? | `voltageDrop`, `power`, `outputVoltage` with gain; check `rated-power` (pass when `power <= ratedPower`), result `powerUtilization` |

### 5.2 divider

Model `resistive`: `vin`, `rTop`, `rBottom`, `rLoad`? (across the bottom resistor), `solveFor`?
`"vout"` (default), `"rTop"` or `"rBottom"`, `vout` (required target for the two solve modes,
`0 < vout < vin`). With `R_b = rBottom || rLoad`: `vout = vin * R_b / (rTop + R_b)`.

Results: `vout`, `voutUnloaded`, `loadingError` (ratio `(vout - voutUnloaded) / voutUnloaded`),
`theveninResistance` (`rTop || rBottom`), `currentTop`, `powerTop`, `powerBottom`, and with a load
`currentLoad`, `powerLoad`. Solve modes add `rTop` or `rBottom`; a target that the load makes
unreachable (`R_b >= rLoad`) is `domain`.

### 5.3 rc

| Model | Fields | Results |
|---|---|---|
| `time-constant` | `resistance`, `capacitance`; step? `vInitial`, `vFinal` (any sign) with exactly one of `time` or `vTarget` (strictly between the two) | `tau = R*C`, `cutoffFrequency = 1/(2*pi*tau)`, `riseTime1090 = ln(9)*tau`, `settlingTime1pct = ln(100)*tau`; `voltageAtTime` or `timeToTarget` |
| `filter` | `type` `"lowpass"` or `"highpass"`, `resistance`, `capacitance`, `frequency`; `amplitude`? (voltage) with required `amplitudeKind` `"peak"`, `"rms"` or `"peak-to-peak"` (sine) | `cutoffFrequency`, `gain`, `gainDb`, `phase`; with an amplitude `outputPeak`, `outputRms`, `outputPeakToPeak`, `outputAverage` (0 V), `outputRectifiedAverage` |
| `waveform` | `shape` `"sine"`, `"square"`, `"triangle"`, `"pulse"` or `"dc"`; exactly one of `peak`, `rms`, `average` (voltage or current); `duty` for `pulse` | `peak`, `rms`, `average`, `rectifiedAverage`, `peakToPeak`, `crestFactor`, `formFactor` (omitted when it divides by zero) |

Gain: lowpass `1/sqrt(1 + (f/fc)^2)`, phase `-atan(f/fc)`; highpass `(f/fc)/sqrt(1 + (f/fc)^2)`, phase
`atan(fc/f)`. `amplitude` without `amplitudeKind` is `insufficient`. `average` for a symmetric shape
is `contradiction` (it is zero for every amplitude). Shapes follow §3; `dc` has peak = RMS = average,
and a pulse at duty 1 is that constant level (peak-to-peak 0).

### 5.4 losses

| Model | Fields | Results and rules |
|---|---|---|
| `linear-regulator` | `vin`, `vout`, `iout`; `iq` or `neglectIq: true` (exactly one); `dropout`? | `pDissipated = (vin - vout)*iout + vin*iq`, `pInput = vin*(iout + iq)`, `pOutput = vout*iout`, `efficiency` (omitted with a warning when `pInput` is 0). Neither `iq` nor `neglectIq` is `insufficient`; `vin < vout` is `contradiction`. Check `dropout`: pass when `vin - vout >= dropout`, `not-evaluated` without it |
| `resistor` | `resistance`; `current` (descriptor) or `voltageRms`; `ratedPower`?, `derating`? {`fullPowerUpTo`, `zeroPowerAt`} with `tAmbient` | `power = I_rms^2*R` or `V_rms^2/R`. With a rating: `allowedPower = ratedPower * clamp((zeroPowerAt - tAmbient)/(zeroPowerAt - fullPowerUpTo), 0, 1)` (the rating itself without `derating`), `powerUtilization`, check `power-rating`; `derating` without `tAmbient` is `insufficient` |
| `mosfet` | `current` (descriptor), `rdsOn`; `frequency`?; `switching`? {`method: "energy"`, `eOn`, `eOff`} or {`method: "linear-overlap"`, `vds`, `id`, `tRise`, `tFall`}; `gateDrive`? {`qg`, `vDrive`} | `pConduction = I_rms^2*rdsOn`; `pSwitching = (eOn + eOff)*f` or `0.5*vds*id*(tRise + tFall)*f` (named as an approximation); `pDevice = pConduction + pSwitching`; `pGateDrive = qg*vDrive*f`, reported separately and not part of `pDevice`. `switching` or `gateDrive` without `frequency` is `insufficient`. Check `rdson-conditions`: `pass` when `rdsOn` carries `conditions`, else `unknown` with a warning |
| `diode` | `vf`, `current` (descriptor with an average); `rd`?; `qrr`, `vr`, `frequency` (all three or none) | `pForward = vf*I_avg + rd*I_rms^2`, `pReverseRecovery = qrr*vr*f` (approximation), `pTotal`. A descriptor without an average is `insufficient` |
| `capacitor` | `esr`, `current` (descriptor) | `pEsr = I_rms^2*esr` |
| `inductor` | `dcr`, `current` (descriptor); `coreLoss`? (power) | `pCopper = I_rms^2*dcr`, `pCore` as supplied, `pTotal`. Without `coreLoss`: check `core-loss` `not-evaluated`, a warning, and `pTotal` equal to `pCopper` |
| `power-budget` | `loads` [1..64 {`name`, `power` or `voltage` + `current`}]; `efficiency`? `0 < R <= 1`; `sourceVoltage`? | `pLoads`; with an efficiency `pInput = pLoads/efficiency`, `pLoss`; with both `inputCurrent`; `details.loads[]` |

Every model with a current descriptor also returns `currentRms` and, when the descriptor gives one,
`currentAverage`; `power-budget` repeats a given `efficiency` in its results. A diode with a symmetric
shape (sine, triangle, square) is `contradiction`: it conducts in one direction. `sourceVoltage`
without `efficiency` is `insufficient`. A resistor `tAmbient` without `derating` and a MOSFET
`frequency` without switching or gate-drive data are accepted and reported as unused in a warning.

### 5.5 thermal

| Model | Fields | Results and rules |
|---|---|---|
| `junction-ambient` | `power`, `tAmbient`, `thetaJA`; `tJunctionMax`? | `tJunction = tAmbient + power*thetaJA`, `temperatureRise`. Checks: `thetaja-conditions` (`pass` with `conditions` on `thetaJA`, else `unknown` with a warning), `junction-limit` (`pass`/`fail` with result `junctionMargin`, `not-evaluated` without a maximum). A `thetaJC`, `thetaCS`, `thetaSA` or `thetaCA` key is `contradiction` |
| `junction-case-sink` | `power`, `tAmbient`, `thetaJC`; `thetaCS` + `thetaSA`, or `thetaCA`; `tJunctionMax`?; `solveFor`? `"thetaSA"` (needs `tJunctionMax` and `thetaCS`, no `thetaSA`) | `tCase`, `tSink` (sink path), `tJunction`, `thetaTotal`; solve mode `thetaSAMax = (tJunctionMax - tAmbient)/power - thetaJC - thetaCS` with check `heatsink-feasible` (fail when it is not positive). A `thetaJA` key is `contradiction` |
| `foster` | `power`, `tReference`, `stages` [1..16 {`resistance`, and `tau` or `capacitance`}], `times` [1..64 Q] | `zthSteady`, `tSteady`; `details.response[]` {time, zth, temperatureRise, temperature} with `zth(t) = sum(R_i*(1 - exp(-t/tau_i)))`, `tau_i = R_i*C_i`; one time adds `zth` and `temperatureAtTime` |

The limit checks (`junction-limit`, `heatsink-feasible`, like `rated-power`, `power-rating` and
`dropout`) allow a relative rounding slack of 1e-12: a junction that lands on its maximum has a margin
of 0 K and passes; a heatsink budget that is used up exactly gives 0 K/W and fails.

### 5.6 tolerance

```json
{
  "target": {"operation": "divider", "input": {"model": "resistive", "vin": "5 V", "rTop": "10 kΩ", "rBottom": "10 kΩ"}},
  "outputs": ["vout"],
  "parameters": {"rTop": {"tolerance": "1 %", "distribution": "uniform"},
                 "rBottom": {"min": "9.9 kΩ", "max": "10.1 kΩ", "distribution": "normal", "sigmas": 3}},
  "monteCarlo": {"samples": 20000, "seed": 12345},
  "limits": {"vout": {"min": "2.4 V", "max": "2.6 V"}}
}
```

- `target.operation`: `dc`, `divider`, `rc`, `losses` or `thermal`. `outputs`: 1..6 keys of the
  target's `results`. `parameters`: 1..12 entries; a key is a dot path into `target.input` whose value
  is a quantity (list items by their index in at most nine plain ASCII digits without a leading
  zero). Each has
  `tolerance` (ratio `0 < t < 1`; range `nominal*(1 ± t)`; refused for temperatures) or `min` and `max`
  (same dimension, `min < max`, the nominal inside; a temperature on the scale of its nominal).
- Worst case: the target is evaluated at the nominal and at all `2^n` corners. Results per output:
  `<output>.nominal`, `<output>.min`, `<output>.max`; `details.worstCase[<output>]` names the corner
  (`{"<parameter>": "min"|"max"}`) of each extreme. Check `monotonic`: for each parameter with the
  others nominal, the nominal output lies between the outputs at its two ends; `fail` names the
  parameters and outputs where it does not. A refusal of the target at a corner or at a sample is
  reported under `target.input` with a message that starts `At corner {...}:` or
  `At Monte Carlo sample <n> {...}:`. A `distribution` without `monteCarlo` is not used and gives a
  warning.
- Monte Carlo runs only with `monteCarlo` {`samples` 100..100000, `seed` integer 0..2^63-1}; then every
  parameter needs `distribution` (`uniform` over [min, max], or `normal` with required `sigmas` > 0,
  mean `(min + max)/2`, standard deviation `(max - min)/(2*sigmas)`, not truncated). A missing seed,
  distribution or `sigmas` is `insufficient`; a sample count outside its range is `limit`, a seed
  outside its range `domain`; `limits` without `monteCarlo` are `insufficient` and with `min` above
  `max` a `contradiction`. Generator: CPython `random.Random(seed)`; per sample the
  parameters are drawn in sorted key order; uniform `min + (max - min)*u`; normal by Box-Muller
  `mean + sd*sqrt(-2*ln(1 - u1))*cos(2*pi*u2)`. Results per output: `.mean`, `.stdDev` (n - 1),
  `.sampleMin`, `.sampleMax`, `.p01`, `.p05`, `.p50`, `.p95`, `.p99` (linear interpolation), and with
  `limits` `.fractionWithin`. The corners are always evaluated and returned as well.
- The same request and seed give the same results on one runtime; `details.monteCarlo` records the
  generator, seed, samples and Python version.

## 6 Limits every result states

Each model returns its `limits` (for example: steady state only; lumped parameters; no core-loss
estimate; a Foster network is behavioural and gives no internal node temperature; corners assume
monotonic outputs). Datasheet values are used as supplied with their `source` and `conditions`; no
value is derived from a graph, scaled to other conditions or defaulted.

## 7 Request limits

Inline text is bounded by the platform (4096 characters per argument, no line break); a file by
1 MiB (a larger one is `path`). Lists and maps have the sizes above; a request beyond them is `limit`.

Run time: the program timeout is 120 s; the rules give `tolerance` 600 s and `report` 1800 s. The
largest documented tolerance request (Foster network, 16 stages, 64 times, 12 parameters, 100000
samples) took 51 s on the development host (Windows 11, CPython 3.12).

## 8 report

Request: `{"title": text, "calculations": [1..32 {"id": "^[a-z0-9][a-z0-9-]{0,63}$" (unique),
"operation": any operation except report, "input": {...}, "note"?: text}], "notes"?: [0..16 text]}`.

- Every calculation is validated and computed first; one refusal refuses the report (exit 2) with
  error paths `calculations.<index>.input.<field>`, and nothing is written. The calculations of one
  report ask for at most 1 000 000 Monte Carlo samples in total (`limit` at `calculations`).
- The results directory must resolve inside the working directory, must not contain a `.vera`
  segment (any letter case, also the spellings Windows opens as that folder) and must not lie on or
  below a file (`path`). It is created when missing. The run folder `<results-dir>/<run-id>/` is
  created exclusively; an existing one is refused (`output`, exit 2). Once created it is resolved
  again: if a link put in place of the results directory meanwhile leads it out of the working
  directory or into `.vera`, the report is discarded (`output`, exit 3).
- Files, created exclusively: `report.json` (`format: 1`, `kind: "elec-calc-report"`, tool, runId,
  times, `request`, `title`, `notes`, `calculations[]` each {`id`, `note`?, `result`} where `result` is
  the §4 document of that calculation) and `report.md` (title, run facts and, per calculation, the
  inputs with units, sources and conditions, formulas, assumptions, results, checks, warnings and
  limits).
- An input file is hashed before and after the run; a difference, or a failure to create the run
  folder or to write a file, removes every file and folder the run created - a results directory it
  had to create included - and exits 3 (`output`).
- Standard output: the header of §4 with `kind: "elec-calc-report-summary"`, `operation: "report"`,
  `artifacts` [{`kind`: `report-json` | `report-markdown`, `path` relative to the working directory,
  `bytes`, `sha256`}], `calculations` [{`id`, `operation`, `model`?, `results` (key → text),
  `checks` {pass, fail, unknown, notEvaluated}}] and `warnings` (§4 size rule).

## Acceptance

E01-A…F of the work package: 12 V → 3.3 V at 0.3 A with `neglectIq` gives 2.61 W and an `iq` raises
it by `vin*iq`; 2 A RMS in 50 mΩ gives 0.2 W and a 4 A pulse at duty 0.25 the same; 40 °C + 1 W ×
50 K/W gives 90 °C with the thetaJA conditions in the result; prefixed inputs give equal results and
refusals are reported; corners and Monte Carlo match fixtures derived outside the implementation;
the report holds formulas, inputs, units, assumptions, sources and limits and leaves its input file
unchanged.

## Assumptions and open decisions

- The activity name `design`, the pack name and the operation list are proposals of this work
  package that the user has not reviewed individually.
- Cauer networks, repetitive-pulse superposition and interior extremes of non-monotonic outputs are
  outside this version.
- Open for the user (review round 1): whether diodes get a current derating like the resistor's power
  derating; whether series such as the Foster response are also written as CSV; whether `report.md`
  should repeat the `details` tables that `report.json` holds.

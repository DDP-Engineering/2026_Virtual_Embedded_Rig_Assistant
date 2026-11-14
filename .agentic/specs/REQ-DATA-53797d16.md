# lab-validate: validation request, importers, metrics, decisions and results

Governs REQ-DATA-53797d16 and the requirements of TASK-cf769025 that name this spec. LAB-01 capture contract:
`.agentic/specs/REQ-DATA-b3e2930f.md`; ngspice/LTspice run folders: `.agentic/specs/REQ-DATA-29b9a988.md` section 6.

## 1 Command line

`lab-validate <operation> [options]`, a standard-library PEP 723 script (`scripts/lab_validate.py`, support package
`lab_validation/`). The operation is the first argument.

| Operation | Options | Writes |
|---|---|---|
| `--version`, `--help`, `-h` | | nothing; the help lists the registered importers and metrics with their definitions |
| `inspect` | `--path P` or `--request R` | nothing |
| `normalize`, `measure`, `align`, `compare` | `--request R [--results-dir D] [--run-id ID]` | a new run folder |
| `report` | `--run DIR` (1...20 times) `[--title T] [--results-dir D] [--run-id ID]` | a new run folder |

Every path (request, sources, `--path`, `--run`, `--results-dir`) lies inside the working directory by its text and
after links are followed (`workspace.py`, a byte-identical copy of the ELEC plugins' module); results never go inside
`.vera`. `--results-dir` defaults to `embedded-lab-results`; `--run-id` is 1-64 of `[A-Za-z0-9._-]` (default
`<UTC yyyymmddThhmmssZ>-<8 hex>`). The run folder is created exclusively after everything was imported and computed;
a failure while writing removes it.

Exit codes: 0 `pass`, 1 `fail`, 2 refused before any folder exists (problem codes `request`, `path`, `source`,
`source-changed`, `domain`, `quantity`, `clock`, `limit`), 3 `incomplete` or `error`. A value of a wrong JSON type
anywhere in the request is a `request` refusal, never an internal error. Every run prints one JSON document of at most 11 000 UTF-16 units (lists are left to
result.json when it would be longer).

The helper opens no network connection, starts no process, changes no source file and asks no language model: every
number is computed by the helper.

## 2 Validation request (format 1)

A JSON object, at most 1 MiB, unique keys, finite numbers. Unknown keys are refused. Quantities are text
`<number> [<prefix>]<unit>` with prefixes `p n u µ m k M G` and units `s Hz V A W % ohm Ω °C K` (a bare number is
dimensionless); percent fields accept `<number> %`.

```json
{"format": 1,
 "title": "RC step response",
 "requirement": "REQ-PWR-12 (free text)",
 "decisionRule": "guarded",
 "missingData": "incomplete",
 "conditions": {"vin": "5 V", "load": "1 kohm"},
 "sources": {
   "scope": {"importer": "scpi-capture", "path": "embedded-lab-results/cap1", "sha256": "<of result.json>",
             "bandwidth": "100 MHz", "conditions": {"vin": "5 V", "load": "1 kohm"}},
   "sim": {"importer": "spice", "path": "electronics-results/sim1", "conditions": {"vin": "5 V", "load": "1 kohm"}},
   "log": {"importer": "csv", "path": "data/log.csv", "delimiter": ",", "time": {"column": "t", "unit": "ms"},
           "columns": {"out": {"column": "Vout", "unit": "mV", "clip": {"low": "-5 V", "high": "5 V"}}}}},
 "signals": {
   "out": {"source": "scope", "channel": "CHAN1", "sign": 1, "scale": 1,
           "preprocess": [{"filter": {"kind": "moving-average", "width": "2 us"}}]},
   "in": {"source": "scope", "channel": "CHAN2"},
   "ref": {"source": "sim", "channel": "v(out)"}, "refIn": {"source": "sim", "channel": "v(in)"}},
 "measurements": [
   {"id": "tr", "signal": "out", "metric": "rise-time", "window": {"from": "0 s", "to": "200 us"}},
   {"id": "rip", "signal": "out", "metric": "ripple", "window": {"from": "400 us", "to": "500 us"}}],
 "comparisons": [
   {"id": "vs-sim", "signal": "out", "reference": "ref", "window": {"from": "0 s", "to": "500 us"},
    "alignment": {"method": "marker", "measured": {"signal": "in", "level": "50 %", "edge": "rising"},
                  "reference": {"signal": "refIn", "level": "50 %", "edge": "rising"}}}],
 "criteria": [
   {"id": "C1", "value": "tr", "op": "<=", "limit": "50 us", "uncertainty": "1 us"},
   {"id": "C2", "value": "vs-sim.max-abs", "op": "<=", "limit": "50 mV", "uncertainty": "5 mV"},
   {"id": "C3", "value": "rip", "op": "<=", "limit": "20 mV", "uncertainty": "2 mV", "rule": "simple"}]}
```

- Ids (sources, signals, measurements and comparisons) differ in more than letter case: they name files.
- `format` 1; `title` 1-200 characters; `requirement` optional text up to 200; `decisionRule` `simple` or `guarded`
  (required); `missingData` `incomplete` or `exclude` (required); `conditions` 0-32 entries of text up to 120.
- `sources` 1-16, id `[A-Za-z][A-Za-z0-9_-]{0,31}`: `importer` (a registered name, section 3), `path`, optional
  `sha256` (64 hex: of the CSV file, or of the run folder's result.json), `bandwidth` (quantity in Hz or `unlimited`),
  `probe` (text), `conditions` (the setup this source had), plus the importer's own fields.
- `signals` 1-32, same id pattern: `source`, `channel` (the importer's channel name), `sign` (1 or -1, default 1),
  `scale` (positive number, default 1), `unit` (only where the importer cannot tell it), `preprocess` (0-4 steps,
  applied in the order written, section 5).
- `measurements` 0-64: `id`, `signal`, `metric` (a registered name), `window` {from, to} (required, seconds, from < to)
  and the metric's fields (section 4).
- `comparisons` 0-16: `id`, `signal`, `reference` (signals of the same quantity), `window`, `alignment` (section 6).
- `criteria` 0-128: `id`, `value` (a measurement id, or `<comparison id>.<max-abs|rms|mean|lag|correlation>`), `op`
  (`<=`, `>=`, `==`), `limit` (quantity in the value's unit), `tolerance` (with `==` only, required there; quantity or
  percent of the limit), `uncertainty` (quantity in the value's unit or percent of the value; optional), `rule`
  (overrides `decisionRule`), `conditions` (the request condition names that apply; default all). `<id>.correlation`
  is accepted only for a cross-correlation comparison.
- Ids are unique across measurements and comparisons. `compare` needs at least one criterion. A criterion's limit in
  another unit than its value is refused (`request`).

## 3 Importers (a registry: `importers.register(name, function)`)

Every importer reads each file once, hashes the bytes it parses and records `{path, bytes, sha256}`. A series is a
strictly increasing time axis in seconds with values in the channel's unit; a missing cell (empty, `nan`, `-nan`)
removes the sample; any other non-number, or a magnitude above 1e30, is refused with its row. One source holds at
most 8 000 000 samples (rows x channels), and so do all sources of a request together.

- `scpi-capture` - a LAB-01 capture run folder (REQ-DATA-b3e2930f): `result.json` (at most 4 MiB) of format 1, kind
  `scpi-result`, operation `capture`, status `pass` or `incomplete` (incomplete adds diagnostic `source-incomplete`).
  Channel = a `series[].channel`; its `waveform-<CH>.csv` (`time_s,volts`) must match the SHA-256 that `artifacts`
  records for it. Clipping comes from `raw-<CH>.bin` and `preamble-<CH>.json` (both hash-checked and required):
  every sample whose raw code equals the preamble's `clipLow` or `clipHigh` is clipped. A `decode` folder keeps
  neither, so it is refused with the capture folder it names (`inputs.capture`) to import instead. The capture's `conditions` and
  instrument identity are reported as captured; time zero is the oscilloscope's trigger. Unit V, uniform sampling.
- `csv` - one file (at most 64 MiB, 2 000 000 rows): `delimiter` (`,` `;` tab or space, default `,`), `comment`
  (line prefix to skip, optional), `header` (default true), `time` {column, unit `s|ms|us|µs|ns`} or `sampleRate`
  (Hz) with optional `start` (s), and `columns` {channel: {column (header name or 1-based index), unit, clip {low,
  high}?}}, `uniform` (default true; false for an export on a simulator's time steps, such as LTspice's text export,
  where a long step is not a gap). Values at or beyond a declared clip limit are clipped.
- `sigrok-csv` - the CSV that `sigrok-cli -O csv` writes: as `csv` with `comment` `;`; when neither `time` nor
  `sampleRate` is given, the rate comes from a comment line `; Samplerate: <number> <prefix>Hz`, else the request is
  refused, as is a rate that is not positive. `.sr` files are not read: sigrok-cli converts them.
- `spice` - an ngspice-tool (`ngspice-tool-result`) or ltspice-tool (`ltspice-tool-result`) run folder: `result.json`
  and `series.csv` checked against the SHA-256 that `artifacts` records. Only a transient analysis (`analysis` text
  starting `.tran`/`tran`) gives time series; any other analysis is refused (`domain`): AC complex data and time series
  are not compared. Channel = a series column; unit V for `v(...)`, A for `i(...)`, else the signal's `unit`.
  Bandwidth `unlimited` unless declared; the sampling is the simulator's (not uniform), so no gap is inferred from a
  step; time zero is the simulation start. Neither the ngspice nor the ltspice plugin needs to be installed.

Gaps: on a uniform series, a step longer than 1.5 x the median step is a gap (from the last sample before to the
first after); a removed (missing) sample also opens one.

## 4 Metrics (a registry: `metrics.register(name, definition)`)

Every measurement uses the signal after its preprocessing, on the signal's own time axis, over its declared window.
Values at the window edges are interpolated linearly from their neighbours (not across a gap). Integrals use the
trapezoid rule over the samples and the interpolated edges.

| Metric | Unit | Definition |
|---|---|---|
| `min`, `max` | signal | smallest / largest value in the window |
| `mean` | signal | (1/T) integral of v dt |
| `rms` | signal | sqrt((1/T) integral of v^2 dt) |
| `peak-to-peak` | signal | max - min |
| `ripple` | signal | max - min over the window, which the request declares as steady state |
| `frequency` | Hz | (n - 1) / (t_n - t_1) over the n rising edges in the window, n >= 2 |
| `duty-cycle` | % | mean over full periods of (falling edge - rising edge) / period x 100 |
| `rise-time`, `fall-time` | s | first transition in the window from the lower to the upper `percent` level (default [10, 90]; [20, 80] allowed) |
| `overshoot` | % | (max after the first rising edge - high) / (high - low) x 100 (negative when the signal stays below high) |
| `settling-time` | s | from the first edge's 50 % crossing (or `from`) to the last return into `final` +- `band`; `bound` when still outside at the window end |
| `delay` | s | edge time of the signal minus edge time of `reference` (a signal of the same source) at each one's 50 % level |

- Levels: `levels` {low, high} as declared, else derived and reported: the midpoint is (min + max) / 2, low the median
  of the samples below it, high the median of the samples at or above it. No two states -> `unknown`.
- Edges: a state machine with hysteresis switches high at 75 % and low at 25 % of (high - low) above low; the edge time
  is the last 50 % crossing before the switch, interpolated linearly. `edge` rising|falling (delay: `edge`,
  `referenceEdge`, default rising; `referenceLevels`).
- `settling-time` needs `band` (quantity or percent of |high - low|); `final` defaults to the level of the state
  reached. A `bound` value is a lower bound: the window ended before the signal settled.
- A measurement is `ok`, `bound` or `unknown` with a reason (too few edges or samples, window outside the series).

## 5 Preprocessing

- `{"resample": {"method": "linear", "rate": "<Hz>"}}` - a uniform grid at the rate from the first to the last sample,
  values interpolated linearly within each gap-free segment only (no point inside a gap); a grid point next to a
  clipped sample is clipped. A rate below the series' own rate without an earlier moving-average of width >= 1/rate
  adds `aliasing-risk` to the signal.
- `{"filter": {"kind": "moving-average", "width": "<s>"}}` - needs uniform sampling (resample first otherwise); n =
  the odd number of samples nearest width x rate, ties upwards (n >= 3); centred; samples whose window is incomplete
  or holds a gap are dropped, a window holding a clipped sample makes its output clipped. Reported from the realized
  width w = n / rate: first null 1/w, -3 dB 0.443/w, and the step response's 10-90 % time 0.8 w, which enters the
  rise-time check and the aliasing check of a later resample.
- Every step is reported with its method, rate and band; the original sample count and rate stay in the result.

## 6 Alignment of a comparison

The reference is shifted by the lag L: e(t) = m(t) - r(t - L), r interpolated linearly at the measured sample times in
the window. Methods:

- `none` - L = 0; the report states that each source keeps its own time zero (clocks are never assumed
  synchronized from file times).
- `offset` {offset} - L as declared.
- `marker` {measured {signal, level (quantity or percent), edge, after?}, reference {...}} - each marker signal must
  belong to the source of the signal it aligns; L = t_marker(measured) - t_marker(reference), each the first crossing
  after `after` over the whole signal.
- `cross-correlation` {maxLag} - the measured signal must be uniform; the lag grid is k x dt for |k| <= maxLag / dt;
  L maximizes the Pearson correlation (centred sums, clamped to [-1, 1]) over the samples where both exist (at least
  half the window), refined by a parabola through the peak and its neighbours; ties go to the smallest |k|. The
  reference is evaluated only at the grid points some lag needs, so the work is bounded by N x (2K + 1), never by the
  time span; above 10 000 000 the request is refused (`limit`). A peak at |k| = K gives `lag-at-limit`. When no
  criterion judges the comparison's `lag`, the result adds `lag-unjudged`.

The lag is the comparison value `<id>.lag`; a criterion on it judges the delay that the alignment removed, so a
correlation never hides a delay a requirement limits. `delay` measurements never use a comparison's alignment.
Statistics of e over the measured samples in the window: `max-abs`, `rms` and `mean` (trapezoid), plus `correlation`
(cross-correlation only). Measured samples without a reference value are excluded; coverage below the whole window
adds `reference-short`, which limits `max-abs`, `rms` and `mean` but not `lag` and `correlation` (they come from the
samples that overlap, so a simulation that starts at t = 0 still judges a positive lag).

## 7 Diagnostics and the verdict

Codes (`limits` true unless marked): `gap` (a gap in a window; with `missingData` `exclude`, min/max/mean/rms/
peak-to-peak/ripple and error statistics skip the gap and report the excluded time, without the limit), `clipped`,
`source-incomplete`, `aliasing-suspect` (fewer than 4 samples per period of a measured frequency), `aliasing-risk`,
`under-sampled` (fewer than 3 samples within a rise or fall), `bandwidth-unknown` (rise/fall on a source without
`bandwidth`), `bandwidth-limited` (measured rise/fall < 3 x sqrt((0.35 / bandwidth)^2 + (0.8 x filter width)^2)),
`conditions-unknown`, `conditions-differ`, `lag-at-limit`, `reference-short`, `lag-unjudged` (no limit),
`resampled-up` (no limit).

Criterion decision with value v, uncertainty U (0 when declared `0`), limit L:

| Rule | `<=` | `>=` | `==` (interval [L - tol, L + tol]) |
|---|---|---|---|
| `simple` | pass v <= L, else fail | pass v >= L, else fail | pass v inside, else fail |
| `guarded` | pass v + U <= L; fail v - U > L; else incomplete | pass v - U >= L; fail v + U < L; else incomplete | pass [v-U, v+U] inside; fail disjoint; else incomplete |

`guarded` without an uncertainty -> incomplete (the reason says the uncertainty is unknown). A percent uncertainty is
of |v|; with a value in %, a `%` uncertainty or tolerance is in percentage points. An unknown value -> incomplete. A
`bound` value b (true value >= b): `<=` fails when b - U > L, `>=` passes when b - U >= L, `==` fails when
b - U > L + tol, else incomplete. A window that lies in a gap gives an unknown value and `gap`. Any limiting diagnostic on the value's signals, sources and windows, or a request condition the
criterion names that a source does not state (`conditions-unknown`) or states differently (`conditions-differ`;
quantities compared numerically), makes the criterion incomplete. The limits are echoed as written and never widened.

Verdict of `compare`: fail when a criterion fails, else incomplete when one is incomplete, else pass.
`normalize`, `measure` and `align` judge no criterion: their status is `pass` when everything requested was computed
and `incomplete` when a value is unknown or a limiting diagnostic applies; they have no `verdict`.

## 8 Results

`<results-dir>/<run-id>/result.json`, format 1, kind `lab-validation-result`: `tool {name: lab-validation, version}`,
`operation`, `runId`, `started`, `finished`, `status`, `verdict` (compare only), `request {path, sha256, title,
requirement, decisionRule, missingData, conditions}`, `sources [{id, importer, path, files, sha256, bandwidth, probe,
conditions, captured?, identity?, timeZero, domain}]`, `signals [{id, source, channel, unit, sign, scale, points,
start, end, rate?, uniform, gaps, clipped, preprocessing}]`, `definitions`, `measurements`, `comparisons`, `criteria
[{id, value, op, limit, tolerance?, uncertainty?, rule, measured, unit, status, reasons, diagnostics}]`,
`diagnostics [{code, limits, signal?, value?, message}]`, `problems`, `limits`, `artifacts [{path, bytes, sha256}]`.
Files: `report.md` (verdict, criteria, measurements with definitions and levels, comparisons with alignment,
conditions requested and stated per source, preprocessing, diagnostics, sources with relative links and SHA-256,
limits); `normalize`: `series-<signal>.csv` (`time_s,<signal>_<unit>`); `align`/`compare`: per comparison
`compare-<id>.csv` (`time_s,measured,reference,difference`) and `compare-<id>.svg` (overlay and difference panels).

`report --run DIR...`: each folder's result.json (kind `lab-validation-result`) and every artifact it lists (at most
64 MiB each) are hash-checked, and a compare run's `verdict` and `status` must follow from its criteria statuses
(result.json is not among its own artifacts; its SHA-256 is recorded in the report); the new folder holds `report.json` (kind `lab-validation-report`: runs [{path, sha256, title,
requirement, operation, status, verdict, criteria counts}], verdict over the compare runs: fail > incomplete > pass)
and `report.md`. A run that is not a compare counts as incomplete.

## Acceptance

L02-A (synthetic sine/square/step with an independent solution: RMS, frequency, rise time, ripple within tolerances
fixed in the fixture README), L02-B (mV/V and ms/s, mapping and sign explicit), L02-C (repeat runs identical, every
step in the report), L02-D (a lag above the limit fails although cross-correlation makes the curves coincide), L02-E
(gap, clipping, aliasing, missing band/conditions -> diagnostic and incomplete), L02-G (offline, inputs unchanged),
L02-H (pass, fail and incomplete aggregated by `report`; no network). L02-F needs a real capture of a real circuit.

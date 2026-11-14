# Electronics calculations

Enable **Calculations** in the Electronics design pack. The plugin provides one
program, `elec-calc`, and the skills `electronics-sizing` and
`thermal-analysis`. It computes on the host, offline, and touches no hardware.

`elec-calc` is a PEP 723 script on the Python standard library (no package to
download). Every operation reads one JSON request and prints one JSON result
document; nothing in a request is evaluated as an expression.

```text
elec-calc <operation> (--json TEXT | --input FILE) [--run-id ID]
elec-calc report      (--json TEXT | --input FILE) [--run-id ID] [--results-dir DIR]
```

| Operation | Models |
|---|---|
| `dc` | `ohm` (two of voltage, current, resistance, power), `series`, `parallel`, `shunt` |
| `divider` | `resistive`: loaded and unloaded output, or `solveFor` `rTop` / `rBottom` |
| `rc` | `time-constant` (step response), `filter` (first-order low/high-pass), `waveform` (peak, RMS, average) |
| `losses` | `linear-regulator`, `resistor` (with derating), `mosfet`, `diode`, `capacitor`, `inductor`, `power-budget` |
| `thermal` | `junction-ambient` (thetaJA), `junction-case-sink` (heatsink path), `foster` (transient) |
| `tolerance` | worst-case corners and seeded Monte Carlo over one of the operations above |
| `report` | a list of calculations written to `report.json` and `report.md` |

`elec-calc <operation> --help` lists every model of the operation with all its
fields, the forms of a quantity and of a current descriptor.

## Requests

Quantities carry their unit: `"3.3 V"`, `"50 mOhm"`, `"100 nF"`, `"40 °C"`, or
`{"value": 50, "unit": "K/W", "source": "Datasheet rev. B, section 6.4",
"conditions": "JEDEC 2s2p board, still air"}`. Prefixes `f p n u m k M G` are
case-sensitive (`m` milli, `M` mega); `Ω`, `Ohm` and `ohm` are one unit; ratios
are a number (`0.25`) or a percentage (`"25 %"`). Free text (`source`,
`conditions`, `note`) is one line of at most 500 characters. `--json` takes one
line of at most 4096 characters; use `--input` with a file in the workbench for
more.

```text
elec-calc losses --json {"model":"linear-regulator","vin":"12 V","vout":"3.3 V","iout":"0.3 A","iq":"5 mA"}
elec-calc thermal --json {"model":"junction-ambient","power":"1 W","tAmbient":"40 °C","thetaJA":{"value":50,"unit":"K/W","conditions":"JEDEC 2s2p, still air"},"tJunctionMax":"125 °C"}
elec-calc tolerance --input calc/divider-tolerance.json
elec-calc report --input calc/power-stage.json --run-id power-stage-rev-b
```

A current is a descriptor: `{"rms": "2 A"}` (optionally with `"average"`),
`{"dc": "2 A"}` or `{"shape": "pulse", "peak": "4 A", "duty": 0.25}`. A duty
cycle belongs to a peak current only; an RMS value already covers the whole
period, and the two together are refused.

## Results

The result document (`format: 1`, `kind: "elec-calc-result"`) holds the tool
version, run id, start and end times, the SHA-256 of the request, and:

- `inputs`: every quantity read, with its unit, `source` and `conditions`;
- `formulas`, `assumptions` and `limits` of the model;
- `results`: `{value, unit, text}` in SI units (temperatures in °C, 12
  significant digits); tables are in `details`;
- `checks` with status `pass`, `fail`, `unknown` or `not-evaluated`, and
  `warnings`.

A failed check is a result, not an error. A refused request has `status:
"error"` and `errors` with a code (`json`, `schema`, `unit`, `number`,
`domain`, `contradiction`, `insufficient`, `limit`, `path`, `output`), the
request path and a message. Exit codes: 0 result, 2 refused request, 3 input or
output failure. Values beyond floating point (an overflow, a division by an
underflowed zero) are refused with `domain`; a document never holds `Infinity`.

A printed document stays under 11 000 characters (counted as VERA counts them,
in UTF-16 units), because VERA returns the last 12 000 of a run: when it would
be longer, the `details` tables, then
the `inputs` list, then formulas, assumptions and limits (in a report summary
the per-calculation `results`) are left out with a warning, and a long error
list is cut. Text repeated from a request is cut to a bounded length, and a
quantity written as text is at most 100 characters. `report.json` always holds
everything, so run a large request through `report` to get its tables.

`report` creates `electronics-results/<run-id>/` (or `--results-dir`) with
`report.json` and `report.md`. The folder must be new and inside the working
directory, never inside `.vera`; one refused calculation refuses the whole
report, and nothing is written. If the input file changes while the report
runs, or a file cannot be written, the run removes what it created and exits 3.

Paths are at most 1024 UTF-16 units (a character beyond the Basic
Multilingual Plane, such as most emoji, counts twice) without control
characters and are judged from their text first: network (UNC) and device
paths and another drive are refused before the file system is asked (on
Windows `NUL` is such a device path), and links are followed before a path is
accepted. An absolute path may use the working directory's name as it was
entered or as it resolves, except a `subst` or mapped drive letter, which
counts as another drive even when the working directory was entered through
it: use a relative path there. The resolved `--input` or `--results-dir` path
a document repeats is at most 1024 units as JSON writes it (a quotation mark
or backslash in a Linux file name counts twice). If the results directory is
replaced by a link while a report runs, the report is discarded.

## Limits and run time

- `tolerance`: 1..6 outputs, 1..12 parameters (4096 corners), Monte Carlo
  100..100000 samples. The largest request measured (Foster network with 16
  stages and 64 times, 12 parameters, 100000 samples) took 51 s on Windows 11
  with CPython 3.12; the rule gives `tolerance` 600 s.
- `report`: 1..32 calculations with at most 1 000 000 Monte Carlo samples in
  total; the rule gives it 1800 s.
- Lists: 64 resistances, loads and times; 16 Foster stages.

## What it does not do

- It does not invent data: a quiescent current is used when given or neglected
  only with `neglectIq: true`; core loss is added only when supplied; datasheet
  values are not scaled to other conditions or read from graphs.
- thetaJA is never combined with thetaJC, thetaCS, thetaSA or thetaCA: it
  already describes the whole junction-to-ambient path on its test board
  ([TI SPRA953](https://www.ti.com/lit/an/spra953d/spra953d.pdf)).
- Corner analysis finds the extremes only for outputs that are monotonic in
  each parameter; the `monotonic` check reports where that fails. Monte Carlo
  needs an explicit seed and distribution per parameter and always comes with
  the corners. The same seed repeats exactly on one Python runtime.
- No thermal certification, CFD/FEM, Cauer networks, repetitive-pulse thermal
  superposition, magnetic core-loss estimation or insulation sizing.

The script has no dependency and writes nothing into its own folder. Verified
on Windows x64 with the toolchain Python 3.12, a direct `uv run --offline
--script`, and VERA's provisioner with uv 0.11.25 on its managed CPython 3.13.
Not yet run: native Ubuntu x64.

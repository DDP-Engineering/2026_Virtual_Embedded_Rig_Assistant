# power-profiler: operations, profile, capture folder and results

Owner requirement: REQ-DATA-dd3e4fe1. Plugin `05_Software/plugins/power-profiler/` (LAB-05, #106). Lease and supervision
contract: `.agentic/specs/REQ-DATA-f2cbfc23.md` sections 1-6; lab-validate engine: `.agentic/specs/REQ-DATA-53797d16.md`;
HIL plans: `.agentic/specs/REQ-DATA-5f714098.md`.

## 1 Programs

| Program | Install | Role |
|---|---|---|
| `power-profile` | script `scripts/power_profile.py`, PEP 723, Python >= 3.12, `pyjoulescope_driver==2.5.5` | live: `tools`, `identify`, `capture`; cleanup `release` |
| `power-analyze` | script `scripts/power_analyze.py`, PEP 723, standard library, Python >= 3.11 | offline: `acquisition`, `import`, `inspect`, `measure-energy`, `segment`, `compare`, `battery`, `report` |

Both share the support package `scripts/power_support/`. `series.py` is a byte-identical copy of lab-validation's
`lab_validation/series.py`, `elf.py` of gdb-debug's `gdb_support/elf.py`, `workspace.py` of the ELEC/lab path module; a
test keeps the copies identical. `power-profile` imports `pyjoulescope_driver` only inside its live operations, so
`--help`, `--version` and refusals work without it. `power-analyze` never imports it.

Manifest: `power-profile` gets `POWER_PROFILE_REGISTRY=${workbench}/lab/resources.json` and
`resources {option: --meter, kinds: [power-monitor], grace: 10, cleanup: [release], cleanupTimeout: 30}`.

## 2 Options

Every option is `--name value` (argparse, abbreviations off). Values never start with `-`. Common to every operation
that writes: `--results-dir <dir>` (default `embedded-lab-results`, inside the working directory, never `.vera`) and
`--run-id <1-64 of [A-Za-z0-9._-]>` (default a ULID-like id: 48-bit milliseconds and 80 random bits, Crockford
base 32, as gdb-debug); the run folder is created exclusively
after the inputs were read and checked.

`power-profile`:
- `tools [--list]` - driver and USB prerequisites; `--list` adds the connected Joulescope device paths.
- `identify --meter <alias>`.
- `capture --meter <alias> --duration <s> --rate <Hz> [--current-range auto|<label>] [--voltage-range <label>]
  [--markers <n>[,<n>]...] [--firmware <file>] [--board <text>] [--condition <name>=<value>]... [--label <text>]`.
  Defaults: current range `auto`; voltage range unchanged (the meter's own, recorded from its readback); no markers. `--duration` 0.01...3500; rate x
  duration <= the profile's `maxSamples` (1 000 000); at most 16 conditions, names `[a-z][a-z0-9_-]{0,31}`, values
  1-120 printable characters; board 1-120 printable characters.
- `release --meter <alias>` - the manifest's cleanup.

`power-analyze`:
- `acquisition --profile <id> --duration <s> --rate <Hz> [--current-range ...] [--voltage-range ...] [--markers ...]` -
  the same checks as capture, offline; prints the effective settings; writes nothing.
- `import --csv <file> (--time-column <c> --time-unit s|ms|us|ns | --rate <Hz>) --current-column <c> --current-unit
  A|mA|uA|nA --voltage-column <c> --voltage-unit V|mV [--power-column <c> --power-unit W|mW|uW] [--marker <n>=<c>]...
  [--delimiter ,|;|tab] [--uniform true|false] [--meter-model <text>] [--meter-serial <text>] [--firmware <file>]
  [--board <text>] [--condition <name>=<value>]... [--label <text>]` - columns by header name; at most 64 MiB and
  1 000 000 rows.
- `inspect --capture <dir>` - prints; writes nothing.
- `measure-energy --capture <dir> [--from <s>] [--to <s>] [--sign 1|-1] [--current-offset <A>] [--offset-source <text>]`.
- `segment --capture <dir> (--markers <n> --event high|low|cycle | --timestamps <file> | --threshold <A> [--min-gap <s>])
  [--states <name>:<upper A>,...,<name>] [--from <s>] [--to <s>] [--sign 1|-1] [--current-offset <A>]`.
- `compare --a <segment run> --b <segment run> [--supply-tolerance <percent>, default 1] [--energy-limit <J per period>]`.
- `battery --profile <segment run> --battery <file>`.
- `report --run <dir> (1...20 times) [--title <text>]`.

Quantities on the command line are plain numbers in SI units (s, Hz, A, J); CSV units are declared per column.

## 3 Profile

`profiles/joulescope-js220.json`, selected by the registry entry's `profile`:

```json
{"format": 1, "id": "joulescope-js220", "status": "unverified", "model": "js220",
 "description": "Joulescope JS220 precision energy analyzer over USB",
 "rates": [1000000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
 "maxSamples": 1000000, "maxDuration": 3500,
 "currentRanges": [{"label": "10 A", "limit": 10}, {"label": "180 mA", "limit": 0.18}, ...],
 "voltageRanges": [{"label": "15 V", "limit": 15}, {"label": "2 V", "limit": 2}],
 "markers": [0, 1, 2, 3],
 "burden": "<text>", "signConvention": "<text>"}
```

Unknown fields, an empty or unsorted rate list, duplicate labels or non-positive limits refuse the profile. A sample's
range code indexes `currentRanges` in order; a code outside the list is checked against the largest limit. Status
`unverified` is reported in every result until a run with a real meter records the profile verified.

## 4 Registry kind `power-monitor` (REQ-DATA-f13cc264)

`{"alias": "js1", "kind": "power-monitor", "resource": "u/js220/<serial>", "profile": "joulescope-js220", "note": "..."}`;
serial `[A-Za-z0-9_-]{1,32}`; key `power-monitor:js220:<serial in lower case>`. The helper reads the file from
`$POWER_PROFILE_REGISTRY`, checks `$VERA_REGISTRY_SHA256` when present, takes the entry of the alias and refuses a
missing alias, another kind, unknown fields or a profile it does not have (exit 2, code `request`).

## 5 Live operations

Device handling (REQ-SEC-f040d125): the meter is opened with mode `restore` (never `defaults`); the helper queries
`s/i/range/mode`, `s/i/range/select`, `s/v/range/mode`, `s/v/range/select`, `h/fs` and the metadata `<topic>$` to map option values to
names. It publishes only `h/fs`, `s/i/range/mode` (`auto` or `manual`, by name), `s/i/range/select`,
`s/v/range/mode` (`manual`, by name) and `s/v/range/select` (only with `--voltage-range`), and the signal controls
`s/i/ctrl`, `s/v/ctrl`, `s/p/ctrl`, `s/i/range/ctrl`, `s/gpi/<n>/ctrl`; a restore writes back the previous named
values. The current path is `on` only when the range mode reads back as the name `auto` or `manual`: `off` gives
`blocked` (code `current-path-off`), a raw value the metadata does not name or no value gives `blocked` (code
`current-path-unknown`), both before any publish. The
device is never asked for defaults, a general-purpose output, a firmware or FPGA update, calibration or a reset.

`identify`: reads `c/hw/version`, `c/fw/version`, `s/fpga/version`, the range mode and selections and reports
`currentPath` (`on`, `off`, `unknown`); result status `pass`, or `blocked` with code `device-missing` (path not in
`device_paths()`) or `driver` (import or open failed). A registry entry whose model differs from its profile is refused
(exit 2, code `request`) before any device call.

`capture`, in phases reported to `$VERA_RUN_CONTROL/state.json` (start, identified, acting, cleaning, released):
1. registry, profile, acquisition and firmware checks (refusals exit 2, nothing written, no device call);
2. device present, opened, model checked, settings read (`previous`); range mode off -> blocked;
3. settings applied when they differ and read back (`applied`), physical `pending` from the first publish;
4. streaming: data topics `s/i/!data`, `s/v/!data`, `s/p/!data`, `s/i/range/!data`, `s/gpi/<n>/!data`. Output
   sample index = `sample_id // decimate_factor`, rate = `sample_rate // decimate_factor`; index 0 is the first
   sample every enabled signal covers (the largest first index among the signals' first messages). A message whose index is beyond the expected next one opens a gap of the skipped samples; NaN values
   are missing samples. GPI data is packed 8 samples per byte, least significant bit first; range codes are one per
   byte. The capture ends when every enabled signal holds `duration x rate` samples, on a stop request (`stop` in the
   control folder, polled every 20 ms), on device removal (`@/!remove`), when no data arrived for max(2 s, 10 / rate)
   (code `stalled`), or at duration + 10 s wall time (code `deadline`);
5. phase `cleaning`: signals off and the `previous` settings restored where they changed, each write on its own (one
   failure never skips the others), read back (`restored`); physical `confirmed` when every write succeeded and the
   readback equals `previous`, `unchanged` when nothing was changed, else `unknown`; phase `released`;
6. the run folder is written.

Status: `pass` (complete, no gap, no missing channel sample, no overflow), `incomplete` (gaps, a channel's missing
samples, overflow, stopped or short), `blocked` (before any setting changed), `error` (device lost, stalled, deadline,
driver error, an unexpected exception - recorded as code `internal` with the meter still restored - or no data).

`release` (cleanup, `VERA_CLEANUP_OF` set): device present -> open `restore`, current path `off` or `unknown` ->
report `unknown` with no write;
otherwise signals off, range mode `auto`, read back; `confirmed` when the readback says auto, else `unknown`. It writes
no run folder; it prints one JSON line.

`tools`: `{driver: {package, version} | {missing: reason}, python, platform, usb: {...}, devices?: [...]}`. Windows:
`WINUSB.DLL` present in the system folder. Linux: a udev rule file matching `*joulescope*` in `/etc/udev/rules.d` or
`/lib/udev/rules.d` / `/usr/lib/udev/rules.d`, and the user's groups. Nothing is installed or written; missing items
come with the vendor's instructions as text.

## 6 Capture folder

`<results>/<run-id>/result.json` and `samples.csv`.

samples.csv: header `t_s,current_A,voltage_V,power_W,range,gpi<n>...,flags`; one row per sample index from 0 to the
last, rows of missing samples kept with empty value cells; `t_s` = index / rate for a meter capture, the file's time
for an import; numbers written with 9 significant digits (time 12); `flags` holds `m` (missing), `i` (current over
the range limit), `v` (voltage over the range limit), combined, or is empty; `m` marks a row where current, voltage
or power is missing. result.json `missing` counts each channel's missing samples (GPI samples inside a current skip
are missing, never padding bits).

result.json (kind `power-result`, operation `capture` or `import`):

```json
{"format": 1, "kind": "power-result", "operation": "capture", "status": "pass",
 "tool": {"name": "power-profile", "version": "1.0.0", "driver": "2.5.5"},
 "started": "...", "ended": "...", "problems": [{"code": "...", "message": "..."}],
 "meter": {"alias": "js1", "resource": "u/js220/000415", "model": "js220", "serial": "000415",
           "profile": "joulescope-js220", "profileStatus": "unverified", "source": "measured",
           "versions": {"hardware": "...", "firmware": "...", "fpga": "..."}},
 "acquisition": {"rate": 10000, "duration": 0.2, "currentRange": "auto", "voltageRange": "15 V", "markers": [0]},
 "settings": {"previous": {...}, "applied": {...}, "restored": {...}},
 "timebase": {"clock": "meter", "rate": 10000, "uniform": true, "samples": 2000, "firstSampleId": 0,
              "decimate": 100, "startUtc": "..."},
 "channels": [{"name": "current", "unit": "A", "column": "current_A"}, ...],
 "gaps": [{"from": 120, "samples": 50, "seconds": 0.005, "cause": "skip|nan"}],
 "overflow": {"current": 0, "voltage": 0},
 "ranges": {"codes": {"1": 1500, "2": 500}, "switches": 3},
 "burden": "...", "signConvention": "...",
 "firmware": {"path": "...", "bytes": 1, "sha256": "...", "format": "elf|hex|bin", "machine": "...", "buildId": "..."},
 "board": "...", "conditions": {"supply": "3.3V"}, "label": "...",
 "lifecycle": {"phases": [...], "physical": "confirmed"},
 "artifacts": [{"path": "samples.csv", "bytes": 1, "sha256": "..."}]}
```

An import has `tool.name` `power-analyze`, `meter.source` `declared`, `timebase.clock` `file`, `uniform` as declared,
no `settings`, `lifecycle` or `ranges`, and `inputs.csv` with the file's hash. Gaps of an import are the empty cells;
on a uniform import a step longer than 1.5 x the median step is a gap too (series rule of lab-validate).

## 7 Analysis

Series: the capture is read through `result.json` and `samples.csv` (hash-checked, code `source-changed`), built with
`series.build` (missing samples removed and kept as gaps, never interpolated across). Corrections: current
`sign x i - offset`. Power: the capture's `power_W` when present and no correction was declared (`energySource`
`meter-power`), else `v x i` per sample (`v*i`). Integrals use the trapezoid rule over gap-free intervals.

measure-energy (operation `measure-energy`): window default the whole capture; metrics current/voltage/power
`{mean, min, max, unit}` (mean over the time with data), `energy {value, covered, unit: "J"}`, `charge {value, covered,
unit: "C"}`, `coveredSeconds`, `gapSeconds`, `overflow`, `negative {samples, charge}`, `ranges {seconds, switches}`,
`corrections {sign, currentOffset, offsetSource}`, `definitions`. A gap or an overflow sample inside the window makes
`energy.value` and `charge.value` null and the status `incomplete` (REQ-REL-d02aa9e4); min/max over overflow are
reported with `bound: true`.

segment (operation `segment`): events by
- markers: GPI `<n>` of the capture; `high` = rising to the next falling edge, `low` = falling to rising, `cycle` =
  rising to the next rising; an edge is at the first sample of the new level (resolution 1 / rate); sync
  `{method: "marker", channel: "gpi<n>", resolution}`;
- timestamps: `{"format": 1, "clock": "meter", "capture": "<sha256 of the capture's result.json>", "provenance":
  "<text>", "events": [{"name": "...", "from": s, "to": s}]}` (1-10 000 events, increasing, inside the capture); any
  other `clock`, or a hash of another capture, is refused with code `sync`; sync `{method: "timestamps", provenance}`;
- threshold: maximal runs of samples with current >= threshold, runs closer than `--min-gap` (default 0) merged; sync
  `{method: "threshold", threshold}`.
Events cut by the window or by a gap at their edge are not events (`partial` count). Per event: `index, from, to,
duration, charge, energy, meanCurrent, peakCurrent, status` (energy/charge null over a gap or overflow). States: with
`--states`, each sample interval belongs to the first state whose upper limit exceeds its left sample's current; with
markers, the states are the marker levels `high` and `low`; per state `{seconds, charge, energy}` (null as above).
Known limits: an event whose begin edge falls inside a missing-marker stretch is dropped without a `partial` count;
`report` holds every parsed capture in memory until it writes (about 0.1 GB per 1 000 000 rows). Statistics over the
events with values: `n, mean, stdev, min, max` of energy, charge and duration, `period` (mean
start-to-start). `events.csv` holds the events. Result also records `voltage.mean` of the window and the capture's
setup (meter model and serial, acquisition, board, conditions, firmware).

compare (operation `compare`): reads two segment runs (hash-checked; each one's capture path must lie in the working
directory). Setup fields, from the capture's readback (`settings.applied`) where it exists: meter model and serial, rate,
current and voltage range, sync method and its parameters, board, conditions, and the supply voltage (window mean)
within `--supply-tolerance` percent. Classification, first match: `unidentified` (a capture without firmware),
`setup-difference` (any setup field differs; listed), `same-firmware` (equal SHA-256), `firmware-change`.
`difference {perEvent, perPeriod}`, each `{value, standardError, relative, nA, nB}` = mean B - mean A and
sqrt(sA^2/nA + sB^2/nB) of the energy per event and per period; `attribution` `firmware` only for `firmware-change`.
`lab-validation-request.json`: sources `A`/`B` (importer `power-capture`, the capture folders with their result.json
SHA-256, conditions = the setup fields as text; the supply as A's mean when within tolerance, each one's own
otherwise), signals `A-power`, `A-current`, `B-power`, `B-current`, measurements `<X>-energy` and `<X>-charge`
(metric `integral`) over the first N whole periods of each (from the first event's start to the start of event N+1),
N = min(periods A, periods B), and with `--energy-limit` (J per period) criteria `C-A-energy`/`C-B-energy` `<=` N x
limit; `decisionRule` `simple`, `missingData` `incomplete`. No request is written (problem `request-not-written`)
when a segment run used a current offset (lab-validate signals have no offset) or has no whole period.

Periods (segment): from each event's start to the next event's start (so sleep between bursts counts); per period
the average power (energy / duration) and current (charge / duration); `periods {n, from, to, power, current,
energy, charge, duration}` (each `{n, mean, stdev, min, max}`) with n >= 1 when there are at least two events and no
gap or overflow inside the periods (else null).

battery (operation `battery`): the profile is a segment run with status pass and >= 3 events (>= 2 periods); the load
is its periods' average power and current, as the range min...max over the periods; the rail voltage is the window
mean. Battery file:

```json
{"format": 1, "capacity": {"min": 220, "max": 240, "unit": "mAh"}, "energy": {"min": 0.8, "max": 0.9, "unit": "Wh"},
 "voltage": {"min": 2.8, "max": 3.0, "unit": "V"}, "usable": {"min": 0.8, "max": 0.9},
 "conversion": {"kind": "direct|linear|switching", "efficiency": {"min": 0.85, "max": 0.9},
                "quiescent": {"min": 1e-6, "max": 2e-6, "unit": "A"}},
 "selfDischarge": {"min": 1, "max": 3, "unit": "%/month"}, "note": "..."}
```

Exactly one of `capacity` (mAh or Ah) and `energy` (Wh, mWh or J). Domains: `direct` and `linear` work in charge
(input current = rail current + quiescent; an `energy` battery needs `voltage` to become charge); `switching` works in
energy (input power = rail power / efficiency + battery voltage x quiescent; `efficiency` required; a `capacity` needs
`voltage`). Self-discharge is a loss of the full capacity per month (30.44 days). Life interval: the low end takes
every input at its pessimistic end, the high end at its optimistic end; values are rounded outwards to two
significant figures (one when high / low > 10, `precision: "order-of-magnitude"`); no single value is printed.
Refusals (exit 2, code `battery`): a missing required field, a profile that is not pass or has < 3 events, min > max,
an efficiency outside (0, 1], usable outside (0, 1].

report (operation `report`): `report.md`, `report.html`, `current-<n>.svg` per capture (min/max envelope over at most
1000 columns), after checking each run's artifacts.

## 8 Results and exit codes

Every written result is `result.json` of format 1, kind `power-result`, with `operation`, `status`, `tool`,
`started`, `ended`, `problems`, `inputs` (paths and SHA-256) and `artifacts`. Statuses: `pass`, `incomplete`,
`blocked`, `error`; nothing is judged `fail` here (criteria belong to lab-validate). The printed JSON is at most 11 000
characters.

Exit codes: 0 `pass`; 2 refused or blocked before any device setting changed (a refusal writes nothing; a blocked
identify/capture writes its result); 3 `incomplete`; 4 `error`.

## 9 lab-validate additions

- Units `C` and `J` (with prefixes) in quantities; `V s` for the integral of a voltage.
- Metric `integral` (amplitude): trapezoid integral over the window, unit C for A, J for W, `V s` for V; any gap inside
  the window -> `unknown` with reason `gap`; clipped samples follow the engine's clipping rule.
- Importer `power-capture`: a power-profiler capture or import folder (`result.json` kind `power-result`, operation
  capture or import, status pass or incomplete, at most 4 MiB) and `samples.csv` checked against the SHA-256 that
  `artifacts` records; channels `current` (A), `voltage` (V), `power` (W) and `gpi<n>` (dimensionless); missing cells
  are gaps; `flags` `i` clips the current sample, `v` the voltage sample (and both clip power); time zero is the
  capture's first sample on the meter clock, or the imported file's own time origin; samples.csv may hold up to
  128 MiB; uniform as the timebase records; conditions and meter/firmware identity reported as captured.

## 10 HIL adapters

- `power.identify` `{meter}` -> `identify --meter <m> --results-dir <step folder>`.
- `power.capture` `{meter, duration, rate, currentRange?, voltageRange?, markers?, conditions?}` -> `capture ...
  --firmware <plan firmware> --results-dir <step folder>`; background allowed; a later `lab-validate.compare` source
  may name it (`step`), which binds to its run folder (adapter flag `captures`, also set on `scpi.capture`).
- Exit codes map 0 pass, 2 blocked, 3 incomplete, other error.

# scpi helper: operations, profiles and results

Governs REQ-DATA-b3e2930f, REQ-DATA-4451f705, REQ-SEC-f9f009d9, REQ-SEC-8737759e, REQ-SEC-9524d2c9,
REQ-FUNC-b1ab08fd, REQ-FUNC-712a3679, REQ-REL-4f6d4a31, REQ-FUNC-f682af02, REQ-FUNC-a8dcf154, REQ-SEC-371cdb26,
REQ-TEST-2d32cd86. Registry, keys, leases and supervision: `.agentic/specs/REQ-DATA-f2cbfc23.md`.

## 1 Command line

`scpi <operation> [options]`; the operation is the first argument, anything else as first argument is refused (exit 2).

| Operation | Options | Instrument I/O | Rule risk |
|---|---|---|---|
| `--version`, `--help`, `-h` | | none | safe |
| `capabilities` | `--alias A` or `--profile ID` (never `--instrument`, which would reserve the instrument) | none | safe |
| `discover-configured` | `[--list-local]` | none; with `--list-local` serial ports (pyserial) and USBTMC devices (pyusb), never VISA's resource search | safe / device-read |
| `decode` | `--capture FOLDER` | none | safe |
| `identify` | `--instrument A` | `*IDN?` | device-read |
| `read` | `--instrument A [--channel CH]` | measurement queries | device-read |
| `capture` | `--instrument A --channel CH` | waveform transfer settings, preamble and data queries | device-read |
| `status` | `--instrument A` | state queries | device-read |
| `configure` | `--instrument A --set NAME=VALUE` (1...16) | settings, then readback | device-write |
| `close` | `--instrument A` | cleanup steps (outputs off), then readback | device-write |
| `output` | `--instrument A --channel CH --voltage V --current I --hold S` (S 1...3500) | set-points, output on, hold, off, readbacks | irreversible (`output`, rule timeout 3600 s) |

Every instrument operation also takes `--results-dir DIR` (default `embedded-lab-results`) and `--run-id ID`. The
registry is `$SCPI_REGISTRY` (the manifest sets `${workbench}/lab/resources.json`). Exit codes: 0 pass, 1 fail, 2
refused or blocked before any instrument effect, 3 incomplete or error during I/O.

## 2 Profiles

`profiles/<id>.json` in the package, format 1, validated when loaded (a profile with any issue is not used):
`id`, `class` (`dmm`, `scope`, `psu`), `title`, `source` (vendor document), `verification` (`status`
`unverified`|`verified`, `instruments` [{model, firmware, transport, os, date}]), `identity` (`manufacturers`,
`models`, `firmware` regular expression), `transport` (`readTermination`, `writeTermination`, `timeoutMs` 100...60000,
`chunkBytes`), `channels` (name -> limits), `commands` (fixed slots of the class, each a SCPI string with `{channel}`,
`{index}`, `{value}` and `{function}` placeholders only) and class data (PSU output-state words; DMM functions with
unit and ranges and the overload value; scope time-base bounds, minimum scale, preamble field order and sample format
with `maxPoints`). The configure settings of each class are fixed in the helper (`request.py`): PSU
`<CH>.voltage|current`, DMM `function`, `range`, scope `timebase`, `<CH>.scale|offset`.

The helper maps operations to slots in code: the effect of a slot is fixed by the helper, never by the profile, and the
registry holds no command. Shipped profiles (all `unverified`, written from the vendors' programming guides):
`keysight-34461a` (34460A/34461A DMM), `rigol-ds1000z` (DS1054Z/DS1074Z/DS1104Z scope), `rigol-dp800` (DP832/DP832A
power supply).

## 3 Lifecycle and stop

Each instrument operation opens the declared resource with the profile's terminators and timeout, queries `*IDN?` and
checks manufacturer, model, firmware pattern and the declared serial number (identify reports a mismatch; every other
operation stops as `blocked`). It writes `state.json` (phases `start`, `identified`, `acting`, `cleaning`, `released`)
when `VERA_RUN_CONTROL` is set, checks `<control>/stop` between commands and every 100 ms of a hold, and closes the
session and resource manager on every path. `configure` and `output` are `blocked` while `VERA_RESOURCE_STATE` marks the
alias `unknown`. `close` and the end of `output` report `physical: confirmed` only after a readback that all outputs of
the profile are off.

## 4 Results

`<results-dir>/<run-id>/result.json`, format 1, kind `scpi-result`, written by every instrument operation that passes the
request, registry, limit and state checks (earlier refusals only print their document): `tool {name, version, pyvisa,
pyvisaPy}`,
`operation`, `runId`, `started`, `finished`, `status` (`pass`, `fail`, `incomplete`, `blocked`, `error`),
`instrument {alias, resource, backend, profile {id, class, title, source, verification}, identity {manufacturer, model,
serial, firmware, raw}, matchingProfile?}`,
`inputs` (registry path and SHA-256, arguments), `lifecycle {phases, physical, stopRequested}`, `values` (quantity,
value, unit, channel, raw; a meter adds its function and `overload`), `series` (channel, points, unit, time base, file), `settings` (requested and read back),
`problems` [{code, message}], `artifacts` [{path, bytes, sha256}]. A capture also writes `waveform-<CH>.csv`
(`time_s,volts`), `raw-<CH>.bin` (the data block without header) and `preamble-<CH>.json`; `decode` writes the same
series from them; it accepts only `preamble-<CH>.json` and `raw-<CH>.bin` with `<CH>` of 1-16 letters, digits, `_`
or `-`, regular files (no links) of at most the capturing profile's `maxPoints` x sample width bytes, checked before
its run folder is created. A capture refuses a block whose header announces more than that (`limit`) before reading
its data. The printed document is at most 11 000 UTF-16 units (series and long lists are left to the files).

Problem codes: `truncated-transfer`, `visa-timeout`, `instrument-absent`, `driver-missing`, `connection-lost`,
`reconnected`, `unexpected-reply`, `identity-mismatch`, `profile-unknown`, `registry-changed`, `state-unknown`,
`readback-mismatch`, `output-on`, `clipped`, `stopped`, `limit`, `request`, `internal`.

Physical state: `close` and the end of `output` confirm a power supply by reading every output back off. A multimeter
or oscilloscope has no output: their `close` reports `confirmed` meaning no output to energize - their settings are
not restored or read back. The `output` hold keeps the output on for `--hold` seconds by the clock, measuring about
once a second (at 0, 1, ... and at the end).

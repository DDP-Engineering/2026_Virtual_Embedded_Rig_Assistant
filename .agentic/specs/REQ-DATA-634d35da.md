# bus-tool: operations, bus profile, registry fields, BPIO2 mapping and results

Governs REQ-DATA-634d35da and the bus-tools requirements that name this spec. The host side of the registry kind
`bus-adapter` is `.agentic/specs/REQ-DATA-f2cbfc23.md` sections 1 and 2.

## 1 Backend

One backend, `bus-pirate-bpio2`: a Bus Pirate whose StatusResponse reports `version_hardware_major` 5 or 6 (Bus Pirate
5 REV8/REV10/XL and Bus Pirate 6 build targets) and `version_flatbuffers_major` 2, reached on its second USB CDC
serial port after the user selected the BPIO2 binary mode with the `binmode` terminal command. Any other answer is
`adapter-unsupported`; no other Bus Pirate generation or bridge is claimed. Verified only against the simulated adapter
until a real one is connected (open blocker).

## 2 Command line

```text
bus-tool --version | --help
bus-tool devices
bus-tool capabilities   [--bus PROFILE]
bus-tool identify       --adapter ALIAS
bus-tool pins           --adapter ALIAS
bus-tool scan           --adapter ALIAS [BUS] [--from 0xNN] [--to 0xNN]
bus-tool configure-bus  --adapter ALIAS BUS
bus-tool read-register  --adapter ALIAS --bus PROFILE [--device NAME] [--register NAME]... [--clears]
bus-tool write-register --adapter ALIAS --bus PROFILE [--device NAME] --register NAME --value HEX
bus-tool transfer       --adapter ALIAS BUS [--device NAME] [--write HEX] [--read N]
bus-tool sequence       --adapter ALIAS BUS [--device NAME] --step STEP [--step STEP]... [--clears]
bus-tool capture        --adapter ALIAS BUS --duration SECONDS [--write HEX]
bus-tool release        --adapter ALIAS
bus-tool report         --run DIR [--run DIR ...] [--title TEXT]
```

`BUS` is `--bus PROFILE`, or the bus described by the call: `--mode i2c|spi|uart`, `--address 0xNN` (an I2C device,
0x08-0x77; alone it means I2C), `--speed N` (Hz, or baud on a UART), `--spi-mode 0-3` (cpol = bit 1, cpha = bit 0) and
`--pullups on|off`, over the defaults of section 4. The two are not combined (`arguments`). `scan` without either is
I2C with the defaults. A call's options build the same profile document a file would hold, with one device named
`device` when `--address` is given.

Every bus operation takes `--supply MV` (800-5000) with `--supply-ma MA` (1-500, default 100) and `--keep`.
Every operation except devices, capabilities and pins takes `--run-id ID` (1-64 of `[A-Za-z0-9._-]`, letter or digit
at both ends) and `--results-dir DIR` (default `arduino-iot-results`, inside the working directory, never `.vera`).
`HEX` is an even number of hex digits without prefix or separators; `transfer` needs `--write` or `--read` (`--read`
0 to 512). `--duration` is 1 to 300. `--from` and `--to` default to 0x08 and 0x77. The registry is the file
`$BUS_REGISTRY` (VERA sets `<workbench>/lab/resources.json`). `--bus` is a regular file inside the working directory
(64 KiB at most). Abbreviated options are refused.

A `STEP` (at most 32 per sequence) is one of:

| Step | Meaning |
|---|---|
| `read [DEVICE.]REGISTER` | one register read, as read-register |
| `write [DEVICE.]REGISTER HEX` | the register's bytes followed by 1-64 bytes |
| `transfer HEX\|- [N]` | one transaction to `--device` or the only device: the bytes (`-` for none), then N read (0-512) |
| `delay MS` | a pause of 1-10000 ms; the delays of one sequence add up to at most 60 s |

A register without a device name belongs to `--device`, or to the profile's only device.

## 3 Registry entry (kind `bus-adapter`)

```json
{ "alias": "bp", "kind": "bus-adapter", "backend": "bus-pirate-bpio2", "resource": "COM35", "terminal": "COM34",
  "identity": "usb:1209:7331:bp5x0001", "power": { "maxMv": 3300, "maxMa": 100 }, "note": "bench Bus Pirate 5" }
```

`resource` is the binary (BPIO2) port and `terminal` the other port of the same adapter, each `COM<n>` or a `/dev/`
path, never the same port. `identity` is the key the devices operation lists, `usb:<vid 4 hex>:<pid 4 hex>:<serial>`.
`power` is optional: when present it caps the supply a call may ask for (`power-not-allowed` above it). Entries of
other kinds are ignored by bus-tool; an alias of another kind is `adapter-unknown`.

## 4 Bus profile (format 1, kind `bus-tools-profile`)

```json
{
  "name": "bme280-bench",
  "wiring": { "logicMv": 3300, "note": "SDA IO0, SCL IO1, sensor powered by the board" },
  "bus": { "mode": "i2c", "speedHz": 100000, "pullups": true },
  "devices": [
    { "name": "bme280", "address": "0x76",
      "registers": [ { "name": "chip_id", "write": "d0", "expect": "60" }, { "name": "data", "write": "f7", "read": 8 } ] }
  ]
}
```

Only `bus.mode` is required. Unknown keys anywhere are refused (`profile-invalid`).

- `format` 1 and `kind` `bus-tools-profile` when given; `name` 1-64 printable characters (default `bus`).
- `wiring`: optional `commonGround` (boolean), `logicMv` 1200-5000 and `note` (256 characters); they describe the
  bench and set nothing on the adapter.
- `power`: `{source: "external"}` (default) or `{source: "adapter", mv: 800-5000, ma: 1-500 (default 100)}`.
- `bus` by mode:
  - `i2c`: `speedHz` 1000-1000000 (default 100000), `pullups` (default true), `clockStretch` (default false).
  - `spi`: `speedHz` 10000-20000000 (default 1000000), `cpol` 0|1 and `cpha` 0|1 (default 0), `csIdle` `high`|`low`
    (default high), `bitOrder` `msb`|`lsb` (default msb), `pullups` (default false).
  - `uart`: `baud` 300-1000000 (default 115200), `dataBits` 5-8 (default 8), `parity` `none`|`even` (default none;
    the binary mode offers no odd parity), `stopBits` 1|2 (default 1), `pullups` (default false).
- `limits`: `maxWriteBytes` 1-512 and `maxReadBytes` 1-512 per transaction (default 512), `timeoutMs` 100-10000
  (default 2000).
- `final`: `release` (default) or `keep`.
- `devices`: 0-16, `name` `^[a-z][a-z0-9_-]{0,31}$` unique. `address` (`0x08`-`0x77`, two hex digits) is required for
  i2c and absent otherwise. `registers` (0-64, not for uart): `name` as a device name, unique in the device; `write`
  0-4 bytes of hex (I2C: register address; SPI: command bytes); `read` 0-64 and at most `maxReadBytes` (default 1;
  0 for a register that is only written); `access` `read` (default) or `read-clears`; optional `expect` (exactly
  `read` bytes of hex) and `note`. A device may carry an optional `note` (256 characters).

The device of a request is `--device`, else the profile's only device, else on SPI and UART an unnamed one; a call
that leaves it open on I2C is `device-unknown` (or `register-unknown` for the register operations).

## 5 BPIO2 on the wire

Each request is a FlatBuffers `RequestPacket{version_major: 2, minimum_version_minor: 0, contents}` COBS-encoded and
followed by one 0x00; each answer is one COBS frame ending at 0x00 holding a `ResponsePacket{error, contents}`. Frames
larger than 64 KiB, frames that do not decode, and `DataResponse` frames with `is_async` true while a reply is awaited
are not replies (async frames are kept as received UART data). Before a request is sent, complete frames already
waiting are taken out: an async one is kept, any other is the late answer to an earlier request and is discarded
(warning `late-reply`). Field slots follow `bpio.fbs` (BusPirate5-firmware main), written with every given field
explicit:

| Operation | Request |
|---|---|
| status | `StatusRequest` without a query vector (all queries) |
| configure (i2c) | `ConfigurationRequest{mode: "I2C", mode_configuration{speed, clock_stretch}, pullup_enable or pullup_disable, psu}` |
| configure (spi) | `... mode: "SPI", mode_configuration{speed, data_bits 8, clock_polarity, clock_phase, chip_select_idle}, mode_bitorder_msb or _lsb, ...` |
| configure (uart) | `... mode: "UART", mode_configuration{speed = baud, data_bits, parity, stop_bits}, ...` |
| psu | `psu_enable, psu_set_mv, psu_set_ma` when the call or the profile powers the circuit; else `psu_disable` |
| release | `ConfigurationRequest{mode: "HiZ", mode_configuration{}, pullup_disable, psu_disable}` |
| i2c data | `DataRequest{start_main, data_write [address << 1, bytes...], bytes_read, stop_main}` |
| i2c probe (scan) | `DataRequest{start_main, data_write [address << 1], bytes_read 0, stop_main}` |
| spi data | `DataRequest{start_main (select), data_write, bytes_read, stop_main (deselect)}` |
| uart data | `DataRequest{data_write, bytes_read 0}`; received bytes arrive as async `DataResponse` frames |

Never written: `hardware_bootloader`, `hardware_reset`, `hardware_selftest`, `io_direction_mask`, `io_direction`,
`io_value_mask`, `io_value`, `print_string`, `led_*`. Status and release replies wait 2 s; the bus configuration and
data replies wait the profile's `timeoutMs`. Each request is sent once.

Read from a status besides the versions and modes: `mode_pin_labels` and `adc_mv`. `adc_mv` holds one reading per IO
pin, IO0 first. The labels list every header pin, the supply pin first and ground last, so with two labels more than
readings the first and last are dropped; with another count that fits neither way no pin is labelled. A label that is
empty or a dash is no label.

Read-back: after a configuration, a status request must show `mode_current` equal to the mode (letter case ignored),
`pullup_enabled` and `psu_enabled` as requested (`config-mismatch` otherwise). The labelled pins of that status are
the result's `configuration.lines` (`{label: mV}`); on I2C a line labelled SDA or SCL under 700 mV gives the warning
`line-low`. Release is confirmed when the status shows `HiZ`, pull-ups off and supply off. Byte limits are the
smaller of the profile's and the status's `mode_max_write`/`mode_max_read` of the configured mode.

The firmware (src/binmode/bpio.c) answers every failed transaction with the one text "Protocol request failed"; on
I2C that text, or one naming a NACK, is `nack`.

## 6 Operations

- `devices`: `ports` (address, identity, stable, vid, pid, serialNumber, description, manufacturer, location) and `groups`
  (`{identity, ports}` for ports sharing a stable identity); no port is opened.
- `capabilities`: `backend` (`bus-pirate-bpio2`, hardware majors, protocol major, modes, operations, caps, defaults)
  and, with `--bus`, `profile` (name, mode, bus settings with every default, devices with registers, effective
  limits); no port is opened.
- Adapter operations first check the registry hash, the alias, the bus (profile or options) and every option, then
  that both ports are listed with the entry's identity, then open the binary port only, send a status request and
  check the backend (section 1). Then:
  - `identify`: `adapter` fields; physical `unchanged`.
  - `pins`: `mode`, `pullups`, `supply` `{enabled, setMv, measuredMv, measuredMa, currentError}` and `pins`
    (`{pin, label, mv, output, high}` for IO0 to IO7) from that status; physical `unchanged`, no run folder.
  - `configure-bus`: configuration, read-back; the bus stays configured (`final: configured`).
  - `scan` (i2c only, `scan-mode` otherwise): configuration, read-back, one probe per address from `--from` to
    `--to`; `scan` `{from, to, probed, found: [{address, device}]}` with the name of a profile's device at that
    address. A probe that fails with another text than a NACK ends the scan (`adapter-error`). Warnings: `no-device`
    (with the lines that read low) and `all-acknowledged`. The transcript holds one line for all probes.
  - `read-register`: configuration, read-back, then one data request per register with its bytes and length - the
    registers named, or without `--register` every register of the device with `access: read` and a length;
    `registers` `[{device, name, value, expected, matches}]`.
  - `write-register`: configuration, read-back, one data request with the register's bytes and the value.
  - `transfer`: configuration, read-back, one transaction; `transactions[0]`.
  - `sequence`: configuration, read-back, then its steps in order on the configured bus; the first step that fails
    ends it.
  - `capture` (uart only): configuration, read-back, the `--write` data request if any (bounded by `maxWriteBytes`),
    then async data for `--duration` seconds or until 1 MiB; files `capture.bin` (raw bytes), `capture.txt` (the
    bytes as UTF-8 text, line ends as `\n`) and `capture.csv` (`offsetMs,hex` per received chunk); `capture.text`
    holds the text, all of it up to 4000 characters, else its first 1200 and last 2500. Warnings `nothing-received`
    and `limit`.
  - `release`: release request and read-back.
- A transaction on a UART: async data kept so far is dropped, the bytes are sent in one data request, then async
  data is taken until the count asked for arrived, 0.3 s passed since the last byte, or `timeoutMs` passed. Fewer
  bytes than asked pass with the warning `short-read`; none is `no-response` (fail). The transaction also carries
  the bytes as `text`.
- After configure-bus fails, and after every other bus operation whatever its outcome, the final state applies:
  `keep` with `--keep`, else the profile's - `release` (the release request and read-back) or `keep` (one status
  read-back). The result's `final` is `{declared, state: {mode, pullups, psu}, physical}`, physical `confirmed` or
  `unknown`.
- Supply: the call's `--supply` and `--supply-ma`, else a profile with `power.source: adapter` (whose current limit
  `--supply-ma` replaces); above the registry entry's `power` limits it is `power-not-allowed`. Without either the
  supply is requested off.
- Supervision (spec REQ-DATA-f2cbfc23 section 6): `state.json` in `$VERA_RUN_CONTROL` goes start, identified, acting
  (physical `pending`), cleaning, released with the final physical state. The `stop` file is checked before the
  configuration, before every data request and probe, during a delay and during capture; a stop sends no further
  data request and applies release. A state VERA recorded as unknown refuses nothing: every bus operation begins
  with a whole configuration that is read back.
- `report`: `runs` (`{path, runId, operation, status, adapter, device, register, physical, errors}`).

## 7 Result document

`{format: 1, kind: "bus-tool-result", tool: "bus-tool 0.2.0", operation, startedAt, finishedAt, status, errors,
warnings, runId, resultPath, inputs {registry {path, sha256}, profile {path, sha256}}, adapter, bus, configuration,
transactions, registers, scan, capture, pins, final, requests, lifecycle}` (`requests`: the wire transcript,
`{request, reply, ...}` per request sent) (fields present when they apply; `inputs.profile` only for a profile
file). `bus.power` is `external` or `{mv, ma}`. A transaction is `{index, step, device, register, write,
readRequested, read, error, durationMs}` with bytes as lower-case hex, and `text` on a UART. Statuses `pass`, `fail`,
`incomplete`, `blocked`, `error`. Exit 0 pass, 1 fail, 2 blocked, 3 incomplete or error. Printed output is cut to
11000 UTF-16 units (long lists first, `omittedFromOutput` says what); the run folder keeps the whole document.

## 8 Problem codes

| Code | Status | When |
|---|---|---|
| arguments, path, run-exists, run-invalid | blocked | invalid call, path or run folder |
| registry, adapter-unknown, registry-changed | blocked | registry missing or invalid, alias absent or of another kind, hash differs |
| profile-invalid, device-unknown, register-unknown, clears-flags, limit, power-not-allowed, capture-mode, scan-mode | blocked | bus or request refused (limit also after the read-back, before any data request) |
| port-missing, identity-mismatch | blocked | a port is not listed or shows another identity |
| not-bpio2, adapter-unsupported | blocked | no valid BPIO2 status reply; unsupported versions or a packet-level error |
| config-error, config-mismatch | fail | configuration refused or not applied |
| nack | fail | a failed I2C transaction (the firmware's one error text, or a text naming a NACK) |
| adapter-error | fail | any other data error text |
| count-mismatch | fail | fewer or more bytes than requested (I2C, SPI) |
| unexpected-value | fail | register bytes differ from `expect` |
| no-response | incomplete, or fail on a UART | no reply in time; no byte from the UART's peer |
| stopped | incomplete | VERA asked to stop |
| disconnected | incomplete | the serial port failed |
| internal | error | anything unexpected |

Open: the error text, the async UART data (protocol minor 2) and the pin labels follow the firmware source and are
verified only against the simulated adapter.

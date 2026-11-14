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
bus-tool capabilities [--bus PROFILE]
bus-tool identify      --adapter ALIAS
bus-tool configure-bus --adapter ALIAS --bus PROFILE [--power]
bus-tool read-register --adapter ALIAS --bus PROFILE --device NAME --register NAME [--clears] [--power]
bus-tool transfer      --adapter ALIAS --bus PROFILE --device NAME [--write HEX] [--read N] [--power]
bus-tool capture       --adapter ALIAS --bus PROFILE --duration SECONDS [--write HEX] [--power]
bus-tool release       --adapter ALIAS
bus-tool report        --run DIR [--run DIR ...] [--title TEXT]
```

Every operation except devices and capabilities takes `--run-id ID` (1-64 of `[A-Za-z0-9._-]`, letter or digit at
both ends) and `--results-dir DIR` (default `arduino-iot-results`, inside the working directory, never `.vera`).
`HEX` is an even number of hex digits without prefix or separators; `transfer` needs `--write` or `--read` (`--read`
0 to 512). `--duration` is 1 to 60. The registry is the file `$BUS_REGISTRY` (VERA sets
`<workbench>/lab/resources.json`). `--bus` is a regular file inside the working directory (64 KiB at most); VERA's
approval binds it by hash. Abbreviated options are refused.

## 3 Registry entry (kind `bus-adapter`)

```json
{ "alias": "bp", "kind": "bus-adapter", "backend": "bus-pirate-bpio2", "resource": "COM35", "terminal": "COM34",
  "identity": "usb:1209:7331:bp5x0001", "power": { "maxMv": 3300, "maxMa": 100 }, "note": "bench Bus Pirate 5" }
```

`resource` is the binary (BPIO2) port and `terminal` the other port of the same adapter, each `COM<n>` or a `/dev/`
path, never the same port. `identity` is the key the devices operation lists, `usb:<vid 4 hex>:<pid 4 hex>:<serial>`.
`power` is optional; without it the adapter's supply is never switched on. Entries of other kinds are ignored by
bus-tool; an alias of another kind is `adapter-unknown`.

## 4 Bus profile (format 1, kind `bus-tools-profile`)

```json
{
  "format": 1, "kind": "bus-tools-profile", "name": "bme280-bench",
  "wiring": { "commonGround": true, "logicMv": 3300, "note": "SDA IO0, SCL IO1, sensor powered by the board" },
  "power": { "source": "external" },
  "bus": { "mode": "i2c", "speedHz": 100000, "pullups": true, "clockStretch": false },
  "limits": { "maxWriteBytes": 16, "maxReadBytes": 32, "timeoutMs": 1000 },
  "final": "release",
  "devices": [
    { "name": "bme280", "address": "0x76", "rawTransfer": false,
      "registers": [ { "name": "chip_id", "write": "d0", "read": 1, "access": "read", "expect": "60" } ] }
  ]
}
```

- `name` 1-64 printable characters. Unknown keys anywhere are refused (`profile-invalid`).
- `wiring.commonGround` must be `true`; `wiring.logicMv` 1200-5000; optional `note` (256 characters).
- `power`: `{source: "external"}` or `{source: "adapter", mv: 800-5000, ma: 1-500}`.
- `bus` by mode, each with `pullups` (boolean):
  - `i2c`: `speedHz` 1000-1000000, `clockStretch` (boolean, default false).
  - `spi`: `speedHz` 10000-20000000, `cpol` 0|1, `cpha` 0|1, `csIdle` `high`|`low`, `bitOrder` `msb`|`lsb`.
  - `uart`: `baud` 300-1000000, `dataBits` 5-8, `parity` `none`|`even`, `stopBits` 1|2.
- `limits`: `maxWriteBytes` 1-512, `maxReadBytes` 1-512, `timeoutMs` 100-10000.
- `final`: `release` (default) or `keep`.
- `devices`: 1-16, `name` `^[a-z][a-z0-9_-]{0,31}$` unique. `address` (`0x08`-`0x77`, two hex digits) is required for
  i2c and absent otherwise. `rawTransfer` (boolean, default false). `registers` (0-64, not for uart): `name` as a device
  name, unique in the device; `write` 0-4 bytes of hex (I2C: register address; SPI: command bytes); `read` 1-64 and at
  most `maxReadBytes`; `access` `read`|`read-clears`; optional `expect` (exactly `read` bytes of hex) and `note`.
  A device may carry an optional `note` (256 characters).

## 5 BPIO2 on the wire

Each request is a FlatBuffers `RequestPacket{version_major: 2, minimum_version_minor: 0, contents}` COBS-encoded and
followed by one 0x00; each answer is one COBS frame ending at 0x00 holding a `ResponsePacket{error, contents}`. Frames
larger than 64 KiB, frames that do not decode, and `DataResponse` frames with `is_async` true while a reply is awaited
are not replies (async frames are kept only by capture). Field slots follow `bpio.fbs` (BusPirate5-firmware main),
written with every given field explicit:

| Operation | Request |
|---|---|
| status | `StatusRequest` without a query vector (all queries) |
| configure (i2c) | `ConfigurationRequest{mode: "I2C", mode_configuration{speed, clock_stretch}, pullup_enable or pullup_disable, psu}` |
| configure (spi) | `... mode: "SPI", mode_configuration{speed, data_bits 8, clock_polarity, clock_phase, chip_select_idle}, mode_bitorder_msb or _lsb, ...` |
| configure (uart) | `... mode: "UART", mode_configuration{speed = baud, data_bits, parity, stop_bits}, ...` |
| psu | `psu_enable, psu_set_mv, psu_set_ma` with `--power` and adapter power; else `psu_disable` |
| release | `ConfigurationRequest{mode: "HiZ", mode_configuration{}, pullup_disable, psu_disable}` |
| i2c data | `DataRequest{start_main, data_write [address << 1, bytes...], bytes_read, stop_main}` |
| spi data | `DataRequest{start_main (select), data_write, bytes_read, stop_main (deselect)}` |
| uart data | `DataRequest{data_write, bytes_read}` |

Never written: `hardware_bootloader`, `hardware_reset`, `hardware_selftest`, `io_direction_mask`, `io_direction`,
`io_value_mask`, `io_value`, `print_string`, `led_*`. Status and release replies wait 2 s; the bus configuration and
data replies wait the profile's `timeoutMs`. Each request is sent once.

Read-back: after a configuration, a status request must show `mode_current` equal to the mode (letter case ignored),
`pullup_enabled` and `psu_enabled` as requested (`config-mismatch` otherwise). Release is confirmed when the status
shows `HiZ`, pull-ups off and supply off. Byte limits are the smaller of the profile's and the status's
`mode_max_write`/`mode_max_read` of the configured mode.

## 6 Operations

- `devices`: `ports` (address, identity, stable, vid, pid, serialNumber, description, manufacturer, location) and `groups`
  (`{identity, ports}` for ports sharing a stable identity); no port is opened.
- `capabilities`: `backend` (`bus-pirate-bpio2`, hardware majors, protocol major, modes, operations, caps) and, with
  `--bus`, `profile` (name, mode, devices with registers, effective limits); no port is opened.
- Adapter operations first check the registry hash, the alias, the profile and every option, then that both ports are
  listed with the entry's identity, then open the binary port only, send a status request and check the backend
  (section 1). Then:
  - `identify`: `adapter` fields; physical `unchanged`.
  - `configure-bus`: configuration, read-back; the bus stays configured (`final: configured`).
  - `read-register`: configuration, read-back, one data request with the register's bytes and length; `register`
    `{device, name, value, expected, matches}`.
  - `transfer`: configuration, read-back, one data request; `transactions[0]`.
  - `capture` (uart only): configuration, read-back, the `--write` data request if any (bounded by `maxWriteBytes`; no
    device or `rawTransfer` gate, the UART has one peer), then async data for
    `--duration` seconds or until `maxReadBytes`; files `capture.bin` (raw bytes) and `capture.csv`
    (`offsetMs,hex` per received chunk).
  - `release`: release request and read-back.
- After configure-bus fails, and after read-register, transfer and capture whatever their outcome, the profile's final
  state applies: `release` (the release request and read-back) or `keep` (one status read-back). The result's `final`
  is `{declared, state: {mode, pullups, psu}, physical}`, physical `confirmed` or `unknown`.
- Supervision (spec REQ-DATA-f2cbfc23 section 6): `state.json` in `$VERA_RUN_CONTROL` goes start, identified, acting
  (physical `pending`), cleaning, released with the final physical state. The `stop` file is checked before the
  configuration, before every data request and during capture; a stop sends no further data request and applies
  release. `$VERA_RESOURCE_STATE` marking the alias `unknown` refuses every operation but identify and release.
- `report`: `runs` (`{path, runId, operation, status, adapter, device, register, physical, errors}`).

## 7 Result document

`{format: 1, kind: "bus-tool-result", tool: "bus-tool 1.0.0", operation, startedAt, finishedAt, status, errors,
warnings, runId, resultPath, inputs {registry {path, sha256}, profile {path, sha256}}, adapter, bus, configuration,
transactions, register, capture, final, requests, lifecycle}` (`requests`: the wire transcript, `{request, reply, ...}`
per request sent) (fields present when they apply). A transaction is `{index,
device, register, write, readRequested, read, error, durationMs}` with bytes as lower-case hex. Statuses `pass`, `fail`,
`incomplete`, `blocked`, `error`. Exit 0 pass, 1 fail, 2 blocked, 3 incomplete or error. Printed output is cut to
11000 UTF-16 units (long lists first, `omittedFromOutput` says what); the run folder keeps the whole document.

## 8 Problem codes

| Code | Status | When |
|---|---|---|
| arguments, path, run-exists, run-invalid | blocked | invalid call, path or run folder |
| registry, adapter-unknown, registry-changed | blocked | registry missing or invalid, alias absent or of another kind, hash differs |
| profile-invalid, register-unknown, clears-flags, transfer-not-allowed, limit, power-not-allowed, capture-mode | blocked | profile or request refused (limit also after the read-back, before any data request) |
| state-unknown | blocked | VERA reports the alias unknown |
| port-missing, identity-mismatch | blocked | a port is not listed or shows another identity |
| not-bpio2, adapter-unsupported | blocked | no valid BPIO2 status reply; unsupported versions or a packet-level error |
| config-error, config-mismatch | fail | configuration refused or not applied |
| nack | fail | a data error whose text names a NACK (letter case ignored) |
| adapter-error | fail | any other data error text |
| count-mismatch | fail | fewer or more bytes than requested |
| unexpected-value | fail | register bytes differ from `expect` |
| no-response | incomplete | no reply in time |
| stopped | incomplete | VERA asked to stop |
| disconnected | incomplete | the serial port failed |
| internal | error | anything unexpected |

Open: the firmware's exact NACK and UART read texts are not documented; the `nack` rule and async capture are
verified only against the simulated adapter.

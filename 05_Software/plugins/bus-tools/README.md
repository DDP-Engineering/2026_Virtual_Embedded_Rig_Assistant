# bus-tools

Active, bounded I2C, SPI and UART transactions through an identified bus adapter. One program, `bus-tool`, a PEP 723
script pinned to flatbuffers 25.12.19 and pyserial 3.5, which VERA installs with its own uv.

Passive capture and protocol decoding stay with the **sigrok** plugin and a logic analyzer; this plugin only runs
transactions the profile allows.

## Supported adapter

| Backend | Adapter | Protocol | Verified |
|---|---|---|---|
| `bus-pirate-bpio2` | Bus Pirate 5 (REV8, REV10, XL) or 6: StatusResponse hardware major 5 or 6 | BPIO2 (FlatBuffers major 2, COBS framing) on the adapter's second USB serial port | simulated adapter only |

No other Bus Pirate generation (v3/v4 BBIO1) and no other bridge (FT232H, CH341, Aardvark) is supported; each would
be a separate backend. Not yet confirmed on a real adapter: the firmware's NACK error text (bus-tool reports `nack`
when the data error names a NACK), UART receive as asynchronous data, the per-mode byte limits, and whether both serial
ports show one USB serial number. Windows x64 and native Ubuntu x64 are the targets; neither has seen real hardware.

On the adapter, select BPIO2 once with the terminal command `binmode` (choose "BPIO2 flatbuffer interface"; it can be
saved as the default). bus-tool never uses the terminal port and never changes the adapter's firmware or settings.

## Declare the adapter

`lab/resources.json` (the bench registry shared with scpi-instruments):

```json
{ "format": 1, "resources": [
  { "alias": "bp", "kind": "bus-adapter", "backend": "bus-pirate-bpio2", "resource": "COM35", "terminal": "COM34",
    "identity": "usb:1209:7331:BP5X0001", "power": { "maxMv": 3300, "maxMa": 100 } } ] }
```

- `resource` is the binary (BPIO2) port, `terminal` the other port. Both and `identity` come from `bus-tool devices`,
  which groups the ports of one USB device. Which of the two is the binary port is your choice: bus-tool does not
  guess it, and a port that does not answer a BPIO2 status request gets nothing else.
- Every run on `bp` reserves both ports and the USB identity across VERA windows and the CLI, so serial-monitor or a
  second session cannot interleave with it.
- `power` caps the adapter's own supply for this bench. Without it the supply is never switched on.

## Bus profile

A JSON file in the workbench (examples in `profiles/`), bound to the approval by its hash: wiring (`commonGround` must
be true, `logicMv`), supply (`external`, or `adapter` with mV/mA), the bus (`i2c` speed and clock stretching; `spi`
speed, `cpol`, `cpha`, `csIdle`, `bitOrder`; `uart` baud, data bits, parity, stop bits; `pullups`), byte and time
limits, the final state (`release`: HiZ, pull-ups and supply off, the default; or `keep`) and the devices: I2C address,
whether raw transfers are allowed, and named registers (bytes written first, bytes read, `read` or `read-clears`,
optional expected value).

## Operations

| Operation | Risk | What it does |
|---|---|---|
| `devices`, `capabilities [--bus P]`, `report --run D` | safe | ports by identity; backend and profile summary; run summaries |
| `identify --adapter A` | device-read | one BPIO2 status request: hardware, firmware, BPIO version, modes, supply, pull-ups |
| `configure-bus --adapter A --bus P` | device-write | configure and read back; the bus stays configured |
| `read-register ... --device D --register R [--clears]` | device-write | one declared register in one transaction, compared with its expected value |
| `transfer ... --device D [--write HEX] [--read N]` | device-write | one bounded transaction to a device with `rawTransfer: true` |
| `capture ... --duration S [--write HEX]` | device-write | UART only: record what arrives for at most 60 s |
| `release --adapter A` | device-write | HiZ, pull-ups and supply off, read back; VERA's cleanup after Stop, timeout or a crash |
| any call with `--power` | irreversible | switches the adapter's supply on for a profile with `power.source: adapter` |

Nothing is repeated: a NACK (`nack`), a missing reply (`no-response`), a wrong byte count (`count-mismatch`) or a
register value that differs from the profile (`unexpected-value`, often a wrong SPI mode) ends the run after the single
attempt, then the final state is applied and read back (`physical: confirmed` or `unknown`). Results go to
`arduino-iot-results/<run-id>/` (result.json, report.md, capture.bin and capture.csv). Exit codes: 0 pass, 1 fail,
2 blocked before any bus effect, 3 incomplete or error.

## Tests

`tests/plugins/bus-tools.test.ts` runs the helper against a simulated Bus Pirate (a fake pyserial in
`tests/fixtures/bus-tools/fake-serial`, which needs the toolchain Python to have flatbuffers 25.12.19). It is offline
evidence only. With a real adapter set `VERA_TEST_BUS_PIRATE_PORT`, `VERA_TEST_BUS_PIRATE_TERMINAL` and
`VERA_TEST_BUS_PIRATE_IDENTITY` to run the read-only identify against it.

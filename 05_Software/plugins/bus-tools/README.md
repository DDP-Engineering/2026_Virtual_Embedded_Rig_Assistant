# bus-tools

I2C, SPI and UART transactions through an identified bus adapter. One program, `bus-tool`, a PEP 723 script pinned to
flatbuffers 25.12.19 and pyserial 3.5, which VERA installs with its own uv.

Passive capture and protocol decoding stay with the **sigrok** plugin and a logic analyzer.

## Supported adapter

| Backend | Adapter | Protocol | Verified |
|---|---|---|---|
| `bus-pirate-bpio2` | Bus Pirate 5 (REV8, REV10, XL) or 6: StatusResponse hardware major 5 or 6 | BPIO2 (FlatBuffers major 2, COBS framing) on the adapter's second USB serial port | simulated adapter only |

No other Bus Pirate generation (v3/v4 BBIO1) and no other bridge (FT232H, CH341, Aardvark) is supported; each would
be a separate backend. Windows x64 and native Ubuntu x64 are the targets; neither has seen real hardware.

What was checked without an adapter: every field number bus-tool writes and reads against `bpio.fbs` of the firmware
(main), and the behaviour below against the firmware source (`src/binmode/bpio*.c`). None of it has been confirmed
on a real adapter:

- the firmware answers every failed transaction with one text, "Protocol request failed"; on I2C bus-tool reports
  it as `nack`;
- a UART passes received bytes on by itself as asynchronous data (protocol minor 2), which `capture` and a UART
  `transfer` rely on; an older firmware delivers nothing;
- a status holds a voltage for IO0 to IO7 and a label for each header pin, the supply pin first and ground last;
- whether both serial ports show one USB serial number.

On the adapter, select BPIO2 once with the terminal command `binmode` (choose "BPIO2 flatbuffer interface"; it can be
saved as the default). bus-tool never uses the terminal port and never changes the adapter's firmware or settings.

## Declare the adapter

`lab/resources.json` (the bench registry shared with scpi-instruments):

```json
{ "format": 1, "resources": [
  { "alias": "bp", "kind": "bus-adapter", "backend": "bus-pirate-bpio2", "resource": "COM35", "terminal": "COM34",
    "identity": "usb:1209:7331:BP5X0001" } ] }
```

- `resource` is the binary (BPIO2) port, `terminal` the other port. Both and `identity` come from `bus-tool devices`,
  which groups the ports of one USB device. Which of the two is the binary port is your choice: a port that does not
  answer a BPIO2 status request gets nothing else.
- Every run on `bp` reserves both ports and the USB identity across VERA windows and the CLI, so serial-monitor or a
  second session cannot interleave with it.
- `"power": { "maxMv": 3300, "maxMa": 100 }` is optional and caps the adapter's own supply for this bench.

## The bus: a profile or the call's options

A call describes its bus in one of two ways.

- **Options**: `--mode i2c|spi|uart`, `--address 0xNN` (an I2C device; alone it means I2C), `--speed` (Hz, or baud),
  `--spi-mode 0`-`3`, `--pullups on|off`. Defaults: I2C 100 kHz with the adapter's pull-ups on; SPI 1 MHz, mode 0,
  chip select idle high, MSB first; UART 115200 8N1.
- **A profile**: a JSON file in the workbench (examples in `profiles/`) that keeps the same settings and adds devices
  with named registers (bytes written first, bytes read, `read-clears`, an expected value), the supply, the final
  state and limits. Only `bus.mode` is required; `bus-tool capabilities --bus FILE` shows it with every default.

## Operations

| Operation | Risk | What it does |
|---|---|---|
| `devices`, `capabilities [--bus P]`, `report --run D` | safe | ports by identity; backend and profile summary; run summaries |
| `identify --adapter A` | device-read | one BPIO2 status request: hardware, firmware, BPIO version, modes |
| `pins --adapter A` | device-read | the same request: the voltage on IO0 to IO7 with each pin's label, supply, pull-ups; no run folder |
| `scan --adapter A [--from 0xNN --to 0xNN]` | device-write | the I2C addresses that acknowledge an empty write |
| `configure-bus ...` | device-write | configure and read back; the bus stays configured |
| `read-register --bus P [--device D] [--register R]... [--clears]` | device-write | declared registers, each in one transaction, compared with their expected values |
| `write-register --bus P [--device D] --register R --value HEX` | device-write | the register's bytes followed by the value |
| `transfer ... [--write HEX] [--read N]` | device-write | one transaction |
| `sequence ... --step S [--step S]...` | device-write | up to 32 steps on one configured bus: `read REG`, `write REG HEX`, `transfer HEX\|- [N]`, `delay MS` |
| `capture ... --duration S [--write HEX]` | device-write | UART only: record what arrives for at most 300 s and 1 MiB |
| `release --adapter A` | device-write | HiZ, pull-ups and supply off, read back; VERA's cleanup after Stop, timeout or a crash |

Every bus operation takes `--supply MV` (with `--supply-ma`, default 100) to power the circuit from the adapter and
`--keep` to leave the bus configured. A profile does the same with `power.source: adapter` and `"final": "keep"`.
Without them the adapter's supply is requested off and the call ends in HiZ with pull-ups off, read back
(`final.physical: confirmed` or `unknown`).

A step is sent once: a device that does not acknowledge (`nack`, with the bus lines that read low), a missing reply
(`no-response`), a wrong byte count (`count-mismatch`) or a register value that differs from the profile
(`unexpected-value`, often a wrong SPI mode) ends the run there, then the final state is applied. On a UART the
answer is taken as it arrives: fewer bytes than asked pass with the warning `short-read`, none is `no-response`.

Results go to `arduino-iot-results/<run-id>/` (result.json, report.md, and for a capture capture.txt, capture.bin
and capture.csv). Exit codes: 0 pass, 1 fail, 2 blocked before any bus effect, 3 incomplete or error.

## Tests

`tests/plugins/bus-tools.test.ts` runs the helper against a simulated Bus Pirate (a fake pyserial in
`tests/fixtures/bus-tools/fake-serial`, which needs the toolchain Python to have flatbuffers 25.12.19). It is offline
evidence only. With a real adapter set `VERA_TEST_BUS_PIRATE_PORT`, `VERA_TEST_BUS_PIRATE_TERMINAL` and
`VERA_TEST_BUS_PIRATE_IDENTITY` to run the read-only identify against it.

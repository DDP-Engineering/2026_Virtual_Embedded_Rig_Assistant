---
name: bus-profiles
description: How to write the lab/resources.json entry of a Bus Pirate and a bus-tool profile - bus settings, supply, limits, final state, devices and named registers. Use when a task needs a new or changed bus profile or adapter entry for the bus-tools plugin.
---
# bus-profiles

## Adapter entry (lab/resources.json)

```json
{ "alias": "bp", "kind": "bus-adapter", "backend": "bus-pirate-bpio2", "resource": "COM35", "terminal": "COM34",
  "identity": "usb:1209:7331:BP5X0001" }
```

`resource` is the binary port and `terminal` the other port of the same adapter, both with the identity
`bus-tool devices` shows. On Linux name the ports by `/dev/serial/by-id/...`, which stays the same when the adapter
is plugged in again. `"power": { "maxMv": 3300, "maxMa": 100 }` is optional: a cap for the adapter's own supply on
this bench.

## Profile

A profile is worth writing when a device is used more than once: it gives registers names and keeps the settings.
Only `bus.mode` is required:

```json
{ "bus": { "mode": "i2c" },
  "devices": [ { "name": "bme280", "address": "0x76", "registers": [
    { "name": "chip_id", "write": "d0", "expect": "60" },
    { "name": "ctrl_meas", "write": "f4" },
    { "name": "press", "write": "f7", "read": 8 } ] } ] }
```

- `bus`: from the device's datasheet. I2C `speedHz` (default 100000, 1 kHz-1 MHz), `pullups` (default true: I2C
  needs pull-ups somewhere), `clockStretch`. SPI `speedHz` (default 1 MHz), `cpol`/`cpha` (mode 0 = 0/0, mode 3 =
  1/1), `csIdle`, `bitOrder`. UART `baud` (default 115200), `dataBits`, `parity` (`none` or `even`), `stopBits`.
- `devices` (at most 16): I2C 7-bit `address` as `"0x76"` (0x08-0x77). A register: `write` is what is sent first
  (I2C register address, SPI command), `read` the bytes read (default 1; 0 for a command that is only written),
  `access` `read-clears` for status or FIFO registers that clear when read, optional `expect` (a chip id) that a
  read is compared with.
- `power`: leave it out when the circuit has its own supply. `{"source": "adapter", "mv": 3300, "ma": 50}` powers
  the circuit from the adapter on every call with this profile.
- `final`: `release` (default; HiZ, pull-ups and supply off after every call) or `keep` (the bus stays configured,
  for example to keep a sensor powered between calls).
- `limits`: `maxWriteBytes` and `maxReadBytes` per transaction (default and most 512) and `timeoutMs` for a reply
  (default 2000, at most 10000).
- `name`, `wiring.logicMv` and `note` fields describe the bench for the reader; the adapter is not set by them.
- Examples ship in `profiles/` of the plugin (bme280-i2c, w25q-spi, uart-console). `bus-tool capabilities --bus
  <file>` checks a profile and shows it with every default filled in. An unknown field is refused, which catches
  typing mistakes.

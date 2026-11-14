---
name: bus-profiles
description: How to write the lab/resources.json entry of a Bus Pirate and a bus-tool profile - wiring, logic voltage, supply, bus settings, limits, final state, devices and registers. Use when a task needs a new or changed bus profile or adapter entry for the bus-tools plugin.
---
# bus-profiles

## Adapter entry (lab/resources.json)

```json
{ "alias": "bp", "kind": "bus-adapter", "backend": "bus-pirate-bpio2", "resource": "COM35", "terminal": "COM34",
  "identity": "usb:1209:7331:BP5X0001", "power": { "maxMv": 3300, "maxMa": 100 } }
```

`resource` is the binary port and `terminal` the other port of the same adapter, both with the identity
`bus-tool devices` shows. `power` is the bench's cap for the adapter's own supply; leave it out unless the user wants
the adapter to power circuits.

## Profile

Start from `profiles/` of the plugin (bme280-i2c, w25q-spi, uart-console) and copy it into the workbench.

- Ask the user for the wiring and write it in `wiring.note`. `commonGround: true` is required: without a shared ground
  no transaction is valid. `logicMv` is the circuit's I/O voltage (1200-5000).
- `power`: `{"source": "external"}` when the circuit has its own supply (the adapter's supply is switched off), or
  `{"source": "adapter", "mv": 3300, "ma": 50}` - then every call needs `--power`.
- `bus`: from the device's datasheet. I2C `speedHz` 1 kHz-1 MHz; SPI `cpol`/`cpha` (mode 0 = 0/0, mode 3 = 1/1),
  `csIdle`, `bitOrder`; UART `baud`, `dataBits`, `parity` (`none` or `even`), `stopBits`. `pullups` enables the
  adapter's pull-up resistors (I2C needs pull-ups somewhere).
- `limits`: bytes written and read per transaction (at most 512) and the reply timeout (at most 10 s).
- `final`: `release` (default; HiZ, pull-ups and supply off after every operation) or `keep` (the bus stays configured,
  e.g. to keep a sensor powered).
- `devices`: I2C 7-bit `address` as `"0x76"` (0x08-0x77). Registers: `write` is what is sent first (I2C register
  address, SPI command), `read` the bytes read, `access` `read` or `read-clears` (status or FIFO registers that clear
  when read - check the datasheet), optional `expect` (a chip id). Set `rawTransfer: true` only for devices where the
  user wants arbitrary bytes sent, such as an EEPROM or a UART console; it allows writes.
- There is no scan: name each device's address from its datasheet or the board's schematic.

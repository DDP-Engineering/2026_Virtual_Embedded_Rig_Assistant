---
name: bus-transactions
description: How to run I2C, SPI and UART transactions on a circuit through a Bus Pirate with bus-tool - identify the adapter, read a declared register, run one bounded transfer, record a UART and read the final state. Use whenever a task talks to a sensor, memory or peripheral over I2C, SPI or UART through a bus adapter.
---
# bus-transactions

Every bus operation drives the adapter's pins onto the circuit. Even a register read first writes the register
address and may clear flags on the device; say so before you run one.

## Before the first transaction

1. `bus-tool devices`: the serial ports with identity keys; a Bus Pirate shows two ports in one group. The user picks
   which is the binary (BPIO2) port and declares the adapter in `lab/resources.json` (kind `bus-adapter`, see the
   bus-profiles skill). Never guess the port.
2. `bus-tool identify --adapter bp`: hardware, firmware and BPIO version. `not-bpio2` means the port is the terminal
   port or BPIO2 is not selected on the adapter: ask the user to run `binmode` on the adapter's terminal and choose
   the BPIO2 flatbuffer interface. `adapter-unsupported` means this is not a Bus Pirate 5 or 6 with BPIO 2; stop.
3. Write or reuse a bus profile (bus-profiles skill). The approval binds it by hash.

## Transactions

- `bus-tool read-register --adapter bp --bus bench/bme280.json --device bme280 --register chip_id`: one transaction
  with the register's declared bytes; `register.matches` compares with the expected value. Registers declared
  `read-clears` need `--clears`.
- `bus-tool transfer --adapter bp --bus ... --device eeprom --write 0010 --read 16`: only for devices the profile marks
  `rawTransfer: true`; the bytes are bounded by the profile's limits. On I2C the address byte is added for you.
- `bus-tool capture --adapter bp --bus uart.json --duration 10 [--write 0d]`: UART only, at most 60 s; capture.bin and
  capture.csv in the run folder. For passive I2C or SPI capture and decoding use the sigrok plugin.
- `bus-tool configure-bus` leaves the bus configured (pull-ups, supply); `bus-tool release --adapter bp` returns it to
  HiZ with pull-ups and supply off.
- `--power` switches the adapter's supply on, only for a profile with `power.source: adapter` within the registry's
  limits: it powers the circuit. Ask the user first.

## Reading the result

- Nothing is retried. `nack`: no device acknowledged the address - check address, wiring, pull-ups and the device's
  supply. `no-response`: the adapter did not answer in time. `count-mismatch`: fewer or more bytes than requested.
  `unexpected-value`: the bytes differ from the profile's expected value - on SPI usually a wrong `cpol`/`cpha` or bit
  order, else wiring or logic voltage. Change one thing, then run again; never loop.
- `final.physical` is `confirmed` when the read-back shows the declared final state, `unknown` otherwise. After
  `unknown`, VERA refuses bus operations on the adapter (`state-unknown`) until `release` confirms it.
- Two runs never share the adapter: a second one (another session, the CLI, serial-monitor on either port) is BUSY.
- `bus-tool report --run <folder> ...` summarizes runs.

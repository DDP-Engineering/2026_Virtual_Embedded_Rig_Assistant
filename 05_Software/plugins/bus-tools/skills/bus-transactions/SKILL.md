---
name: bus-transactions
description: How to talk to a circuit over I2C, SPI and UART through a Bus Pirate with bus-tool - identify the adapter, check the pin voltages, scan an I2C bus, read and write registers, run transfers and sequences of steps, record a UART and read the result. Use whenever a task talks to a sensor, memory or peripheral over I2C, SPI or UART through a bus adapter.
---
# bus-transactions

Every bus operation drives the adapter's pins onto the circuit. A register read first writes the register address
and may clear flags on the device.

## Before the first transaction

1. `bus-tool devices`: the serial ports with identity keys; a Bus Pirate shows two ports in one group. The user picks
   which is the binary (BPIO2) port and declares the adapter in `lab/resources.json` (kind `bus-adapter`, see the
   bus-profiles skill).
2. `bus-tool identify --adapter bp`: hardware, firmware and BPIO version. `not-bpio2` means the port is the terminal
   port or BPIO2 is not selected on the adapter: ask the user to run `binmode` on the adapter's terminal and choose
   the BPIO2 flatbuffer interface. `adapter-unsupported` means this is not a Bus Pirate 5 or 6 with BPIO 2; stop.

## First contact, without a profile

- `bus-tool scan --adapter bp`: the I2C addresses that acknowledge (0x08 to 0x77, `--from`/`--to` narrow it), at
  100 kHz with the adapter's pull-ups on. `no-device` names the lines that read low.
- `bus-tool pins --adapter bp`: the voltage on IO0 to IO7 with the label the current mode gives each pin, the supply
  and the pull-ups. One status request, nothing changes: use it to check the wiring before or after a failure.
- `bus-tool transfer --adapter bp --address 0x76 --write d0 --read 1`: one I2C transaction; the address byte is added.
- `bus-tool transfer --adapter bp --mode spi --write 9f --read 3`: SPI at 1 MHz, mode 0 (`--spi-mode 0`-`3`,
  `--speed HZ`). The bytes are written first, then the answer is read.
- `bus-tool transfer --adapter bp --mode uart --speed 115200 --write 0d --read 64`: writes, then takes what arrives
  until 64 bytes came, the line fell silent or the timeout passed; `text` holds it as text.
- Options of a bus without a profile: `--mode i2c|spi|uart`, `--address 0xNN`, `--speed`, `--spi-mode`,
  `--pullups on|off`. They are not combined with `--bus`.

## With a profile

A profile (bus-profiles skill) names devices and registers and keeps the bus settings in one file.

- `bus-tool read-register --adapter bp --bus bench/bme280.json --register chip_id --register status`: each register
  in one transaction, compared with its `expect`. Without `--register` every register of the device is read, except
  those declared `read-clears`, which are named with `--clears`. `--device` is needed only when the profile
  declares several.
- `bus-tool write-register --adapter bp --bus ... --register ctrl_meas --value 25`: the register's bytes, then the value.
- `bus-tool sequence --adapter bp --bus ... --step "write ctrl_meas 25" --step "delay 10" --step "read press"`:
  up to 32 steps on one configured bus, so a device keeps its state and its supply between them. Steps:
  `read [device.]register`, `write [device.]register HEX`, `transfer HEX|- [N]` (to `--device`, or the only one) and
  `delay MS` (at most 10 s each). The first step that fails ends the sequence. Works without a profile too:
  `--address 0x76 --step "transfer f425" --step "delay 10" --step "transfer f7 8"`.
- `bus-tool capture --adapter bp --mode uart --speed 115200 --duration 10 [--write 0d]`: records a UART for up to
  300 s and 1 MiB; the result shows the text, `capture.txt`, `capture.bin` and `capture.csv` (with times) are in the
  run folder. For passive I2C or SPI capture and decoding use the sigrok plugin.

## Supply and final state

- After each call the adapter goes back to HiZ with pull-ups and supply off (`final.physical: confirmed`). `--keep`
  or a profile with `"final": "keep"` leaves the bus configured; `bus-tool release --adapter bp` ends that.
- `--supply 3300` (mV, `--supply-ma` limits the current, default 100) or a profile with `power.source: adapter`
  powers the circuit from the adapter for the call; tell the user the voltage first. `power-not-allowed`: above the
  limits `lab/resources.json` declares for the adapter.
- A device powered by the adapter loses its state when the supply goes off: use `sequence` or `--keep`.

## Reading the result

- A step is sent once. `nack`: the device did not acknowledge - the message names the address and any bus line that
  reads low; check address, wiring, pull-ups and supply, and `scan`. `no-response`: the adapter, or on a UART the
  circuit, did not answer in time. `count-mismatch`: fewer or more bytes than requested. `unexpected-value`: the
  bytes differ from the profile's expected value - on SPI usually a wrong `cpol`/`cpha` or bit order, else wiring or
  logic voltage. `idle-pattern`: only 0x00 or 0xff came back. Change one thing, then run again.
- Two runs never share the adapter: a second one (another session, the CLI, serial-monitor on either port) is BUSY.
- `bus-tool report --run <folder> ...` summarizes runs.

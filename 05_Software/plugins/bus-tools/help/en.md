# Bus tools (I2C, SPI, UART)

Bus tools lets the agent run bounded I2C, SPI and UART transactions on your circuit through a Bus Pirate 5 or 6 in its BPIO2 binary mode. It identifies the adapter, configures a bus from a profile, reads one declared register, runs one bounded transfer or records a UART, then leaves a declared final state and reads it back: by default HiZ with pull-ups and supply off. Passive capture and decoding stay with the sigrok plugin. Results go to `arduino-iot-results/<run-id>/` in the workbench.

## What it needs

- **bus-tool**: a script installed by **Install dependencies** on the plugin page.
- A Bus Pirate 5 or 6, switched once to BPIO2 with its terminal command `binmode`.
- `lab/resources.json` in the workbench (parameter `lab-resources`): a `bus-adapter` entry with the alias, both serial ports (you choose which is the binary one), the USB identity and optional power limits. The plugin page's **Configuration** section shows whether the file is valid.
- A bus profile in the workbench: wiring, logic voltage, supply, bus settings, limits, final state, devices and registers. Examples ship with the plugin (BME280, W25Q flash, UART console).

## How to use it

- "Identify the Bus Pirate bp." (skill `bus-transactions`)
- "Write a bus profile for the BME280 at address 0x76, 3.3 V logic, external supply." (skill `bus-profiles`)
- "Read the chip_id register of the BME280 and check it against the expected value."
- "Read 16 bytes from the EEPROM starting at 0x0010."
- "Record the UART console for 10 seconds after sending a carriage return."

Nothing is retried: a NACK, missing reply or unexpected value ends the run. There is no address scan; addresses come from the datasheet or schematic.

## Risk and approvals

- Safe, runs without asking: listing serial ports, describing a profile and run reports.
- Device-read: identifying the adapter (one status request; pins, pull-ups and supply are not changed).
- Device-write: configuring the bus, register reads (which write the register address first and may clear flags), transfers, UART capture and release, because each drives the adapter's pins onto your circuit.
- Irreversible: any call with `--power`, which switches the adapter's supply on and powers the circuit wired to it. VERA asks you to type the confirmation word, except in Bypass.

In Ask and Auto-edit modes VERA asks before every device-write command.

## Limits

- Windows x64 and Linux x64. Verified only against a simulated adapter; no real hardware yet.
- No terminal access and no firmware or settings change on the adapter. Other adapters (Bus Pirate v3/v4, FT232H, CH341, Aardvark) are not supported.
- After an unconfirmed final state, VERA refuses bus operations until a release confirms it.
- Reference: https://docs.buspirate.com/docs/binmode-reference/protocol-bpio2/

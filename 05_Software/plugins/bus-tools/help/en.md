# Bus tools (I2C, SPI, UART)

Bus tools lets the agent talk to your circuit over I2C, SPI and UART through a Bus Pirate 5 or 6 in its BPIO2 binary mode. It identifies the adapter, reads the voltage on its pins, scans an I2C bus for the addresses that answer, reads and writes registers, runs transfers and sequences of steps with pauses, and records a UART as text. After each call the adapter returns to HiZ with pull-ups and supply off, unless you ask it to keep the bus. Passive capture and decoding stay with the sigrok plugin. Results go to `arduino-iot-results/<run-id>/` in the workbench.

## What it needs

- **bus-tool**: a script installed by **Install dependencies** on the plugin page.
- A Bus Pirate 5 or 6, switched once to BPIO2 with its terminal command `binmode`.
- `lab/resources.json` in the workbench (parameter `lab-resources`): a `bus-adapter` entry with the alias, both serial ports (you choose which is the binary one) and the USB identity; power limits are optional. The plugin page's **Configuration** section shows whether the file is valid.
- Nothing more for a first contact: the agent scans and talks to a device with the usual settings. A bus profile in the workbench is optional; it gives devices and registers names and keeps the settings. Examples ship with the plugin (BME280, W25Q flash, UART console).

## How to use it

- "Identify the Bus Pirate bp." (skill `bus-transactions`)
- "Scan the I2C bus and tell me which devices answer."
- "Nothing answers: check the voltages on the adapter's pins."
- "Read register 0xD0 of the device at address 0x76."
- "Write a bus profile for the BME280 at address 0x76." (skill `bus-profiles`)
- "Start a forced measurement on the BME280, wait 10 ms and read the result."
- "Record the UART console for 10 seconds after sending a carriage return."

Each step is sent once: a device that does not acknowledge, a missing reply or an unexpected value ends the run, and the result names the bus lines that read low.

## Risk and approvals

- Safe, runs without asking: listing serial ports, describing a profile and run reports.
- Device-read: identifying the adapter and reading its pin voltages (one status request; pins, pull-ups and supply are not changed).
- Device-write: the scan, configuring the bus, register reads (which write the register address first and may clear flags), register writes, transfers, sequences, UART capture and release, because each drives the adapter's pins onto your circuit. Such a call also switches the adapter's supply on to power the circuit when you or the profile ask for it.

In Ask and Auto-edit modes VERA asks before every device-write command.

## Limits

- Windows x64 and Linux x64. Verified only against a simulated adapter; no real hardware yet.
- No terminal access and no firmware or settings change on the adapter. Other adapters (Bus Pirate v3/v4, FT232H, CH341, Aardvark) are not supported.
- One transaction carries at most 512 bytes each way; a UART capture runs for at most 300 s and keeps 1 MiB.
- Reference: https://docs.buspirate.com/docs/binmode-reference/protocol-bpio2/

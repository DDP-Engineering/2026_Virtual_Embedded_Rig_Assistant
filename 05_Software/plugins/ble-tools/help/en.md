# BLE tools (discovery and GATT)

BLE tools lets the agent scan for Bluetooth Low Energy devices for a bounded time and run controlled GATT operations on devices you have declared: confirm a device's identity against its profile, list its services, read declared characteristics, record notifications and send one named write. A device is identified by its address, never by its name or signal strength. Results go to `arduino-iot-results/<run-id>/` in the workbench.

## What it needs

- **ble-tool**: a script pinned to Bleak 3.1.0, installed automatically by **Install dependencies** on the plugin page.
- A Bluetooth adapter on this computer, switched on: Windows 11 or Linux with BlueZ 5.55 or newer.
- `lab/resources.json` in the workbench (parameter `lab-resources`): one `ble-device` entry per device with its alias, address, profile and optionally its serial. The plugin page's **Configuration** section shows whether the file is valid.
- A device profile: a JSON file declaring the device's services, characteristics, payloads, units, limits, allowed operations and named writes. An example ships with the plugin.
- Pairing, when needed, is your step in the operating system's Bluetooth settings.

## How to use it

- "Scan for BLE devices for 10 seconds." (skill `ble-devices`)
- "Write a profile and a lab/resources.json entry for the thermometer at C4:7F:51:00:12:34." (skill `ble-profiles`)
- "Identify the device thermo against ble/thermo.json."
- "Record temperature notifications from thermo for 30 seconds."
- "Set the fan level of the fan device to 40."

The agent asks you which address is the device; it never picks one from a name. A failed connect, read or write is not retried.

## Risk and approvals

- Safe, runs without asking: checking a profile offline and run reports.
- Device-read: scanning, identifying, listing services, and reading or subscribing to characteristics without side effects.
- Device-write: reading or subscribing to a characteristic the profile marks as state-changing, sending a configure or actuate write (it can change a setting or move, switch or drive hardware, and Stop does not undo it), and releasing a connection.
- Irreversible: a persistent write that the device stores and keeps after a reset. VERA asks you to type the confirmation word, except in Bypass.

In Ask mode VERA asks before each device-read and device-write command; Auto-edit runs device-read commands without asking.

## Limits

- Windows x64 and Linux x64; Windows 10 is not supported. On Linux a scan must be active (`--active`), and a write with response is limited to 20 bytes.
- No pairing, PIN entry, raw write, firmware update, advertising, Bluetooth Classic or Bluetooth setting change.
- Only a simulated backend and a real passive scan on Windows 11 are verified; real-device operations and Linux are not yet proven.
- Reference: https://bleak.readthedocs.io/en/latest/

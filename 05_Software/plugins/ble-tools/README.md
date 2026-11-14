# ble-tools

Bounded Bluetooth Low Energy discovery and controlled GATT operations on devices you declare. One program,
`ble-tool`, a PEP 723 script pinned to Bleak 3.1.0 (and its WinRT or D-Bus dependencies), which VERA installs with
its own uv.

The helper uses only the BLE central role. There is no pairing, PIN entry, unpairing, raw write, firmware update
(DFU), advertising, Bluetooth Classic or change of the adapter or the operating system's Bluetooth settings. It has
been verified against a simulated Bleak and with a real passive scan on Windows 11; it has not read from, subscribed
to or written to a real device yet, and it has not run on Linux.

## Platforms

- Windows 11 (build 22000 or newer) through WinRT; Bleak 3.1.0 does not support Windows 10.
- Linux with BlueZ 5.55 or newer through D-Bus. Passive scanning there needs BlueZ advertisement monitors and
  bluetoothd's experimental mode, a global setting ble-tool never changes, so `scan` needs `--active` on Linux.

## Declaring a device

A device is an entry of `lab/resources.json` (kind `ble-device`), reserved by VERA for the run so another session or
the CLI gets BUSY:

```json
{ "format": 1, "resources": [
  { "alias": "thermo", "kind": "ble-device", "address": "C4:7F:51:00:12:34", "addressType": "public",
    "profile": "bench-thermometer", "serial": "TH-0042" } ] }
```

- `address`: the device's identity address. A `random` address must be static; resolvable private addresses change,
  so pair such a device in the operating system first and declare the address it reports there.
- `profile`: the id of the profile this unit follows; a call's `--profile` file must carry the same id.
- `serial` (optional): the value of the profile's identity characteristic for this unit, so two devices of the same
  model are never confused. `adapter` (optional, Linux): `hci0`...`hci99`.

## Device profile

A JSON file in the workbench (example in `profiles/bench-thermometer.json`), bound to the approval by its hash. It
declares services and characteristics by UUID with the GATT properties they must have, the operations allowed on
each (`read`, `notify`, `write`), `sideEffects` (`none` or `changes-state`, decided by the author: a standard UUID or a
read property never proves a read is harmless), the payload (`int`/`uint`/`float` with size and byte order, scale,
offset, unit and limits, or `utf8`/`bytes` with lengths), named write operations with a class (`configure`, `actuate`,
`persistent`) and either fixed data or a typed value, at most one identity characteristic, whether the device needs
pairing, advertisement hints and limits (timeouts, notifications per second, count and bytes). Units come from a
closed list; an unknown unit is refused.

## Operations

| Operation | What it does | Risk |
|---|---|---|
| `capabilities [--profile]` | backend, platform support and a profile's summary, offline | safe |
| `scan --duration S [--max-devices N] [--active] [--profile]` | advertisers by address, names that several addresses use marked ambiguous, registry and profile matches as candidates | device-read |
| `identify` | finds the declared address, connects with pairing off, checks the GATT database and the identity value | device-read |
| `discover-services` | lists services, characteristics and descriptors, no value read | device-read |
| `read-characteristic --characteristic C [--count N --interval S]` | raw bytes, time and decoded value of each read | device-read (`--side-effects`: device-write) |
| `subscribe-notifications --characteristic C --duration S [--max-notifications N]` | every notification raw and decoded into `notifications.jsonl` and `series.csv` | device-read (`--side-effects`: device-write) |
| `write-characteristic --characteristic C --write W [--value V]` | one named write, sent once, delivery and read-back recorded | device-write (`--persistent`: irreversible) |
| `release --device D` | ends a connection the system still holds; VERA's cleanup | device-write |
| `report --run DIR...` | summary of run folders | safe |

Every device call except `release` finds and connects to the declared address within the profile's connect timeout
and confirms the device before it reads or writes anything. Results go to `arduino-iot-results/<run-id>/`
(`result.json`, `report.md`, plus the notification files). Nothing is retried: a failed connect, read or write ends
the run after its single attempt, and a lost connection is reported `disconnected`, never re-opened. On Linux Bleak
reports the BlueZ MTU as 23, so a write with response is limited to 20 bytes there.

## Pairing

When a characteristic needs pairing or encryption, the device answers with an authentication or encryption error and
the run ends `pairing-required`. Pair the device yourself in the operating system's Bluetooth settings (it may show
or ask for a PIN there) and run again. ble-tool never pairs, unpairs or enters a PIN.

## Stop and cleanup

Stop ends the run at the next safe point: notifications are turned off, the connection closed and the run reported
incomplete. The lifecycle's physical state describes the connection VERA manages (closed and every notification it
enabled turned off), not what a write made the device do: a write is never undone, and its result says `effect:
unknown` unless a read-back matched. After a write run ends without that confirmation, VERA runs `release`.

## Tests

`tests/integration/ble-tools.test.ts` runs the helper against a fake Bleak (`tests/fixtures/ble-tools/fake-bleak`) and
through VERA's ProgramRunner with a lease folder. `VERA_TEST_BLE_PYTHON` names a Python with the pinned Bleak for one
real passive scan; no test connects to a real device.

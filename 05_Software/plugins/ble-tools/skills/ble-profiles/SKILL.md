---
name: ble-profiles
description: How to declare a BLE device in lab/resources.json and write a ble-tools device profile - services and characteristics by UUID, properties, allowed operations, side effects, payload types, byte order, units, limits, named classified writes, identity and pairing. Use before the first ble-tool call on a new device or model.
---
# ble-profiles

## Registry entry

`lab/resources.json`, kind `ble-device`: `alias`, `address` (six hex octets), `addressType` (`public`, or `random`
only for a static random address - private addresses change), `profile` (the profile's `id`), optional `serial` (the
identity characteristic's value for this unit), `adapter` (Linux `hci0`...`hci99`) and `note`. The user confirms the
address; take it from the device's label, its documentation or a scan the user checked, never from a name alone.

## Profile file

`{format: 1, kind: "ble-tools-profile", id, name, pairing, advertisement?, limits, services}`; unknown fields are refused.

- `pairing`: `none` or `required` (the user pairs in the operating system; ble-tool never pairs).
- `limits`: `connectTimeoutS` and `operationTimeoutS` (1-60), `maxNotificationsPerSecond` (1-500),
  `maxNotifications` (1-100000), `maxBytes`.
- Each service: `uuid` (16-bit `181a`, 32-bit or 128-bit) and `characteristics`. Each characteristic: `name`, `uuid`,
  `properties` it must have (`read`, `write`, `write-without-response`, `notify`, `indicate`), `operations` allowed
  (`read`, `notify`, `write`, each backed by a property) and `sideEffects`.
- `sideEffects`: `none` or `changes-state`. Decide it from the device's documentation. A standard UUID or a read
  property does not prove a read is harmless: read-to-clear registers, counters that reset and streams that power a
  sensor are `changes-state`, which then needs `--side-effects` on the call.
- `payload`: `int`/`uint` (size 1, 2, 4, 8) or `float` (4, 8) with `byteOrder` `little` or `big`, optional `scale`,
  `offset`, `min`, `max`; or `utf8`/`bytes` with `minLength`/`maxLength`. `unit` from: none, count, percent, degC, K, V,
  mV, A, mA, W, Hz, rpm, Pa, hPa, m, mm, s, ms, lx, ppm, dBm, bpm, percentRH. Do not invent a unit or scale the
  documentation does not give; leave `none` and say so.
- `writes`: named write operations, each with `class` `configure` (volatile setting), `actuate` (moves, switches or
  drives hardware) or `persistent` (stored, survives a reset), `value` `fixed` with `data` hex or `typed` (a
  `--value` encoded by the payload within min and max), `response` (true needs property write) and optional
  `readBack`. There is no raw write: every byte a write can send is in the profile.
- `identity: true` on one readable `utf8` or `bytes` characteristic without side effects, such as the Device
  Information serial number `2a25`; with the registry `serial` it tells two units of one model apart.
- `advertisement`: `serviceUuids`, `localName`, `manufacturerId` hints for scan candidates; never identity.

Check a profile offline with `ble-tool capabilities --profile <file>` before the first device call; `discover-services`
on the device shows its real table. Firmware update (DFU) services are never declared: ble-tool has no update command.

# ble-tool: operations, device profile, registry entry, results and exit codes

Governs the ble-tools plugin's helper `ble-tool` (`05_Software/plugins/ble-tools/scripts/ble_tool.py` with the support
package `ble_support/`). The host side of the registry kind `ble-device` is `.agentic/specs/REQ-DATA-f2cbfc23.md` §1-2.

## 1 Engine and platforms

- PEP 723 script, `requires-python >= 3.11`, pinned `bleak==3.1.0` and its platform dependencies pinned exactly
  (`winrt-runtime==4.1.0`, eight `winrt-windows-*==4!10.0.28000.2957` projections and `typing-extensions==4.16.0` on
  win32; `dbus-fast==5.2.0` on linux). The helper refuses any other installed Bleak version (`backend-version`).
- Backends: WinRT on Windows 11 (build >= 22000; Bleak 3.1.0 declares Windows 11 only) and BlueZ >= 5.55 on Linux.
  Another platform or an older Windows build is refused `os-unsupported` before the radio is used; Bleak's own BlueZ
  version refusal maps to `os-unsupported`. macOS and Android backends are not offered.
- The helper uses only the BLE central role: scanning, connecting, GATT discovery, read, write and notifications. It
  never calls `pair`, `unpair`, never sets `pair=True`, never writes descriptors other than the CCCD Bleak writes for
  `start_notify`/`stop_notify`, never powers or configures the adapter and never advertises.

## 2 Registry entry `ble-device` (`lab/resources.json`, read from `$BLE_REGISTRY`)

```json
{ "alias": "thermo", "kind": "ble-device", "address": "C4:7F:51:00:12:34", "addressType": "public",
  "profile": "bench-thermometer", "serial": "TH-0042", "adapter": "hci0", "note": "bench sensor" }
```

- `address`: six colon-separated hex octets. `addressType`: `public` or `random`; a `random` address must be static
  (the two most significant bits of the first octet are `11`): resolvable and non-resolvable private addresses change
  and are refused.
- `profile`: the id of the device profile this unit follows (`^[a-z0-9][a-z0-9-]{0,63}$`); a call's `--profile` file
  must carry the same `id`.
- Optional `serial` (1...64 printable ASCII): the value the profile's identity characteristic reports for this unit.
- Optional `adapter` (`hci<0..99>`): the BlueZ adapter; refused on Windows (`adapter-unsupported`), where the system's
  default adapter is used. Optional `note` (at most 256 characters). Unknown keys are refused.
- Lease key: `ble:<address lower-case>`. Entries of other kinds are skipped by ble-tool; a registry whose bytes differ
  from `$VERA_REGISTRY_SHA256` is refused `registry-changed` before the radio is used.

## 3 Device profile (a workbench JSON file named with `--profile`, at most 64 KiB)

```json
{
  "format": 1, "kind": "ble-tools-profile", "id": "bench-thermometer", "name": "Bench thermometer",
  "pairing": "none",
  "advertisement": { "serviceUuids": ["0000181a-0000-1000-8000-00805f9b34fb"], "localName": "THERMO" },
  "limits": { "connectTimeoutS": 20, "operationTimeoutS": 10, "maxNotificationsPerSecond": 50,
              "maxNotifications": 10000, "maxBytes": 1048576 },
  "services": [
    { "uuid": "181a", "characteristics": [
      { "name": "temperature", "uuid": "2a6e", "properties": ["read", "notify"], "operations": ["read", "notify"],
        "sideEffects": "none",
        "payload": { "type": "int", "size": 2, "byteOrder": "little", "scale": 0.01, "unit": "degC",
                     "min": -40, "max": 125 } },
      { "name": "setpoint", "uuid": "8e1f0001-1c2b-4a3d-9e5f-0123456789ab", "properties": ["read", "write"],
        "operations": ["read", "write"], "sideEffects": "none",
        "payload": { "type": "uint", "size": 1, "byteOrder": "little", "unit": "percent", "min": 0, "max": 100 },
        "writes": [ { "name": "set-level", "class": "actuate", "value": "typed", "response": true, "readBack": true },
                    { "name": "off", "class": "actuate", "value": "fixed", "data": "00", "response": true } ] },
      { "name": "serial-number", "uuid": "2a25", "properties": ["read"], "operations": ["read"], "sideEffects": "none",
        "identity": true, "payload": { "type": "utf8", "maxLength": 64, "unit": "none" } }
    ] }
  ]
}
```

- Unknown keys are refused at every level. UUIDs are 16-bit (4 hex), 32-bit (8 hex) or 128-bit
  (`8-4-4-4-12` hex), normalized to the 128-bit lower-case form with the Bluetooth base UUID. At most 16 services,
  32 characteristics each; names `^[a-z][a-z0-9-]{0,31}$`, unique across the profile.
- `pairing`: `none` or `required` (informational for the user and the result; the helper never pairs).
- `advertisement` (optional): `serviceUuids`, `localName`, `manufacturerId` (0...65535): hints that make a scanned
  advertiser a `candidate`; never identity.
- `limits`: `connectTimeoutS` 1...60, `operationTimeoutS` 1...60, `maxNotificationsPerSecond` 1...500,
  `maxNotifications` 1...100000, `maxBytes` 1...16777216.
- `properties`: the GATT properties the characteristic must have (subset of `read`, `write`,
  `write-without-response`, `notify`, `indicate`). `operations`: allowed operations, subset of `read`, `notify`,
  `write`, each backed by a property (`notify` by notify or indicate, `write` by write or write-without-response).
- `sideEffects`: required, `none` or `changes-state` (a read or subscription that changes the device, such as a
  read-to-clear register or a stream that powers a sensor). The author decides it; a standard UUID never implies it.
- `payload.type`: `int`/`uint` (size 1, 2, 4 or 8), `float` (size 4 or 8, IEEE 754), `utf8` or `bytes`
  (`minLength` 0...512, `maxLength` 1...512). `byteOrder` `little` or `big` for numbers. Optional `scale`
  (non-zero) and `offset` for numbers: value = raw * scale + offset. Optional `min`/`max` for numbers.
  `unit` from the closed set `none, count, percent, degC, K, V, mV, A, mA, W, Hz, rpm, Pa, hPa, m, mm, s, ms, lx,
  ppm, dBm, bpm, percentRH`; any other unit is refused.
- `writes` (only with the `write` operation): named write operations, at most 16 per characteristic. `class`:
  `configure` (a volatile setting), `actuate` (moves, switches or drives hardware) or `persistent` (stored on the
  device, survives a reset). `value`: `fixed` with `data` (hex, 1...512 bytes) or `typed` (a `--value` encoded with the
  payload schema; numbers only, within `min`/`max`). `response`: true for write with response (needs property `write`),
  false for without response (needs `write-without-response`). Optional `readBack` (needs operation `read`).
- `identity: true` on at most one characteristic of type `utf8` or `bytes` with operation `read` and `sideEffects`
  `none`: its value is compared with the registry's `serial`.

## 4 Operations

Common options: `--run-id`, `--results-dir` (default `arduino-iot-results`). Connected operations take
`--device <alias>` and `--profile <file>`.

| Operation | Options | Effect |
|---|---|---|
| `capabilities` | `[--profile]` | offline: backend, pins, platform support, caps; a profile's summary |
| `scan` | `--duration 1..30 [--max-devices 1..500] [--active] [--profile]` | bounded scan, no connection |
| `identify` | device, profile | find, connect, check the GATT database, read the identity characteristic |
| `discover-services` | `--device [--profile]` | connect, list services, characteristics (properties, handles, descriptors) |
| `read-characteristic` | device, profile, `--characteristic`, `[--count 1..100] [--interval 0.1..60] [--side-effects]` | reads |
| `subscribe-notifications` | device, profile, `--characteristic`, `--duration 1..3600`, `[--max-notifications] [--side-effects]` | notifications |
| `write-characteristic` | device, profile, `--characteristic`, `--write <name>`, `[--value <number>] [--persistent]` | one write |
| `release` | `--device` | VERA's cleanup: ends a connection this computer still holds to the device |
| `report` | `--run <dir>... [--title]` | summarizes run folders |

Order of a connected operation: arguments, registry, profile and request checks (nothing on the radio); the adapter;
`find_device_by_address` bounded by `connectTimeoutS` (scanning mode passive on Windows, active on Linux); one connect
with `pair=False` (WinRT: `address_type` from the registry, `use_cached_services` false); the GATT check (§5); then the
operation; then `stop_notify` for any subscription it started and one disconnect. Nothing is retried: a connect,
read or write that fails ends the operation after its single attempt, and a lost connection is never re-established.

`scan` in passive mode (the default) is refused on Linux `passive-unsupported` (BlueZ needs advertisement-monitor
patterns and its experimental mode, a global configuration); `--active` sends scan requests. The scan ends after
`--duration` seconds or when `--max-devices` distinct addresses were seen.

## 5 Identity

- `candidate`: an advertiser whose address equals a registry entry's, or whose advertisement matches the profile's
  `advertisement` hints. A scan reports candidates only.
- `confirmed`: in this run the registry address was found and connected, the GATT database holds every profile
  service and characteristic with every declared property, and, when the profile declares an identity characteristic
  and the entry a `serial`, the read value equals `serial`. Every read, subscription and write needs `confirmed`;
  without it the run ends before any profile characteristic is read or written: `profile-mismatch` (a service,
  characteristic or property is missing, with the list) or `identity-mismatch`. An identity characteristic without a
  registry `serial` (or a serial without an identity characteristic) gives a warning `identity-unchecked`.

## 5a Payload decoding (each read value or notification)

`raw` (hex), `length`, `receivedAt`, `value`, `unit`, `valid`, `decodeError`. A length other than `size` (numbers) or
outside `minLength..maxLength`, or invalid UTF-8, gives `value: null`, `valid: false`, `decodeError: length|utf8`; a
float that is NaN or infinite gives `decodeError: not-finite`; a number outside `min..max` keeps its `value` with
`valid: false`, `decodeError: out-of-range`. A `bytes` value is the hex string.

## 6 Writes

The write is the profile's named operation: `fixed` sends `data`; `typed` takes `--value` (a decimal number), checks
`min..max`, computes raw = (value - offset) / scale, which must be an integer within the size's range
(`value-not-representable`), and encodes it in `byteOrder`. A persistent write needs `--persistent` and `--persistent`
needs a persistent write (`write-class`). The payload must fit one ATT write: with response at most
min(512, mtu - 3), without response at most the characteristic's `max_write_without_response_size`
(`payload-too-large`, nothing sent). The write is sent once: `delivery` is `acknowledged` (write with response
returned), `refused` (ATT error, with `attError`), `sent` (without response) or `unknown` (timeout or disconnect while
writing); `retried` is always false. `readBack` reads the characteristic once after an acknowledged or sent write and
records `matches` true/false. The device's effect is `effect: unknown` unless a read-back matches; Stop never undoes a
write.

## 7 Notifications

`start_notify` registers a callback that only stamps and queues the data (queue of 1024). The writer appends each
notification to `notifications.jsonl` (`index`, `receivedAt`, `raw`, `length`, `value`, `unit`, `valid`,
`decodeError`) and `series.csv`. The capture ends at `--duration`, `--max-notifications` (default and cap the
profile's `maxNotifications`), `maxBytes`, a stop request (polled every 0.1 s), a disconnect or an overflow. Overflow:
more than `maxNotificationsPerSecond` in one second, or a full queue, ends the capture `overflow` (status
incomplete), with `dropped` counted. On every ending path with the link up, `stop_notify` runs once:
`subscription: stopped` when it returned, `unknown` when it failed or the link was lost (`notificationsStopped` false).

## 8 Results and lifecycle

Every call prints one JSON document `{format: 1, kind: "ble-tool-result", tool, operation, startedAt, finishedAt,
status, errors, warnings, ...}`, at most 11000 UTF-16 units on stdout (lists cut, counted in `omittedFromOutput`).
Every operation except `capabilities` writes `result.json` and `report.md` into a new run folder
`<results-dir>/<run-id>` (created exclusively, inside the working directory, never inside `.vera`) once its request
checks pass; a call refused by them writes no folder. Status `pass`, `fail`, `blocked`, `incomplete`, `error`; exit 0
pass, 1 fail (profile-mismatch, identity-mismatch, read-back differs), 2 blocked (refused before the radio, or
`pairing-required`, `not-found`, `adapter-unavailable`, `os-unsupported`, `passive-unsupported`), 3 incomplete or
error.

Device fields: `device {alias, address, addressType, profile, identity: confirmed|candidate|mismatch|unchecked,
serial?, mtu?}`, `services` (discover), `reads`, `notifications`, `write`, `link {connected, disconnectedBy:
helper|device|unknown, subscription: none|stopped|unknown}`.

Lifecycle (`$VERA_RUN_CONTROL`, as the scpi and bus helpers keep it): phases start, identified, acting, cleaning,
released; `physical` names the link VERA manages: `unchanged` before any connection, `pending` while connected,
`confirmed` once the helper disconnected and every subscription it started was stopped, `unknown` otherwise. It never
describes what a write made the device do (`write.effect`).

`release` lists the devices the system holds connected (`BleakAdapter.get_connected_devices` with the Generic
Attribute service) for up to 10 s: the registry address absent -> released, `physical: confirmed`; present on Linux ->
one connect and disconnect through BlueZ, then checked again; present on Windows -> `held-by-system` (another
application or the OS holds it), `physical: unknown`.

## 9 Error codes

arguments, path, registry, registry-changed, device-unknown, adapter-unsupported, profile, profile-device (the
profile's id differs from the entry's), backend-version, os-unsupported, adapter-unavailable (reason no-bluetooth,
powered-off, denied, unknown), passive-unsupported, not-found, connect-failed, connect-timeout, profile-mismatch,
identity-mismatch, operation-not-allowed, side-effects-not-named, write-unknown, write-class, value-required,
value-out-of-range, value-not-representable, payload-too-large, read-back (fail: the read-back differs), pairing-required (ATT 0x05, 0x08, 0x0C, 0x0F), not-permitted (ATT 0x02, 0x03),
gatt-error, timeout, disconnected, overflow, stopped, held-by-system, run-exists, run-invalid, internal.

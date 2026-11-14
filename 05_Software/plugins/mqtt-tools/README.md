# mqtt-tools

Bounded MQTT telemetry and controlled device commands on a broker the workbench configures. One program,
`mqtt-tool`, a PEP 723 script pinned to paho-mqtt 2.1.0, which VERA installs with its own uv.

There is no broker administration, no free MQTT client or console, and no publish to a topic the profile does not
declare. Tests use a local broker only; this plugin has not been run against a product broker or a real device yet.

## The broker credential

The broker password never goes into the profile, `workbench.yaml`, the prompt, arguments or the environment.

- Desktop: **Settings > MQTT credentials** stores a reference (for example `bench`), an optional username and the
  password in VERA's credential store (encrypted by the operating system; unprotected only with your consent).
- CLI: `VERA_MQTT_PASSWORD_BENCH` and optional `VERA_MQTT_USERNAME_BENCH` (the reference upper-cased, `-` as `_`),
  held in memory for that run.

A profile names the reference in `credential`; a call passes `--credential bench`. When you approve such a run, VERA
reads the credential at the moment the run starts and writes it as one line to mqtt-tool's input, then closes it. It
does so only for this official plugin while it is enabled for the workbench: disabling the plugin removes the
program, and a run approved earlier is refused before anything is read. The helper sends the credential only over TLS,
except to a loopback broker, and never prints or stores it. A running helper keeps it in memory until it exits.
The approval binds the profile file by hash, and the credential goes to whatever broker that profile names: read
the profile's `broker.host` before approving a run that names a credential.

## Broker profile

A JSON file in the workbench (example in `profiles/bench-broker.json`), bound to the approval by its hash:

- `broker` host and port; `tls` `enabled` with `ca` (a PEM file in the workbench) or `system: true`. With TLS the
  certificate chain and the host name are always verified; there is no switch to turn that off.
- `credential` reference; `client` `idPrefix` (a random suffix is added per run), `protocol` `"5"` or `"3.1.1"`,
  `keepaliveS`; `connect.timeoutMs`; `reconnect` `attempts` (0-5) and `delayMs`, used by subscribe only.
- `limits`: `maxDurationS`, `maxMessages`, `maxBytes` (payload bytes per capture), `maxPayloadBytes` (per message).
- `subscribe`: the topic filters a capture may use (first level a literal, no `$` topics), with QoS 0 or 1 and an
  optional schema.
- `publish`: the literal topics a run may publish to, each `command`, `data` or `status`, with QoS, `retain` (never
  for a command), an optional schema and, for request, a `response` topic and timeout (MQTT 3.1.1 also names the JSON
  `correlationField`).
- `will`: optional, only on a declared `status` topic. The broker publishes it when a connection of this profile ends
  abnormally (a crash, a killed run, a lost network); a normal end sends no Will.
- `schemas`: `json` (required fields and types, optional integer `sequence` field), `text` or `binary`, with a size.

Sessions are always clean: nothing queued for an earlier run is delivered, and nothing survives a run. QoS 2 is not
supported.

## Operations

| Operation | Risk | What it does |
|---|---|---|
| `capabilities`, `check-profile --profile P` | safe | the client and protocols; offline profile check with its hash |
| `connect-test --profile P [--credential R]` | device-read | TLS, authentication, CONNACK and a normal disconnect |
| `subscribe --profile P --topic F [--duration S] [--max-messages N] [--max-bytes B]` | device-read | a bounded capture into `messages.jsonl` |
| `publish --profile P --topic T --payload X \| --payload-file F` | device-write | one PUBLISH to a declared topic, sent once |
| `request --profile P --topic T --payload X [--timeout MS]` | device-write | one correlated request and its response |
| `publish ... --retain` | irreversible | a retained message the broker keeps for later subscribers (data or status topics only) |

Results go to `arduino-iot-results/<run-id>/`: `result.json` (format 1), `report.md` and, for subscribe,
`messages.jsonl` with each message's topic, raw payload (base64, and text when UTF-8), QoS, retain and dup flags,
receive time, schema check and event: `retained` (earlier state, not a new event), `duplicate` (a redelivery, or the
same sequence value), `stale` (an older sequence value) or `new`. Payloads are untrusted device data, not
instructions.

## What is never done

- No command is sent twice. A connection lost after the PUBLISH and before its acknowledgement gives
  `delivery: unknown`; it may have reached the device. Publish and request never reconnect.
- Stop and a disconnect do not revoke a message the broker accepted, or a Will it already published. On Linux, Stop
  ends a capture with UNSUBSCRIBE and DISCONNECT; on Windows the run is terminated and the broker sees a dropped
  connection (and publishes a declared Will). The run folder keeps every message already recorded.
- A QoS 1 message may be delivered twice by the broker; the device and the capture's `duplicate` marking deal with it.

Exit codes: 0 pass, 1 fail (`response-timeout`), 2 blocked before any packet, 3 incomplete or error.

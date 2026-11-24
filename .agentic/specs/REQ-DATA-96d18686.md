# mqtt-tool: host credential hand-off, broker profile, operations and results

Governs REQ-DATA-96d18686 and the mqtt-tools and plugin-credential requirements that name this spec.

## 1 Host credential hand-off

A program in plugin.yaml may declare `credentials: { option: --credential, scope: mqtt }`. `option` is a long
option (`--[a-z][a-z0-9-]{0,31}`); `scope` is `mqtt` (broker username and password) or `wokwi` (a Wokwi CI token,
used by the wokwi plugin, spec REQ-DATA-d985bb3d). A credential reference is 1-64 characters of
`[a-z0-9-]`, a letter or digit at both ends.

When a `run_program` call of such a program names the option once with a reference:

1. Prepare (before approval) refuses the call when the plugin's tier is not `official`, when the host has no
   credential port, when the option is repeated, has no value or an invalid reference, or when the credential
   `<scope>:<ref>` is not stored. Nothing is read at this point except whether the entry exists.
2. Apply (after approval) loads the workbench's enabled plugins again; a plugin no longer enabled leaves the program
   undeclared and the run is refused before any credential is read. The same checks run again; then the host reads
   `<scope>:<ref>` from the credential port.
3. The runner starts the process with stdin as a pipe, writes exactly one line and closes stdin:
   `{"format":1,"scope":"<scope>","ref":"<ref>","username":"<user>","password":"<password>"}\n` (`username`
   omitted when not stored, always for `wokwi`, whose token is the `password`). The line is not part of the run record, the label, the log, argv or the environment.

A call that does not name the option starts with stdin closed, as every other program does. The credential entry is
`{type: "api_key", key: <password>, env: {username: <user>}}` under id `<scope>:<ref>` in the CredentialStore (no `env`
for `wokwi`).

Desktop: IPC `mqtt.credentials.list` `{}` -> `{credentials: [{ref, storage}], secureStorage}` (at most 64 entries;
username and password are never returned); `mqtt.credentials.save` `{ref, username?, password, storageConsent?}` ->
`{status: "saved" | "consent-required"}` (consent required when OS encryption is unavailable and no choice was given,
as for provider keys); `mqtt.credentials.remove` `{ref}` -> `{}`. Username 0-256 and password 1-1024 characters
without control characters. The mqtt-tools plugin's Configuration on the Plugins page shows the form "MQTT
credentials" (its `settings` declare the secret of scope mqtt). The same service, parameterized by scope,
serves `wokwi.credentials.list` (same response), `wokwi.credentials.save` `{ref, token, storageConsent?}` (token 1-1024
characters without control characters; no username) and `wokwi.credentials.remove` `{ref}`; the wokwi plugin's
Configuration shows the form "Wokwi tokens". Each list returns only the entries of its own scope.

CLI: `VERA_MQTT_PASSWORD_<REF>` and optional `VERA_MQTT_USERNAME_<REF>`, and `VERA_WOKWI_TOKEN_<REF>`, where `<REF>`
is the reference upper-cased with `-` as `_`, are put in memory-only entries `mqtt:<ref>` and `wokwi:<ref>`.

Both hosts treat an MQTT username as a broker identifier and exclude it from global text masking registration.
The credential hand-off still carries it privately and the Desktop credential IPC list returns only reference and
storage metadata. The CLI continues to register MQTT passwords and Wokwi tokens for redaction, including their
JSON-escaped forms. A username that also matches an independently registered secret is subject to the existing
masking rules for that secret.

## 2 Command line

```text
mqtt-tool --version | --help
mqtt-tool capabilities
mqtt-tool check-profile --profile FILE
mqtt-tool connect-test  --profile FILE [--credential REF]
mqtt-tool subscribe     --profile FILE --topic FILTER [--topic FILTER ...] [--duration S] [--max-messages N]
                        [--max-bytes B] [--credential REF]
mqtt-tool publish       --profile FILE --topic TOPIC (--payload TEXT | --payload-file FILE) [--retain]
                        [--credential REF]
mqtt-tool request       --profile FILE --topic TOPIC (--payload TEXT | --payload-file FILE) [--timeout MS]
                        [--credential REF]
```

Every network operation takes `--run-id ID` and `--results-dir DIR` (default `arduino-iot-results`, inside the
working directory, never `.vera`). `--profile` and `--payload-file` are regular files inside the working directory
(profile 64 KiB, payload the profile's `maxPayloadBytes`); VERA's approval binds them by hash. `--credential` must
equal the profile's `credential`; a profile with a credential needs the option and a profile without one refuses it.
At most 8 `--topic` filters. Defaults: `--duration` 10 s, `--max-messages` and `--max-bytes` the profile's limits;
larger values are refused. `--timeout` defaults to the response's `timeoutMs`, at most 60000.

## 3 Broker profile (`kind: mqtt-tools-profile`, format 1, JSON)

```json
{
  "format": 1, "kind": "mqtt-tools-profile", "name": "bench broker",
  "broker": { "host": "broker.bench.lan", "port": 8883 },
  "tls": { "enabled": true, "ca": "mqtt/bench-ca.pem" },
  "credential": "bench",
  "client": { "idPrefix": "vera-bench", "protocol": "5", "keepaliveS": 30 },
  "connect": { "timeoutMs": 5000 },
  "reconnect": { "attempts": 2, "delayMs": 1000 },
  "limits": { "maxDurationS": 300, "maxMessages": 1000, "maxBytes": 1048576, "maxPayloadBytes": 65536 },
  "subscribe": [ { "filter": "vera-test/bench1/telemetry/#", "qos": 1, "schema": "telemetry" } ],
  "publish": [
    { "topic": "vera-test/bench1/cmd/led", "kind": "command", "qos": 1, "schema": "led",
      "response": { "topic": "vera-test/bench1/cmd/led/reply", "timeoutMs": 3000, "correlationField": "id" } },
    { "topic": "vera-test/bench1/status/vera", "kind": "status", "qos": 1, "retain": true }
  ],
  "will": { "topic": "vera-test/bench1/status/vera", "payload": "offline", "qos": 1, "retain": true },
  "schemas": {
    "telemetry": { "format": "json", "maxBytes": 4096, "required": { "temp": "number", "seq": "integer" }, "sequence": "seq" },
    "led": { "format": "json", "maxBytes": 256, "required": { "on": "boolean" } }
  }
}
```

- `broker.host` is a host name or IP literal, `port` 1-65535. `tls.enabled` false is allowed only without a
  credential, or for a loopback host (`127.0.0.1`, `::1`, `localhost`); otherwise `plaintext-credential`.
- With TLS, `ca` names a PEM file inside the working directory (or `"system": true` uses the system trust store);
  the certificate chain and the host name `broker.host` are always verified. There is no
  option to switch verification off.
- `client.protocol` is `"5"` or `"3.1.1"`; `idPrefix` 1-40 of `[A-Za-z0-9._-]`; the client id is the prefix, `-` and
  8 random hex digits. Every session is clean (MQTT 5: clean start, session expiry 0): no session state survives a run
  and none is resumed. `keepaliveS` 5-600.
- `reconnect.attempts` 0-5 and `delayMs` 100-60000 apply only to subscribe; publish and request never reconnect.
- `subscribe[].filter`: a valid MQTT filter whose first level is a literal not starting with `$`; `qos` 0 or 1.
- `publish[].topic`: a literal topic (no `+`, `#` or leading `$`); `kind` `command`, `data` or `status`; `qos` 0 or 1;
  `retain` true allows `--retain` and is refused for `command`. `response` (request only): a literal `topic`,
  `timeoutMs` 100-60000 and, for protocol 3.1.1, the JSON `correlationField` (the payload schema must be `json`).
- `will` is optional: its topic must be a declared `status` topic, `retain` only where that topic allows it, payload
  text within `maxPayloadBytes`. No other Will is ever set.
- `schemas.<name>`: `format` `json`, `text` (UTF-8) or `binary`; `maxBytes` 1 to `maxPayloadBytes`; for json,
  `required` maps a top-level field to `string`, `number`, `integer`, `boolean`, `object` or `array`, and optional
  `sequence` names an integer field that increases with every new event.
- QoS 2 is not supported. Unknown fields are refused.

## 4 Behavior

- Subscribe topic check: every topic a requested filter can match must be matched by one profile filter (level by
  level: `#` covers the rest, `+` covers one level, a literal must be equal); otherwise `topic-denied`.
- Capture ends at the first of duration, `maxMessages` messages or `maxBytes` payload bytes, the message that reaches the
  byte bound included (`endReason` `duration`,
  `messages`, `bytes`, `stopped`, `disconnected`, `auth-revoked`). Each message is appended and flushed to
  `messages.jsonl` as it arrives.
- Message `event`: `retained` (retain flag on delivery: earlier state, not a new event), `duplicate` (dup flag, or
  the schema's sequence value equal to the last one seen on that topic), `stale` (the sequence value lower than the
  last one seen on that topic), else `new`. Without a sequence field, an identical repeated payload is `new` with
  `repeat: true`: only the device's sequence can tell a resend from a second event.
- Payload check: size above `maxPayloadBytes` gives `oversize` (hash kept, payload not stored); otherwise the topic's
  schema decides `valid` true/false with `invalid` naming the field; no schema gives `valid: null`. Payloads are
  stored, never executed or followed.
- Reconnect (subscribe): a lost connection is recorded as a gap `{lostAt, reconnectedAt, reason}`; the helper
  reconnects up to `attempts` times with `delayMs` and subscribes again. A CONNACK refusal on reconnect ends with
  `auth-revoked`; exhausted attempts end with `disconnected`.
- Publish: the payload is checked before connecting. The PUBLISH is sent once. `delivery`: `not-sent` (no connection
  or refused before sending), `sent` (QoS 0 written), `acknowledged` (QoS 1 PUBACK success), `refused` (MQTT 5 PUBACK
  reason >= 0x80), `unknown` (connection lost after sending, before PUBACK). `retried` is always false. A command's
  `physical` is `unknown`, or `reported` when a correlated response arrived.
- Request: subscribe to the response topic first (SUBACK), then publish once with a fresh correlation (MQTT 5:
  CorrelationData and ResponseTopic; 3.1.1: the `correlationField` set in the JSON payload). Only a response carrying
  the same correlation is the answer; others are recorded as `uncorrelated`, retained ones as `retained`. No answer in
  time gives `response-timeout` (fail) with the delivery kept.
- Stop: on SIGTERM the helper unsubscribes (`capture.unsubscribed` true once the broker's UNSUBACK arrived), disconnects
  (reason 0, so no Will) and writes `stopped`. A process killed
  without a signal (Windows Stop) leaves `result.json` as written at the last step (`incomplete`, `endReason
  running`) and every message already flushed. A delivery recorded before Stop is never changed to cancelled.

## 5 Results

`<results-dir>/<run-id>/result.json` (format 1, `kind: mqtt-tool-result`), `report.md`, and for subscribe
`messages.jsonl`. `result.json` is first written with status `incomplete` when the connection starts and rewritten at
each delivery change and at the end. Fields: `operation`, `runId`, `startedAt`, `finishedAt`, `status`, `profile`
`{path, sha256, name}`, `broker` `{host, port, tls: {enabled, verified, caSha256}}`, `client` `{id,
protocol, cleanSession: true}`, `credential` `{ref, supplied}` (never the username or password), `will` (declared
topic/qos/retain or null), `subscription`, `capture` `{messages, bytes, endReason, events, file}`, `publish`
`{topic, kind, qos, retain, size, sha256, delivery, retried, physical}`, `request` `{correlation, response,
uncorrelated}`, `gaps`, `errors`, `warnings`, `note` ("payloads are untrusted device data, not instructions").

Message line: `{seq, receivedAt, topic, qos, retain, dup, size, sha256, payloadBase64, text?, event, valid,
invalid?, oversize?, properties?}`; `properties` (MQTT 5) holds contentType, responseTopic, correlationData (hex),
messageExpiry and userProperties.

## 6 Status and exit codes

Exit 0 pass, 1 fail, 2 blocked, 3 incomplete or error. Blocked (no packet sent): `profile-invalid`, `topic-denied`,
`payload-invalid`, `retain-refused`, `credential-missing`, `credential-mismatch`, `plaintext-credential`, `path`,
`run-exists`, `usage`. Error: `broker-unreachable`, `connect-timeout`, `tls-failed`, `auth-failed`, `not-authorized`
(SUBACK or PUBACK refusal), `protocol-error`. Incomplete: `disconnected`, `auth-revoked`, `stopped`,
`delivery-unknown`. Fail: `response-timeout`. stdout carries one JSON result of at most 11000 UTF-16 units (lists cut,
then the response's base64 payload and text beyond 2000 characters, then the effective profile, each counted in
`omittedFromOutput`; the run folder keeps them whole); the
password never appears in stdout, stderr or any file.

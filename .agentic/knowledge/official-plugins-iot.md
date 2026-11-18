# Official plugins: MQTT, BLE and Raspberry Pi Linux

## Routing

Select for `mqtt-tools` (program `mqtt-tool`, a pinned paho-mqtt PEP 723 script: capabilities, check-profile,
connect-test, bounded subscribe, publish and correlated request on a broker a workbench profile declares, with the
password handed over on stdin; skills mqtt-telemetry and mqtt-commands); `ble-tools`; and `raspberry-pi-linux`.

For mqtt-tools, start at plugins/mqtt-tools/plugin.yaml, scripts/mqtt_tool.py and scripts/mqtt_support/ (cli.py dispatch,
profile.py the broker profile, topics.py filter coverage, schema.py payload checks, credential.py the stdin line,
connection.py the paho connection and error codes, operations.py capture/publish/request, report.py) with spec
.agentic/specs/REQ-DATA-96d18686.md; tests/plugins/mqtt-tools.test.ts with tests/support/mqtt-test-broker.py (a
stdlib MQTT 3.1.1/5 test broker on 127.0.0.1 with TLS, users, ACL and fault switches), make-mqtt-certs.py and
mqtt-fixture-device.py own its coverage - evidence for the helper, not for a product broker or a device. Its
workspace.py is a byte-identical copy of bus-tool's; the credential hand-off is platform behaviour, see
[Plugin configuration and credentials](plugins-configuration.md).

For ble-tools, start at plugins/ble-tools/plugin.yaml, scripts/ble_tool.py and scripts/ble_support/ (cli.py dispatch and
argument bounds, registry.py ble-device entries, profile.py device profiles and UUIDs, payload.py decode/encode,
backend.py the pinned Bleak and error mapping, scan.py, device.py the managed link and identity, notify.py, write.py,
operations.py read/discover/release, report.py) with spec .agentic/specs/REQ-DATA-e8502710.md;
tests/plugins/ble-tools.test.ts with the fake Bleak in tests/fixtures/ble-tools/fake-bleak owns its coverage -
offline evidence plus one opt-in real scan, not proof of a device. Its workspace.py is a byte-identical copy of
circuitpython-tool's and lifecycle.py of bus-tool's; the device lease is platform behaviour, see [Plugin program runner](plugins-runner.md).

For raspberry-pi-linux, start at plugins/raspberry-pi-linux/plugin.yaml, scripts/pi_tool.py and scripts/pi_support/ (cli.py
dispatch, registry.py the linux-board entries, project.py vera-pi.json and its files, ssh.py the pinned host key, agent
authentication and remote calls, remote.py the two constant commands, operations.py every operation, report.py) and the
board-side scripts/remote/vera_pi_remote.py, with spec .agentic/specs/REQ-DATA-44547a17.md;
tests/plugins/raspberry-pi-linux.test.ts with tests/support/pi-test-sshd.py and pi-test-agent.py owns its coverage -
SSH protocol and real-Linux evidence (WSL on Windows), never proof of a Raspberry Pi. Its workspace.py and lifecycle.py
are byte-identical copies of ble-tool's; the board lease and the agent socket are platform behaviour, see
[Plugin bench resources](plugins-bench-resources.md).

The conventions shared by all official plugins (package format, catalog source, packs, versions and evidence
levels) and the page of every other plugin are in [Official plugins](official-plugins.md). The platform that
installs, classifies, approves and runs these programs is [Plugins](plugins.md); plugin skill discovery is
[Skills](skills.md).

## Public interface

- `mqtt-tools` 0.2.0, ecosystem `iot` (Arduino pack, group "MQTT telemetry and commands", default on; activities
  `testing`, `communication`), Windows x64 and Linux x64. Program `mqtt-tool` = `scripts/mqtt_tool.py` (PEP 723,
  `paho-mqtt==2.1.0`), timeout 120 s, `credentials {option: --credential, scope: mqtt}`, no env. Risks: `capabilities`,
  `check-profile` safe; `connect-test`, `subscribe` device-read (3600 s); `publish`, `request` device-write; `publish`
  with `--retain` irreversible. Profile (`mqtt-tools-profile` format 1, 64 KiB, unknown fields refused): broker
  host/port, TLS with a workbench CA or the system store (chain and host name always verified), credential reference
  (plaintext only to loopback), client id prefix + 8 random hex, protocol 5 or 3.1.1, clean session only, keepalive,
  connect timeout, reconnect attempts 0-5 (subscribe only), limits, subscribe filters (first level literal, no `$`),
  publish topics (literal, command/data/status, QoS 0/1, retain never on command, response topic/timeout and the 3.1.1
  correlation field), optional Will on a status topic, json/text/binary schemas with an optional integer sequence field.
  Every refusal (`profile-invalid`, `topic-denied`, `payload-invalid`, `retain-refused`, `credential-missing`,
  `credential-mismatch`, `plaintext-credential`, `path`, `run-exists`, `usage`) comes before the run folder and any packet,
  exit 2. Connection codes `broker-unreachable`, `connect-timeout`, `tls-failed`, `auth-failed`, `not-authorized`,
  `protocol-error` (exit 3). Capture: every message appended and flushed to `messages.jsonl` (raw base64, text, QoS,
  retain, dup, size, SHA-256, receive time, schema check, event retained/duplicate/stale/new, MQTT 5 properties); ends at
  duration, messages or bytes; a lost connection is a gap, reconnected per policy, `auth-revoked` or `disconnected`
  (incomplete). Publish/request: one PUBLISH, delivery not-sent/sent/acknowledged/refused/unknown, `retried` false,
  command physical unknown or reported; request subscribes first, correlates (MQTT 5 correlation data, 3.1.1 JSON
  field), lists uncorrelated replies, `response-timeout` (exit 1). `result.json` is rewritten as incomplete while the run
  goes on; SIGTERM (Linux) unsubscribes and disconnects (`stopped`); a Windows Stop leaves the last written state.
  Results `arduino-iot-results/<run-id>/` (`mqtt-tool-result`, `report.md`, `messages.jsonl`); exit 0/1/2/3. Evidence:
  the local test broker only; no product broker or device yet, native Ubuntu not run.

- `ble-tools` 0.2.0, ecosystem `iot` (Arduino pack, group "BLE devices (GATT)", default on; activities `testing`,
  `communication`), Windows x64 and Linux x64. Program `ble-tool` = `scripts/ble_tool.py` (PEP 723, `bleak==3.1.0` with
  `winrt-runtime==4.1.0`, eight `winrt-windows-*==4!10.0.28000.2957` projections and `typing-extensions==4.16.0` on win32,
  `dbus-fast==5.2.0` on linux), timeout 120 s, env `BLE_REGISTRY=${workbench}/lab/resources.json`,
  `resources {option: --device, kinds: [ble-device], grace: 5, cleanup: [release], cleanupTimeout: 30}`. Risks:
  `capabilities`, `report` safe; `scan`, `identify`, `discover-services`, `read-characteristic`,
  `subscribe-notifications` device-read (3600 s); with `--side-effects` device-write; `write-characteristic` and
  `release` device-write; `--persistent` irreversible. The helper refuses any installed Bleak other than 3.1.0
  (`backend-version`), a backend other than WinRT/BlueZ or Windows older than build 22000 (`os-unsupported`); it uses
  only the central role and never pairs, unpairs, enters a PIN, writes descriptors itself, advertises or changes the
  adapter. Scan: passive by default (Linux refuses passive, `passive-unsupported`; `--active`), 1-30 s, at most 500
  addresses, one entry per address with names, RSSI last/min/max, service UUIDs, manufacturer ids/data, tx power,
  count, registry alias, `candidate` (registry address or profile advertisement hints) and `ambiguousName`; never
  `confirmed`. Device calls: registry entry (kind `ble-device`), profile (`ble-tools-profile` format 1, 64 KiB, unknown
  fields refused, closed unit set, `sideEffects` required, named writes with class configure/actuate/persistent and
  fixed or typed value) whose `id` must equal the entry's `profile` (`profile-device`), then `find_device_by_address`
  within `connectTimeoutS` (`not-found`), one connect with `pair=False` (WinRT `address_type`, no cached services),
  the GATT check (`profile-mismatch` lists what is missing) and the identity characteristic against the entry's
  `serial` (`identity-mismatch`; `identity-unchecked` warning when either is absent). Reads (1-100, interval 0.1-60 s)
  and notifications keep raw hex, length, receive time, UUID, the payload schema and the decoded value; a wrong length,
  invalid UTF-8 or a non-finite float gives `value: null`, `valid: false`; out-of-range keeps the value with `valid:
  false`. Notifications: callback into a 1024 queue, `notifications.jsonl` and `series.csv`, ends at duration, count,
  bytes, stop request, disconnect or `overflow` (rate above `maxNotificationsPerSecond` or a full queue); `stop_notify`
  once before the disconnect, `subscription` stopped/unknown. Writes: named operation only (`write-unknown`), typed
  values checked (`value-required`, `value-out-of-range`, `value-not-representable`), persistent only with
  `--persistent` (`write-class`), one ATT write (`payload-too-large`: with response min(512, MTU-3), without response
  `max_write_without_response_size`), sent once, `delivery` acknowledged/refused/sent/unknown, `retried` false,
  optional read-back (`read-back` fail when it differs), `effect` unknown unless the read-back matched. ATT
  0x05/0x08/0x0C/0x0F and access denied give `pairing-required` (blocked, the user pairs in the OS); 0x02/0x03
  `not-permitted`. Nothing is retried and a lost link is `disconnected`, never re-opened. Lifecycle physical = the
  managed link: confirmed once disconnected with every started subscription stopped, else unknown. `release` polls the
  system's connected devices for 10 s: absent -> confirmed; Linux -> one connect/disconnect; Windows -> `held-by-system`
  unknown. Results `arduino-iot-results/<run-id>/` (`ble-tool-result`, `report.md`, notification files); exit 0/1/2/3.
  Evidence: the fake Bleak and one real passive scan on Windows 11; no real device read, notify, write or
  pairing yet, native Ubuntu/BlueZ not run.

- `raspberry-pi-linux` 0.2.0, ecosystem `linux` (Arduino pack, group "Raspberry Pi Linux projects", default off;
  activities `testing`, `debug`), Windows x64 and Linux x64; VERA stays on the host and reaches the board over SSH.
  Program `pi-tool` = `scripts/pi_tool.py` (PEP 723, `asyncssh==2.24.1`, `cryptography==49.0.0`,
  `typing-extensions==4.16.0`), env `PI_REGISTRY`, `resources {option: --board, kinds: [linux-board], grace: 10,
  cleanup: [stop-owned], cleanupTimeout: 60}`, `sshAgent: true`, timeout 120 s. Rules: capabilities, inspect-project,
  report safe; check-host-key, identify, task-status, service-status, collect-logs device-read; install-helper,
  deploy-candidate, apply-candidate (600 s), run-task (3600 s), service-start/stop, stop-owned device-write;
  apply-candidate `--overwrite` irreversible. The host key is accepted only when its SHA-256 fingerprint is in the
  entry's hostKeys (callable known_hosts, `~/.ssh/known_hosts` and `~/.ssh/config` never read, no host certificates):
  otherwise `host-key-unpinned`/`host-key-changed` before authentication; check-host-key stops before login.
  Authentication is public key from the system agent only (SSH_AUTH_SOCK, else Pageant or the OpenSSH pipe on Windows,
  `agentKey` filters), codes `agent-unavailable`, `agent-key-missing`, `auth-failed`, `unreachable`, `timeout`. Exec
  requests are only `/usr/bin/python3 -I -c '<install stub>'` and `... '<run stub>'` built from the helper version and
  SHA-256; requests and file bytes go on stdin. install-helper writes `~/.local/share/vera-pi/1.0.0/vera_pi_remote.py`
  (0600, hash-checked; installed / already-installed / replaced); the run stub refuses `helper-missing` /
  `helper-changed`. The helper checks the login user (not root), the declared serial/machine id/model
  (`identity-mismatch`) and the root (exists, not a link, owned, not group/world-writable: `root-invalid`). vera-pi.json:
  name, files (folders expand, `exclude`, no `..`/absolute/backslash/`.vera-pi`/links, 512 files, 16 MiB each, 64 MiB),
  hardware, tasks (argv[0] `python3` or a listed file, else `command-not-allowed`; budgetS 1-3500, output 1 KiB-16 MiB,
  extraArgs, actuates) and services (user `.service` units). deploy-candidate stages into
  `<root>/.vera-pi/candidates/<id>/` and classifies new/changed/unchanged/conflict (neither the candidate's nor the last
  applied hash) plus remoteOnly; candidate.json in the run folder. apply-candidate checks the board's own plan, staged
  hashes (`candidate-changed`) and base hashes (`conflict`) before renaming new/changed/`--overwrite` files, records
  `projects/<name>.json`, unlinks only its staged files and never deletes a project file. run-task: a detached supervisor
  (new session) starts the task in its own process group, copies stdout/stderr through itself up to the limit, ends the
  group at budget/limit/stop file (SIGTERM, SIGKILL after 3 s) and records handle, PID, `/proc` start time, boot id
  and the end; states exited, budget-exceeded, output-limit, stopped, start-failed, supervisor-lost, lost-by-reboot
  (never signalled). pi-tool polls task-wait, forwards VERA's stop file (remote `confirmed` or `unknown`), and on a
  lost connection ends `connection-lost` with remote unknown; stop-owned retries an unreachable board 3 times, 3 s
  apart. Services: `systemctl --user --no-ask-password start|stop|show` on listed units only (`service-not-allowed`),
  results report `linger` (/var/lib/systemd/linger/<user>) and keepRunning warns `keeps-running`, or `no-linger` when
  the service would stop with the SSH session; a starting record whose supervisor is gone is start-failed; group members
  that outlive a lost supervisor keep the task running and pi-tool ends them (`supervisor-lost`); staging removes the
  project's earlier candidates and its own partial folder; an ELF built on Windows deploys 0755; collect-logs writes `journalctl --user -o json -n N -u UNIT` lines (N 1-2000) and
  task log tails. Results `pi-tool-result`, `report.md`, report.html for report; exit 0/1/2/3. Evidence: the
  local asyncssh test server with commands in WSL Ubuntu 24.04 (systemd user manager); no Raspberry Pi, native Ubuntu
  not run.

## Invariants

- mqtt-tool drives paho's `loop()` itself (never `loop_forever`/`loop_start`), so paho never reconnects or resends; a
  PUBLISH is sent once per run, publish and request never reconnect, and the password read from stdin is never printed,
  written or put in an error. TLS verification has no off switch.

## Files

- `05_Software/plugins/mqtt-tools/` — manifest, README, skills mqtt-telemetry and mqtt-commands, profiles/bench-broker.json,
  `scripts/mqtt_tool.py` (entry), `scripts/mqtt_support/` (`cli`, `profile`, `topics`, `schema`, `credential`, `connection`,
  `operations`, `report`, `workspace` shared).
- `05_Software/tests/plugins/mqtt-tools.test.ts`, `tests/support/mqtt-test-broker.py`, `make-mqtt-certs.py`,
  `mqtt-fixture-device.py`.
- `05_Software/plugins/ble-tools/` — manifest, README, skills ble-devices and ble-profiles, profiles/bench-thermometer.json,
  `scripts/ble_tool.py` (entry), `scripts/ble_support/` (`cli`, `registry`, `profile`, `payload`, `backend`, `scan`, `device`,
  `notify`, `write`, `operations`, `report`, `lifecycle` and `workspace` shared).
- `05_Software/tests/plugins/ble-tools.test.ts`, `tests/fixtures/ble-tools/fake-bleak/` (fake Bleak 3.1.0 driven by a bench
  file, logging every radio call).
- `05_Software/plugins/raspberry-pi-linux/` — manifest, README, skills raspberry-pi-projects and raspberry-pi-tasks,
  `scripts/pi_tool.py` (entry), `scripts/pi_support/` (`cli`, `registry`, `project`, `ssh`, `remote`, `operations`,
  `report`, `lifecycle` and `workspace` shared), `scripts/remote/vera_pi_remote.py` (board-side helper, stdlib only).
- `05_Software/tests/plugins/raspberry-pi-linux.test.ts`, `tests/support/pi-test-sshd.py` (asyncssh server running
  exec requests as `sh -c` on this Linux host or in WSL, logging auth and exec), `tests/support/pi-test-agent.py` (SSH agent
  on a named pipe or Unix socket), `tests/fixtures/raspberry-pi-linux/project/`.

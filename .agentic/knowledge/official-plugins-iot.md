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
dispatch, registry.py the linux-board entries, project.py vera-pi.json and its files, ssh.py host-key trust, login keys
and remote calls, remote.py the two constant commands, operations.py every operation, report.py) and the
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

- `raspberry-pi-linux` 0.3.0, ecosystem `linux` (Arduino pack, group "Raspberry Pi Linux projects", default off;
  activities `testing`, `debug`), Windows x64 and Linux x64; VERA stays on the host and reaches the board over SSH.
  Program `pi-tool` = `scripts/pi_tool.py` (PEP 723, `asyncssh==2.24.1`, `cryptography==49.0.0`,
  `typing-extensions==4.16.0`), env `PI_REGISTRY`, `resources {option: --board, kinds: [linux-board], grace: 10,
  cleanup: [stop-owned], cleanupTimeout: 60}`, `sshAgent: true`, timeout 120 s. Rules: capabilities, inspect-project,
  report safe; check-host-key, identify, compare, task-status, service-status, collect-logs, fetch device-read;
  trust-host-key, install-helper, deploy (1800 s), deploy-candidate, apply-candidate (600 s), run-task and exec
  (3600 s), service-start/stop (1800 s), stop-owned device-write; deploy and apply-candidate `--overwrite`
  irreversible. A board entry needs host and user only (port 22, root `~/vera-projects` created by the helper).
  Host key (ssh.py `trust`): the entry's hostKeys, else the key saved in `lab/linux-board-keys.json` (keyed
  `host:port`), else `~/.ssh/known_hosts`, else first use: accepted and saved (`host-key-saved`); another key is
  `host-key-changed` before authentication until `trust-host-key`. Algorithms of the trusted keys are asked for
  first, then Ed25519, ECDSA, RSA, and each other kind is tried before a key counts as changed (a board holds one key
  of each kind and shows the one asked for first). Login (`_keys`): agent keys when an agent answers, then the keys
  of `~/.ssh` without a passphrase, at most six; `agentKey` restricts to one agent key; `$PI_SSH_DIR` replaces
  `~/.ssh` in tests; codes `no-key`, `agent-unavailable`, `agent-key-missing`, `auth-failed`, `unreachable`,
  `timeout`; `~/.ssh/config` is not read. Exec requests are only `/usr/bin/python3 -I -c '<install stub>'` and
  `... '<run stub>'` built from the helper version and SHA-256; requests and file bytes go on stdin. `Session.call`
  installs the helper once on `helper-missing`/`helper-changed` (`helper-installed`). The helper checks the login user
  (not root), each declared serial/machine id/model (`identity-mismatch`) and the root (created when missing; not a
  link, owned, not world-writable: `root-invalid`); it uses `$HOME` for the default root and the account's home for
  systemd units. vera-pi.json: name, files (folders expand, `exclude` names or fnmatch patterns, `.venv`,
  `__pycache__`, `.git` never, no `..`/absolute/backslash/`.vera-pi`/links, 512 files, 16 MiB each, 64 MiB; a `#!`
  file with CR LF is sent with LF), `requirements`, hardware, tasks (argv[0] a project file, an absolute path or a
  program on PATH, else `command-not-found`; budgetS 1-3500 default 600, output 1 KiB-16 MiB, extraArgs, actuates) and
  services (user `.service` units, `file` = the unit file to install). `_deploy` (deploy, run-task, service-start):
  helper op `plan`, then `deploy` (= stage + apply in one helper call) with the bytes of only new and changed files;
  conflicts stay unless `--overwrite`; unchanged files get their mode repaired. `_venv`: when `requirements` is new or
  changed, a supervised shell command `setup` creates `.venv` (`--system-site-packages`), runs pip and writes the
  file's hash to `.venv/.vera-requirements` (`setup-failed`). `_supervise` runs a task (`argv`) or an `exec` command
  (`shell`, bash else sh) through helper `task-start`: a detached supervisor (new session) starts it in its own
  process group with the project's `.venv/bin` first on PATH and `PYTHONUNBUFFERED=1`, copies stdout/stderr up to the
  limit, ends the group at budget/limit/stop file (SIGTERM, SIGKILL after 3 s) and records handle, PID, `/proc` start
  time, boot id and the end; task-start prunes finished task folders beyond 20. pi-tool polls `task-wait` with log
  offsets and writes the new output to stderr (stdout carries the one result document), forwards VERA's stop file
  (remote `confirmed` or `unknown`), and on a lost connection ends `connection-lost` with remote unknown; stop-owned
  retries an unreachable board 3 times, 3 s apart. States exited, budget-exceeded, output-limit, stopped,
  start-failed, supervisor-lost, lost-by-reboot (never signalled). Results show a short log whole, else head and tail.
  Services: listed units only (`service-not-allowed`); start installs the unit `file` into
  `~/.config/systemd/user`, turns lingering on for keepRunning (`loginctl enable-linger`, else `sudo -n`), restarts
  and enables; stop also disables a keepRunning unit; a oneshot that ended well passes with warning `exited`.
  collect-logs reads `journalctl --user -u UNIT`, else `--user-unit=UNIT` (`journal-empty` when neither has lines).
  identify adds `health` (temperature, `vcgencmd get_throttled` decoded, memory, disk, load, uptime, running tasks)
  with warnings `under-voltage`, `hot`, `disk-low`. fetch copies one file (8 MiB) into the run folder with a text
  preview. Run folders (`raspberry-pi-results/<run-id>`) only for operations that leave files. deploy-candidate and
  apply-candidate remain as the two-step deploy with a candidate.json bound by hash. Evidence: the local asyncssh
  test server with commands in WSL Ubuntu 24.04 (systemd user manager); no Raspberry Pi, no real OpenSSH server,
  native Ubuntu not run; throttling, the system-journal fallback and linger through sudo are unexercised.

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

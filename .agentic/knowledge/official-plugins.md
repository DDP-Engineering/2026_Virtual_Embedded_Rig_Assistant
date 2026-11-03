# Official plugins

## Routing

Select for the plugin packages VERA maintainers ship in `05_Software/plugins/<id>/`: their `plugin.yaml`
programs and rules, helper scripts, Agent Skills and README; today `serial-monitor` (program `serial`: list
serial ports with board family, capture a console with an optional DTR/RTS reset, send one line; skills
`serial-console` and `esp32-identify`). Start at `05_Software/plugins/serial-monitor/plugin.yaml` and
`scripts/serial_monitor.py`; tests are in `05_Software/tests/integration/serial-monitor.test.ts` with fixtures in
`05_Software/tests/fixtures/serial-monitor/`. The platform that installs, classifies, approves and runs these
programs (store, provisioner, rules, gate, runner, serial-port guard, run_program) is [Plugins](plugins.md);
plugin skill discovery is [Skills](skills.md).

## Purpose and boundaries

Each folder is an ordinary plugin package in format 1 that the user installs from the folder (`vera plugin
install --path`, IPC `plugins.install`) and enables per workbench; nothing bundles them into the VERA package or
installs them automatically yet (catalog and bundling: PLG-07). A package holds content only: a manifest, PEP 723
scripts that the provisioner runs with the bundled uv, and Markdown skills. Platform behaviour such as risk
policy, approvals, timeouts and the serial-port guard is not repeated in the packages.

## Public interface

- `serial-monitor` 1.0.0, ecosystem `general`, platforms `windows-x64`, `linux-x64`, program `serial` with
  `install: { script: scripts/serial_monitor.py }` (pyserial 3.5), probed with `--version`
  (`serial-monitor <version>`).
- Commands (spec `.agentic/specs/REQ-FUNC-42818bb7.md`): `serial list` prints a JSON array of `{port, vid_pid,
  serial_number, family, description, by_id}` sorted by port; `serial capture --port P [--baud 115200]
  [--duration 10] [--until REGEX] [--max-bytes 1048576] [--reset]` streams console bytes to stdout and ends with
  `[serial-monitor] P: N bytes, stopped by duration|until|max-bytes` on stderr; `serial send --port P --text LINE
  [--eol crlf|lf|cr|none] [--duration 1] ...` writes one line, then reads like capture.
- Exit codes: 0 done, 2 invalid arguments (no port opened), 3 port failure (EACCES adds the `dialout`/`uucp`
  instruction, others a list-again hint), 4 `--until` never matched.

## Invariants

- Rules: `serial {--version,--help,-h}` and `serial list *` are `safe`, `serial capture *` is `device-read` with a
  reset note, `serial send *` is `device-write` with a firmware note; any other command line keeps the platform's
  unmatched default `device-write`.
- `list` never opens a port. Capture and send open with DTR asserted and RTS released, then release DTR, so the
  lines never pass through the reset state DTR released + RTS asserted (Linux raises both lines on open; POSIX
  also `exclusive=True`); only `capture --reset` asserts RTS (200 ms, DTR re-applied after each RTS change for
  Windows usbser.sys) and clears the input buffer before releasing RTS, so the new boot output is kept.
- Any exception from the port (SerialException; OSError or termios.error on Linux; ValueError for an unsupported
  setting) is exit 3 with
  the bytes already read kept.
- Console bytes reach stdout unchanged and flushed per read, so background runs stream to `program_output`.
- `--until` is searched in each complete line and the current partial line (at most its last 4096 characters),
  decoded as UTF-8 with replacement characters and without a trailing CR.
- The script is not named `serial.py`: that name would make `import serial` load the script itself.
- The installed copy must not change after install (integrity hash): tests run installed copies with
  `PYTHONDONTWRITEBYTECODE=1`, and `uv run --script` executes the file as `__main__` without a bytecode cache.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Risk rules or notes | `plugins/serial-monitor/plugin.yaml` `rules` | `serial-monitor.test.ts` "risk rules" |
| Family table, list fields, by-id | `serial_monitor.py` `FAMILIES`, `list_command`, `by_id_links` | "list" tests; `fixtures/serial-monitor/by_id.py` |
| Capture/send stop conditions, reset, exit codes | `serial_monitor.py` `read`, `reset`, `main`, `fail` | "capture", "send", "failures" tests |
| Agent guidance | `skills/serial-console/SKILL.md`, `skills/esp32-identify/SKILL.md` | "offers the plugin's skills" test |
| Fake port behaviour for tests | `fixtures/serial-monitor/fake-pyserial/serial/` | the whole file |

## Key behaviors

- `REQ-FUNC-b7ceddbc` — the folder installs without issues; `serial` resolves to `uv run --quiet --offline --script <installed>/scripts/serial_monitor.py`.
- `REQ-FUNC-3e33dbe8` — `--version` prints the manifest version for the probe.
- `REQ-SEC-79b6adad` / `REQ-SEC-22dd5e18` / `REQ-SEC-5fd0ed52` — list/help safe, capture device-read, send device-write.
- `REQ-FUNC-e80e3dd7` / `REQ-FUNC-742426ac` / `REQ-PLAT-19d5189a` — JSON list without opening, family table, Linux by-id.
- `REQ-FUNC-42818bb7` / `REQ-FUNC-3ee59f30` / `REQ-REL-46027e04` — capture stop conditions and summary, RTS reset, exit 4.
- `REQ-FUNC-6f7569e2` — send one line, then read the reply.
- `REQ-PLAT-4013192c` / `REQ-REL-3c25e5c0` / `REQ-FUNC-0a001d5d` — EACCES group instruction, other failures, usage errors.
- `REQ-UX-7dc52524` — skills `serial-console` and `esp32-identify`.
- `REQ-TEST-4041b893` — a replay session lists without approval and captures after approval through the real runner.
- `REQ-PLAT-f215472a` — real ESP32-S3 and ESP32+CP210x boards on Windows 11 and Ubuntu (manual).
- `REQ-SEC-016c9aad` (Plugins) — a background capture makes another run naming its port BUSY.

## Files

- `05_Software/plugins/serial-monitor/plugin.yaml` — manifest: program `serial`, version probe, rules, docs.
- `05_Software/plugins/serial-monitor/scripts/serial_monitor.py` — PEP 723 script: list, capture, send.
- `05_Software/plugins/serial-monitor/skills/serial-console/SKILL.md` — how to use the program.
- `05_Software/plugins/serial-monitor/skills/esp32-identify/SKILL.md` — identifying ESP32 boards and bridges.
- `05_Software/plugins/serial-monitor/README.md` — catalog description.
- `05_Software/tests/integration/serial-monitor.test.ts` — package, rules, script behaviour, guard, replay session, skills.
- `05_Software/tests/fixtures/serial-monitor/fake-pyserial/` — fake `serial` package driven by `FAKE_SERIAL_SCENARIO`, recording to `FAKE_SERIAL_RECORD`.
- `05_Software/tests/fixtures/serial-monitor/by_id.py` — runs `list` with a test by-id folder.
- `05_Software/tests/fixtures/serial-monitor/esp32s3-boot.log` — sample ESP32-S3 boot log.

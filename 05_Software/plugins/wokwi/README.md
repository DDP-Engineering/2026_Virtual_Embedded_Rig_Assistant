# wokwi

Firmware simulation jobs and finite scenarios in Wokwi's cloud. Two programs:

- `wokwi-cli`: the official wokwi-cli 0.29.1, downloaded from its GitHub release and checked by SHA-256. It is never
  run directly: it would upload whatever its project folder holds, and it also offers an MCP server.
- `wokwi-tool`: a PEP 723 script (PyYAML 6.0.3) that VERA installs with its own uv and that runs wokwi-cli for you.

A Wokwi run is a cloud simulation of the firmware and diagram. It is not an offline test, not an electrical test and
not a test on the real board. Wokwi counts simulation time against your account's plan; VERA cannot read the plan or
the remaining quota. This plugin has been tested offline only (a scripted stand-in for wokwi-cli, and the real
wokwi-cli for its version, offline linter and argument checks); no live cloud run has been made with it yet.

## The Wokwi token

Get a CI token from your Wokwi dashboard. It never goes into the project, `workbench.yaml`, the prompt, arguments,
logs or results.

- Desktop: **Plugins > wokwi > Configuration** stores a reference (for example `ci`) and the token in VERA's credential store
  (encrypted by the operating system; unprotected only with your consent).
- CLI: `VERA_WOKWI_TOKEN_CI` (the reference upper-cased, `-` as `_`), held in memory for that run.

A job names the reference as its account; `run-scenario --credential ci` must name the same one. When you approve the
run, VERA reads the token at that moment and writes it as one line to wokwi-tool's input. wokwi-tool gives it only to
the one wokwi-cli process it starts, as `WOKWI_CLI_TOKEN` in that process's environment (wokwi-cli reads it from
nowhere else), and removes every other `WOKWI_*` variable, so the token always goes to `wss://wokwi.com`. Disabling
the plugin revokes this: a run approved earlier is refused before anything is read.

## Operations

| Operation | Risk | What it does |
|---|---|---|
| `capabilities` | safe | Versions, firmware forms, scenario commands, limits, endpoint. |
| `inspect-project --project DIR` | safe | wokwi.toml, firmware and ELF (form, size, SHA-256, origin: an arduino-tool compile run, a PlatformIO environment, an ESP-IDF build), diagram parts and board, problems. Writes nothing. |
| `validate-diagram --diagram FILE` | safe | Structural checks and `wokwi-cli lint --offline`. |
| `prepare-job --project DIR --account REF --virtual-timeout-ms N ...` | safe | A new folder in `arduino-iot-results/` with exact copies under `send/`, a generated `wokwi.toml`, `job.json` and `job.md`: the files that will be sent, the account, the board, the limits and the time budget. The project is not changed. |
| `run-scenario --job FILE --credential REF` | irreversible | Sends the job's diagram, firmware and ELF to Wokwi and runs it once. |
| `collect-results --run DIR` | safe | Derives a run's outcome again from its records. |
| `report --run DIR ...` | safe | `report.json`, `report.md`, `report.html` and `junit.xml` in a new folder. |

Jobs accept `.hex`, `.bin`, `.uf2`, `.elf` and ESP-IDF `flasher_args.json` firmware, exactly one board in the diagram,
and either a scenario or `--expect-text` (plus an optional `--fail-text`). Custom chips, SD cards, GDB and RFC 2217
servers are refused: they would add files to the transmission or open local ports.

## Results

Every run states the outcome separately from the status: `passed` (pass); `virtual-timeout`, `fail-text`,
`assertion-failed` (fail); `auth-failed`, `network-error`, `api-error`, `cli-failed` (error); `connection-lost`,
`stopped`, `real-budget-exceeded`, `output-limit`, `interrupted` (incomplete). A timeout is never a pass. Virtual time
(simulated nanoseconds, the `--virtual-timeout-ms` limit) and real time (wall-clock seconds, the `--real-budget-s`
budget) are recorded apart.

The remote state is `not-started` when Wokwi refused the connection, `closed-by-client` when wokwi-cli closed its
session at the end, and otherwise `unknown`. wokwi-cli 0.29.1 has no job-cancel command: on Stop, a real-time budget
or an output bound, wokwi-tool asks wokwi-cli to close its connection, the only end it can send, and Wokwi's end of
the job and of its billing is never confirmed. On Windows VERA's Stop ends the helper at once; `collect-results` then
reports the run `interrupted`. A run is never repeated automatically; wokwi-cli itself retries a refused connection
(HTTP 408, 503, 524) up to five times, which the result counts.

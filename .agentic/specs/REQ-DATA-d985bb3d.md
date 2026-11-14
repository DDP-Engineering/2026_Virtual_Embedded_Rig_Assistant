# wokwi-tool: operations, job, results, outcomes and exit codes

Governs REQ-DATA-d985bb3d and the wokwi plugin requirements that name this spec. The host credential hand-off it
uses (scope `wokwi`) is specified in `specs/REQ-DATA-96d18686.md` section 1.

## 1 Programs

- `wokwi-cli`: the official wokwi-cli 0.29.1 (sha `0aa185144b92`), downloaded from its GitHub release by SHA-256
  (`wokwi-cli-win-x64.exe` 45292e3c4f32ba4cfbcc7a457a6df48aad95fdb3269a218cb83423da9dc483b2,
  `wokwi-cli-linuxstatic-x64` 3c9d6da007d008a3822ab468318037285440055132c59fd659d7306e40f14258). Every direct command
  is blocked; it also offers `init`, `chip` and an MCP server.
- `wokwi-tool`: a PEP 723 script (pyyaml 6.0.3) that `uses: [wokwi-cli]`, so it receives the CLI path in
  `VERA_PROGRAM_WOKWI_CLI`, and declares `credentials: {option: --credential, scope: wokwi}`.

wokwi-tool refuses (blocked, `cli-unavailable`) when `VERA_PROGRAM_WOKWI_CLI` names no file, and (`cli-version`)
when `wokwi-cli --short-version` does not print `0.29.1 (0aa185144b92)`: a CLI found on PATH gets the token too, so
only the official build is accepted. Every wokwi-cli child gets a fixed environment: the
helper's own variables minus every `WOKWI_*` variable, plus `NO_COLOR=1`; only run-scenario adds
`WOKWI_CLI_TOKEN`. `WOKWI_CLI_SERVER` is never set, so the CLI always uses `wss://wokwi.com/api/ws/beta`.

## 2 Command line

```text
wokwi-tool --version | --help
wokwi-tool capabilities
wokwi-tool inspect-project --project DIR [--firmware FILE] [--elf FILE]
wokwi-tool validate-diagram --diagram FILE
wokwi-tool prepare-job --project DIR --account REF --virtual-timeout-ms N [--firmware FILE] [--elf FILE]
           [--diagram FILE] [--scenario FILE] [--expect-text TEXT] [--fail-text TEXT] [--real-budget-s N]
           [--vcd] [--screenshot-part ID --screenshot-ms N] [--results-dir DIR] [--run-id ID]
wokwi-tool run-scenario --job FILE --credential REF [--results-dir DIR] [--run-id ID]
wokwi-tool collect-results --run DIR
wokwi-tool report --run DIR [--run DIR ...] [--results-dir DIR] [--run-id ID]
```

Paths follow the shared workspace rules (inside the working directory by their text, never `.vera`). Run folders are
`<results-dir>/<run-id>` (default `arduino-iot-results`, run id generated), created exclusively. Exit codes: 0 pass,
1 fail, 2 blocked (refused before anything was sent), 3 incomplete or error. stdout carries one JSON document of at
most 11000 characters; the full documents are in the run folder.

## 3 Project inputs

- `wokwi.toml`: TOML, table `[wokwi]` with `version = 1` and `firmware` (string); optional `elf` (string). Any other
  key of `[wokwi]` (`gdbServerPort`, `rfc2217ServerPort`) or any other table (`[[chip]]`, `[[sdcard]]`) ends
  `unsupported-input`: they add files or open local ports. `--firmware`/`--elf` override the file's values; without
  `wokwi.toml` both come from the options. Paths are relative to the project folder.
- Firmware forms: `.hex` (first non-empty line starts with `:`), `.bin`, `.uf2` (first 4 bytes `UF2\n`), `.elf` (first
  4 bytes `\x7fELF`) and ESP-IDF `flasher_args.json` (object `flash_files` of 1-16 hex offsets to paths relative to
  that file; each must be a regular file inside that file's folder). Another extension ends `unsupported-input`; content that does
  not match its extension ends `firmware-invalid`. At most 32 MiB per file and 64 MiB in total.
- `--elf` must start with `\x7fELF` (`firmware-invalid`). An ELF firmware is also the ELF.
- Origin (reported, never trusted for identity): `arduino-cli` when the file lies in a folder whose `result.json` has
  `operation` `compile` and lists the file in `binaries` with the same SHA-256 (with `fqbn` and the run id);
  `platformio` when the path contains `.pio/build/<env>/` (with `environment`); `esp-idf` when the file's folder or a
  parent up to the project holds `project_description.json` (with `target` when present); else `unknown`.
  `buildMatch` is `same-run` (both files in one arduino-tool result), `same-folder` (same folder) or `unverified`.
- `diagram.json` (default `<project>/diagram.json`): JSON object, `version` 1, `parts` a list of 1-512 objects with
  unique string `id` and string `type`, `connections` a list of `[from, to, ...]` with `from`/`to` of the form
  `<part-id>:<pin>` naming a listed part or `$serialMonitor:<pin>`. Boards are parts whose type starts with
  `wokwi-arduino-`, `board-`, `wokwi-esp32`, `wokwi-pi-pico` or `wokwi-stm32`. prepare-job needs exactly one board.
- Scenario (YAML, at most 256 KiB): mapping with string `name`, `version` 1, optional string `author` and 1-1000
  `steps`; each step a mapping with exactly one command key and an optional string `name`. Supported commands:
  `delay` (string matching the CLI's time syntax `<number><ns|us|ms|s>`), `wait-serial` (string, 1-1024 characters),
  `write-serial` (string, 1-1024 characters), `set-control` (`part-id`, `control`, numeric `value`), `expect-pin`
  (`part-id`, `pin`, `value` 0 or 1); the deprecated spellings `name` for `control`/`pin` are accepted. Every `part-id`
  must be a diagram part. Structural faults end `scenario-invalid`; a command of wokwi-cli 0.29.1 this tool does not
  support (`take-screenshot`, `expect-chip-output`, `touch`, `touch-press`, `touch-release`, `touch-move`) or any other
  key ends `unsupported-input`.
- Assertions: a job needs a scenario or `--expect-text` (`assertion-missing`), not both (`unsupported-input`: the CLI
  ends at whichever finishes first). `--fail-text` may accompany either. Texts are 1-256 characters without control
  characters.
- Limits: `--virtual-timeout-ms` 100-600000 (simulated milliseconds); `--real-budget-s` 10-1800, default
  `min(1800, max(60, 30 + 4 * ceil(virtual / 1000)))` (wall-clock seconds); `--screenshot-ms` 0 to the virtual timeout.

## 4 Operations

| Operation | Effect |
|---|---|
| capabilities | Offline. Tool and CLI versions, supported firmware forms, scenario commands, limits, endpoint. |
| inspect-project | Offline, writes nothing. wokwi.toml facts, firmware and ELF with path, form, bytes, SHA-256 and origin, diagram parts and boards, scenario files found (`*.yaml` beside wokwi.toml), problems. |
| validate-diagram | Offline, writes nothing. The structural checks of section 3 and `wokwi-cli lint --offline <diagram>`; each lint line `✗|⚠|ℹ [rule] message (part)` becomes `{severity, rule, message, part}`. `pass` without errors, `fail` with any structural or lint error. |
| prepare-job | Offline. Validates everything of section 3 and lints the diagram (errors end `diagram-invalid`), then writes a new run folder (section 5). Nothing in the project changes. |
| run-scenario | Cloud. Section 6. |
| collect-results | Offline. Re-derives the outcome of a run-scenario folder from its records (section 7) and rewrites its `result.json`. |
| report | Offline. Writes a new folder with `report.json`, `report.md`, `report.html` and `junit.xml` (one testcase per run). |

## 5 Job folder

`<run>/send/` holds exact copies: `diagram.json`, `firmware.<ext>` (or `flash/` with `flasher_args.json` and its files
at their relative paths), `firmware.elf` when an ELF exists and the firmware is not one, `scenario.yaml` when given,
and a generated `wokwi.toml` (`version = 1`, `firmware`, `elf`; nothing else). `<run>/job.json`:

```json
{"format": 1, "kind": "wokwi-job", "tool": "wokwi-tool 1.0.0", "runId": "...", "createdAt": "...",
 "cli": {"version": "0.29.1", "sha": "0aa185144b92"}, "endpoint": "wss://wokwi.com/api/ws/beta",
 "account": "<ref>", "board": {"id": "uno", "type": "wokwi-arduino-uno"},
 "firmware": {"form": "hex", "origin": {...}, "buildMatch": "same-run"},
 "files": [{"role": "diagram|firmware|flash|elf|scenario|config", "path": "send/...", "source": "<project path>",
            "sha256": "...", "bytes": 0, "transmitted": true}],
 "transmittedBytes": 0,
 "assertions": {"scenario": {"name": "...", "steps": 3} , "expectText": null, "failText": null},
 "limits": {"virtualTimeoutMs": 5000, "realBudgetS": 60, "attempts": 1},
 "outputs": {"serialLog": true, "vcd": false, "screenshot": null},
 "usage": "Wokwi counts simulation time against the account's plan; VERA cannot read the plan or the remaining quota."}
```

Transmitted are the diagram, the firmware (flash sections) and the ELF; the scenario, `wokwi.toml` and the texts stay
on this computer, where wokwi-cli evaluates them. `job.md` shows the same as a list for the user.

## 6 run-scenario

1. Reads `--job`, refuses (`job-invalid`) another kind or format, or a field of another form than prepare-job writes
   (limits, account, board, firmware form, assertions with exactly one of scenario and expected text, texts, outputs,
   screenshot). Verifies (`job-changed`) that `send/` holds exactly the fixed layout of section 5 for the job's firmware
   form, each file with its role, transmitted flag, size and SHA-256, no other entry or link, a `wokwi.toml` byte-equal
   to the one prepare-job generates, and flash files equal to those `flasher_args.json` names. Checks the copies again
   (`job-invalid`: diagram structure with exactly the job's board, screenshot part; the scenario as in section 3, with
   its own codes). Refuses (`credential-mismatch`) when `--credential` is not the job's `account`; checks the CLI
   (section 1) and lints the copied diagram (`job-invalid` on errors). All before stdin is read; a stop signal that
   arrives before wokwi-cli starts ends blocked `stopped` with nothing sent.
2. Reads the stdin line `{"format":1,"scope":"wokwi","ref":"<ref>","password":"<token>"}` (64 KiB at most;
   `credential-missing` when absent or not that form, `credential-mismatch` when the ref differs).
3. Creates the run folder and writes `result.json` with status `incomplete`, code `running`, then starts
   `wokwi-cli send --timeout <virtual> --timeout-exit-code 42 --serial-log-file <run>/serial.log --no-sdcard
   [--scenario scenario.yaml | --expect-text T] [--fail-text T] [--vcd-file <run>/trace.vcd]
   [--screenshot-part=ID --screenshot-time MS --screenshot-file <run>/screenshot.png]` (texts and the part as
   `--option=value`) with the job folder as working
   directory (the CLI resolves the scenario against `send/`; output paths are absolute), stdin closed and `WOKWI_CLI_TOKEN` only in that child's environment. The token is in no argument.
4. Watches every 200 ms: the real budget, `serial.log` at most 16 MiB and stdout/stderr at most 4 MiB each (kept as
   `cli-stdout.log`, `cli-stderr.log`), and a stop signal (SIGTERM, SIGINT or SIGBREAK to the helper). On any of them it
   asks the CLI to stop (CTRL_BREAK_EVENT to its own process group on Windows, SIGTERM elsewhere; the CLI then closes its
   WebSocket, the only end the API offers), waits 5 s and kills it.
5. Writes `exit.json` `{exitCode, endedAt, reason: exited|real-budget|output-limit|stopped|not-started, elapsedS,
   attempts: 1}` (`not-started`: wokwi-cli could not be started at all),
   then collects (section 7). The token is replaced by `[redacted]` in every byte written from the CLI's output, and no
   file or stdout document holds it. The run is never repeated.

## 7 Outcomes

Derived from `exit.json`, `cli-stderr.log` and, for `Giving up`, retries and the API version, also `cli-stdout.log`
(first matching row):

| Condition | Outcome | Status | Remote |
|---|---|---|---|
| no `exit.json` | interrupted | incomplete | unknown |
| reason not-started | cli-failed | error | not-started |
| reason real-budget | real-budget-exceeded | incomplete | unknown |
| reason output-limit | output-limit | incomplete | unknown |
| reason stopped, exit code >= 128 or no exit code | stopped | incomplete | unknown |
| exit 0 | passed | pass | closed-by-client |
| exit 42 and `Timeout: simulation did not finish` | virtual-timeout | fail | closed-by-client |
| exit 1 and `Unexpected text found` | fail-text | fail | closed-by-client |
| exit 1 and `Error: [<n>ns]` | assertion-failed | fail | closed-by-client |
| exit 1 and `Error connecting to` with ` 401 ` or ` 403 ` | auth-failed | error | not-started |
| exit 1 and `Error connecting to` or `Giving up` | network-error | error | not-started |
| exit 1 and `closed unexpectedly` | connection-lost | incomplete | unknown |
| exit 1 and `API Error:` | api-error | error | unknown |
| exit 1 and `Missing WOKWI_CLI_TOKEN` | credential-missing | blocked | not-started |
| anything else | cli-failed | error | unknown |

`remote` is `{state, confirmed, cancel}`: `not-started` (confirmed true: the connection was refused before a session),
`closed-by-client` (the CLI closed its session at the end; confirmed false) or `unknown` (confirmed false); `cancel` is
`not-requested` or `connection-closed-requested` (no API cancel exists in wokwi-cli 0.29.1, so the server's end of the
job and of its billing is never confirmed). `time` is `{virtual: {timeoutMs, reachedNs}, real: {budgetS, startedAt,
endedAt, elapsedS}}`: `reachedNs` is the `[<n>ns]` of an assertion failure or the timeout for virtual-timeout, else
null. `connectRetries` counts the CLI's `Will retry in` lines (wokwi-cli retries HTTP 408/503/524 up to 5 times).
`api` holds the `Connected to Wokwi Simulation API <version>` version or null. `artifacts` lists each output file with
its bytes and SHA-256. The result repeats the job's id, job.json SHA-256, board and firmware hashes.
`result.json` kind `wokwi-run`, format 1. Every result says it is a cloud simulation, not an electrical or board test.

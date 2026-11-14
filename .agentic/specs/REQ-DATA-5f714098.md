# hil-testing: HIL plan, compilation, approval binding, execution and result

Governs REQ-DATA-5f714098 and the requirements of TASK-789dcc82 that name this spec. Reused contracts: bench registry
and leases `.agentic/specs/REQ-DATA-f2cbfc23.md`; scpi results `.agentic/specs/REQ-DATA-b3e2930f.md`; lab-validate
`.agentic/specs/REQ-DATA-53797d16.md`; run_program approvals `.agentic/specs/REQ-FUNC-80b2033a.md`.

## 1 Entry points

The `hil-testing` plugin declares program `hil` with the manifest program field `plan: hil`. For such a program VERA
core handles two operations itself instead of starting the executable:

| Call (`run_program`) | Effect | Risk |
|---|---|---|
| `hil check <plan>` | compiles the plan and returns the expansion (section 4) as JSON; no device I/O, nothing written | safe |
| `hil run <plan>` | compiles, asks one approval for the expansion, executes it (section 6) | highest compiled risk (section 5) |

Every other `hil` argument list starts the helper normally under the manifest rules: `hil --version`, `hil report --run
DIR` (section 8). `<plan>` is one workbench file, exactly one further argument, given relative to the workbench root; a
`hil check`/`hil run` with any other argument shape, a `cwd` other than the root or a run_program `timeout` (the budget
limits a plan) is refused before any approval. `run` may run in the background
(`program_output`, `program_stop`), like any run_program call.

`hil check` answers exit 0 with the expansion, or exit 2 with `{"format": 1, "kind": "hil-plan-check", "valid": false,
"problems": [{"path": "steps.2.with.port", "message": "..."}]}`. `hil run` refuses the call with the first problem's
message (no approval, nothing written).

## 2 Plan (format 1)

A JSON file of at most 256 KiB, UTF-8, unique keys; every object is strict (an unknown key is a problem).

```json
{"format": 1,
 "id": "blinky-smoke",
 "title": "Blinky smoke test on NUCLEO-F401RE",
 "setup": {
   "board": "NUCLEO-F401RE", "revision": "C-03",
   "description": "ST-LINK V2-1 on USB, its virtual COM port is the board's USART2; scope CH1 on PA5",
   "wiring": ["scope CH1 -> PA5 (LD2)", "scope GND -> CN7 pin 8"],
   "firmwareEffect": "device-read",
   "effectNote": "The firmware toggles LD2 and answers on USART2; nothing else is connected.",
   "interlocks": []},
 "firmware": {"path": "build/blinky.elf", "sha256": "<64 hex>", "format": "elf"},
 "budget": {"seconds": 300},
 "steps": [
   {"id": "probe", "phase": "setup", "use": "probe-rs.list", "expect": "0483:374b:066DFF"},
   {"id": "flash", "phase": "setup", "use": "probe-rs.flash", "with": {"probe": "0483:374b:066DFF", "chip": "STM32F401RETx"}},
   {"id": "verify", "phase": "setup", "use": "probe-rs.verify", "with": {"probe": "0483:374b:066DFF", "chip": "STM32F401RETx"}},
   {"id": "boot-log", "use": "serial.capture", "background": true,
    "with": {"port": "COM5", "baud": 115200, "duration": 10, "until": "^READY$"}},
   {"id": "reset", "use": "probe-rs.reset", "with": {"probe": "0483:374b:066DFF", "chip": "STM32F401RETx"}},
   {"id": "boot", "use": "await", "with": {"step": "boot-log"}},
   {"id": "ping", "use": "serial.send", "retries": 2,
    "with": {"port": "COM5", "baud": 115200, "text": "ping", "until": "^pong$", "duration": 2}},
   {"id": "cap", "use": "scpi.capture", "with": {"instrument": "scope", "channel": "CHAN1"}},
   {"id": "led", "use": "lab-validate.compare", "with": {"request": {"format": 1, "title": "LD2 blink",
     "decisionRule": "simple", "missingData": "incomplete",
     "sources": {"scope": {"importer": "scpi-capture", "step": "cap"}},
     "signals": {"led": {"source": "scope", "channel": "CHAN1"}},
     "measurements": [{"id": "f", "signal": "led", "metric": "frequency", "window": {"from": "0 s", "to": "2 s"}}],
     "criteria": [{"id": "C1", "value": "f", "op": "==", "limit": "1 Hz", "tolerance": "5 %"}]}}}],
 "cleanup": [{"id": "halt", "use": "probe-rs.reset", "with": {"probe": "0483:374b:066DFF", "chip": "STM32F401RETx"}}]}
```

| Field | Rule |
|---|---|
| `format` | `1` |
| `id` | `[a-z0-9][a-z0-9-]{0,63}`; the typed confirmation word of an irreversible plan |
| `title` | 1-200 characters |
| `setup.board` | 1-80, `setup.revision` 1-40, `setup.description` 1-1000 characters: the active configuration |
| `setup.wiring` | 0-32 entries of 1-200 characters |
| `setup.firmwareEffect` | `device-read`, `device-write` or `irreversible`: what the running firmware does outside the chip (required) |
| `setup.effectNote` | 1-500 characters: the effect in words (required) |
| `setup.interlocks` | optional, 0-16 entries of 1-200 characters (hardware interlocks or watchdogs of the setup) |
| `firmware.path` | an existing regular workbench file of at most 64 MiB |
| `firmware.sha256` | 64 hex; must equal the file's SHA-256 at compile time |
| `firmware.format` | `elf`, `hex` or `bin`; `bin` needs `firmware.address` (`0x` + 1-8 hex digits) |
| `budget.seconds` | 1-3600: the running phase's total time (steps), section 6 |
| `steps` | 1-64 steps; `cleanup` 0-16 steps |
| text | no control characters; ids `[a-z][a-z0-9-]{0,31}`, unique across `steps` and `cleanup` |

Step fields: `id`, `use` (a registered adapter, section 3), `phase` (`setup` or `test`, default `test`; cleanup steps
have none), `with` (the adapter's parameters, strict), `timeout` (1-3600 s, at most the operation's cap), `retries`
(0-5, repeatable adapters only), `repeat` (1-100, repeatable adapters only), `background` (true, background-capable
adapters only, not in `cleanup`), `expect` (a JavaScript regular expression of at most 256 characters, refused at compilation when invalid, tested, flag `m`, against
the last 12 000 characters of the step's output; at most 100 ms per test), `skip` (1-200 characters: a voluntary skip
with its reason; the step is compiled and shown, never run). The plan needs at least one `test` step. The total of
`repeat x (1 + retries)` over all steps is at most 256.

## 3 Adapters

A registry in core (`registerHilAdapter`); later plans add registrations. An adapter names the plugin program it runs
(declared by an enabled plugin), its parameters, the argument list it builds, and flags: `repeatable`,
`background`, `flashes` (writes the declared firmware), `resets` (starts the firmware). It never chooses a risk: the
program's own manifest rules classify the built command line.

| `use` | Program and arguments | Parameters | Flags |
|---|---|---|---|
| `probe-rs.list` | `probe-rs list` | none | repeatable |
| `probe-rs.flash` | `probe-rs download --probe P --chip C --non-interactive --binary-format F [--base-address A] <firmware>` | probe, chip | flashes |
| `probe-rs.verify` | `probe-rs verify --probe P --chip C --non-interactive --binary-format F [--base-address A] <firmware>` | probe, chip | repeatable |
| `probe-rs.reset` | `probe-rs reset --probe P --chip C --non-interactive` | probe, chip | resets |
| `esptool.identify` | `esptool --port P chip-id` | port | repeatable, resets |
| `esptool.flash` | `esptool --chip C --port P write-flash A <firmware>` (format `bin`) | port, chip | flashes, resets |
| `esptool.verify` | `esptool --chip C --port P verify-flash A <firmware>` (format `bin`) | port, chip | repeatable, resets |
| `serial.capture` | `serial capture --port P --baud B --duration D [--until R] [--reset]` | port, baud, duration, until?, reset? | repeatable (not with reset), background, resets with reset |
| `serial.send` | `serial send --port P --baud B --text T --eol E --duration D [--until R]` | port, baud, text, eol?, duration, until? | repeatable |
| `scpi.identify`, `scpi.status` | `scpi identify|status --instrument A --results-dir <step folder>` | instrument | repeatable |
| `scpi.read` | `scpi read --instrument A [--channel CH] --results-dir <step folder>` | instrument, channel? | repeatable |
| `scpi.capture` | `scpi capture --instrument A --channel CH --results-dir <step folder>` | instrument, channel | repeatable |
| `scpi.configure` | `scpi configure --instrument A --set N=V ... --results-dir <step folder>` | instrument, set (1-16 `NAME=VALUE`) | |
| `scpi.output` | `scpi output --instrument A --channel CH --voltage V --current I --hold S --results-dir <step folder>` | instrument, channel, voltage, current, hold | background |
| `scpi.close` | `scpi close --instrument A --results-dir <step folder>` | instrument | |
| `lab-validate.compare` | `lab-validate compare --request <step folder>.request.json --results-dir <step folder>` | request (object) | |
| `await` | no program: waits for an earlier background step | step | |

Parameter values: probe `VID:PID[:SERIAL]` or `VID:PID-INTERFACE` text; chip 1-64 of `[A-Za-z0-9_.-]`; port `COMn`
or `/dev/tty*`/`/dev/serial/by-id/*`; baud 1-4000000; duration 0.1-3600 s; until 1-256 characters; text 1-512
characters without control characters; eol `crlf`, `lf`, `cr` or `none`; instrument a registry alias; channel 1-16 of
`[A-Za-z0-9_]`; quantities numbers; hold 1-3500 s. A value starting with `-` (an option) is refused, and so is a firmware path whose workbench-relative form starts with `-`. `<step folder>` is
`embedded-lab-results/<run-id>/steps/<step id>` (scpi and lab-validate create their run folders inside it).

The `lab-validate.compare` request is a LAB-02 validation request in which each source has either `path` (a workbench
file or run folder, hashed at compile time; its SHA-256, of the file or of the folder's `result.json`, is written into
the generated request) or `step` (an earlier `scpi.capture` step; the executor names the capture folder that step's last
passing attempt created). The executor writes `<step folder>.request.json` before the step runs; lab-validate itself
validates the rest of the request at run time.

## 4 Compilation (`check`, and `run` before its approval)

Compilation reads the plan through the workbench path guard, validates it (section 2), checks the firmware hash, builds
each step's arguments through its adapter and prepares each operation exactly as `run_program` prepares a call of that
program (plugin enabled and issue-free, program resolvable, argument refusals, rule classification, workbench file
binding, registry aliases). Any problem refuses the whole plan before any process starts or any device is opened.

Further refusals: `await` naming a step that is not an earlier background step, or awaited twice; a background step
not awaited before the end of `steps` is allowed (it is stopped before cleanup, section 6); a step using a resource
(registry identity key, serial port, probe) that a still-running background step uses (no interleaving inside a plan);
`retries`/`repeat`/`background` on an adapter without the flag; an operation whose rule risk is `blocked`; a flash or
verify adapter whose format the firmware does not have; a `lab-validate.compare` source naming a step that is not an
earlier `scpi.capture`.

The expansion (`hil check` exit 0) is `{"format": 1, "kind": "hil-plan-check", "valid": true, "plan": {id, title, path,
sha256}, "setup": {...}, "firmware": {path, sha256, format, address?}, "risk", "confirm", "trial", "budgetSeconds",
"cleanupSeconds", "resources": [{"kind": "registry"|"serial"|"probe", "name", "keys"}], "files": [{path, sha256, use}],
"steps": [op], "cleanup": [op]}` where op is `{id, phase, use, plugin, program, args, risk, notes, files, timeout,
repeat, retries, background, expect?, skip?}`.

## 5 Risk and approval

The plan risk is the highest of: the `hil run` rule's own risk (device-read in the shipped manifest), every compiled
operation's rule risk (steps and cleanup, skipped steps included) and
`setup.firmwareEffect` when any step or cleanup step flashes or resets. `hil check` itself is safe. The approval is the
run_program approval of `hil run <plan>` (mode matrix, trial override, typed confirmation unchanged) with:

- `risk` the plan risk; `trial` true when `hil-testing` or any step's plugin is a trial plugin; `confirm` the plan id
  when the risk is `irreversible`, else null;
- `files` the plan file (its argument); `resources`/`registry` the registry aliases of all steps and the registry hash;
- `notes`, in order: the plan line, the setup (board, revision, description, wiring, interlocks, firmware effect and its
  note), the firmware (path, format, SHA-256), the budget and cleanup time, one line per step and per cleanup step
  (`<n> <id> [phase] <risk>: <command line>`, then each rule note of that operation, `retries`/`repeat`/`background`/
  `skip`), one line per bound file (`File: <path> <sha256> (<use>)`) and one per reserved serial port and probe;
- `plan` (hashed with the request, not shown): the run id, the plan path and hash, the firmware, the budget, every
  compiled operation's full run_program request and the reserved keys.

When the approval is consumed the plan is compiled again with the same run id; any difference (plan bytes, firmware,
another file a step names, the registry, a plugin's package, an executable) is CONFLICT and nothing runs. Before every
step operation starts, the plan file, the firmware and that operation's files are hashed again (a cleanup operation re-checks only its own files, so a rebuilt firmware never keeps the bench from being made safe); a difference ends the run
`error` with problem `changed` before that operation (section 6).

## 6 Execution

States: `prepared` (compiled), `awaiting-approval` (approval asked), `running`, `cleaning-up`, `done`; the terminal
status is one of section 7. A plan run is one VERA run (its own run record and log in `.vera/runs/`), holding:

- the plan lease: before the first step, every registry identity key, serial-port key (`serial:COM5`) and probe key
  (`probe:<selector lowercased>`) of all steps and cleanup steps is taken in the lease folder for the plan run, with
  `actuates` true when the plan risk is device-write or irreversible; another plan or registry claim in any VERA process
  gets BUSY through the lease folder, and so does any run of another session or of the same session outside the plan in
  this VERA process; a direct serial or probe run in another VERA process is not leased and not refused. In one VERA process the runner also refuses any run
  whose `--probe` value names a probe a plan holds (`probe:<value lowercased>`), and a plan while any unfinished run uses
  one of its serial ports. The plan's own operations run as child runs of the
  plan and borrow its leases; a child never takes or releases the plan's lease files.
- one step at a time, in order, except background steps, which run alongside until awaited or until the end of
  `steps`. A child run is a normal ProgramRunner run (log, record, timeout, Stop with grace and the program's declared
  cleanup for registry resources, physical state); background children count against the session's background limit.

Step timeout: the step's `timeout`, else the operation's cap (largest matching rule timeout, else program timeout,
else 600 s), never beyond the remaining budget. Budget: measured with a monotonic clock from `running`; when it runs out
the current and background steps are stopped and the run is `incomplete` with problem `budget`.

Attempts: a repeatable step runs `repeat` times; each repetition runs up to `1 + retries` attempts until one passes. A
non-repeatable step runs once; its failure is never retried. Outcome of an attempt (by adapter):

| Program | pass | fail | blocked | error |
|---|---|---|---|---|
| serial-monitor | exit 0 | exit 4 (`--until` never matched) | - | any other |
| scpi | exit 0 | exit 1 | exit 2 | exit 3 or other |
| lab-validate | exit 0 | exit 1 | - | exit 2 (refused request) or other; exit 3 is `incomplete` |
| probe-rs, esptool | exit 0 | - | - | any other |

A runner timeout of the step is `error` (problem `step-timeout`); an attempt stopped by Stop or the budget is
`incomplete`; a process that could not start is `error`. `expect` turns a passing attempt whose output does not match
into `fail`. In a test step `blocked` (a refusal before any effect, such as an absent instrument) is the step's
`error`. In phase `setup` a `fail`, `error` or `blocked` outcome becomes `blocked` (a failed
precondition); an attempt cut by Stop or the budget stays `incomplete`. A refused start is `error` (`changed` for a
file that changed, `busy` for BUSY). An await that times out stops its background step; both are `incomplete`. `await` takes the
outcome of the background step it waits for (waiting at most its own `timeout`, else that step's timeout); a background
step the executor stopped at the end of `steps` is `stopped` and does not count. After a non-pass setup step or any
error, the remaining steps are `not-run`; after a `fail` the remaining test steps still run.

Stop (`program_stop`, the Runs tab, session stop, workbench close, app exit or a foreground abort), the budget and a
step error end the running phase: running children are stopped (each with its grace and declared cleanup), then the
state becomes `cleaning-up` and every cleanup step runs once, in order, under its own timeout, without a new approval,
also after a Stop; a second Stop does not skip them. Cleanup steps never retry. Then the lease is released and the
state becomes `done`.

Physical state of the plan: `unknown` when any child (cleanup included) reported `unknown`, a cleanup step did not
pass, or `firmwareEffect` is `irreversible`, the firmware was started (a flash or reset process ran, also when Stop, the budget or its timeout cut it) and no cleanup step passed;
`confirmed` when cleanup steps ran and all passed and nothing was unknown; else `unchanged`. `unknown` is recorded on the
plan's keys in the lease folder (next claims see it, as for LAB-01 runs). After a crash of VERA the plan lease is stale;
the next claim records `holder-lost` when the plan could actuate.

## 7 Result

Folder `embedded-lab-results/<run-id>/` (run id: a ULID chosen at compilation), created exclusively when the run
starts, never inside `.vera`:

- `plan.json` - the approved plan bytes;
- `result.json` - format 1, kind `hil-test-result`, replaced atomically at every state change: `tool {name: "vera-hil",
  version}`, `runId`, `plan {id, title, path, sha256}`, `setup`, `firmware`, `risk`, `state`, `status`, `states [{state,
  at, t}]`, `started`, `ended`, `budget {seconds, usedMs}`, `physical`, `resources`, `steps [step]`, `cleanup [step]`,
  `problems [{code, message, step?}]`, `artifacts [{path, sha256, bytes}]` (filled at the end), `correlation` (text);
  step = `{id, phase, use, plugin, program, args, risk, status, reason?, attempts [{repetition, attempt, status, exitCode,
  timedOut, stopped, run, log, startT, endT, startedAt, endedAt, physical?, folder?, deviceTimes?, problem?}]}`;
- `events.jsonl` - one JSON object per line `{seq, t, at, event, step?, attempt?, ...}` with `t` milliseconds on the
  monotonic clock since compilation and `at` the host's wall time; events `state`, `lease`, `step-start`, `step-end`,
  `retry`, `handoff` (a serial port or probe used by a different program than the previous step that used it),
  `background-stop`, `stop`, `budget`, `changed`, `physical`;
- `steps/<id>-<repetition>-<attempt>.log` - the full output of each attempt (at most 4 MiB, cut at the start);
  `steps/<id>/` - the run folders scpi and lab-validate wrote; `steps/<id>.request.json` - generated LAB-02 requests;
- `report.html`, `report.md`, `junit.xml` - written by `hil report` (section 8) after `done`.

Status precedence: `blocked` (a setup step not passing) > `error` > `fail` > `incomplete` (Stop, budget, an
`incomplete` attempt, a skipped or not-run test step) > `pass` (every test step passed). A plan never reports `pass`
when a test step did not pass. Device times: `deviceTimes` copies `started`/`ended` from a step folder's `result.json`;
`correlation` states that an event inside a step is known only within that attempt's `[startT, endT]` window and that
instrument clocks are not synchronized with the host clock.

Foreground result of `hil run`: the run_program result with exit code 0 pass, 1 fail, 2 blocked, 3 error or incomplete,
`output` a summary naming the result folder, and `physical`.

## 8 Helper `hil`

Standard-library PEP 723 script `scripts/hil_tool.py` (Python >= 3.11). `hil --version` prints `hil-testing 1.0.0`.
`hil report --run DIR` reads `DIR/result.json` (format 1, kind `hil-test-result`, state `done`) and `events.jsonl`,
and writes `report.html` (self-contained, escaped text, no script or external resource), `report.md` and `junit.xml`
(one testsuite for the plan, one testcase per step and cleanup step: `failure` for fail, `error` for error and blocked,
`skipped` for skipped, not-run and incomplete) with exclusive creation; exit 0 written, 2 refused (missing, malformed,
not done, outside the working directory, a report file already exists). It opens no network connection and starts no
process.

# renode: operations, profiles, test sets and run folders

Owner requirement: REQ-DATA-8a943977. Plugin `05_Software/plugins/renode/` (LAB-06, #107). Reused contracts:
- the results folder rules of `.agentic/specs/REQ-DATA-b3e2930f.md`: `embedded-lab-results/<run-id>/`, format 1,
  exclusive creation;
- the hil-testing report shape (`plugins/hil-testing/scripts/hil_report/cli.py`): junit.xml with testsuite properties
  `status` and `runId`, and report.md/html;
- the gdb-debug ELF reader (`gdb_support/elf.py`).

## 1 Programs

| Program | Install | Role |
|---|---|---|
| `renode` | find, or the pinned download of Renode 1.17.0 portable (windows-x64, linux-x64) with its SHA-256 | the engine; every direct call is blocked |
| `renode-sim` | script `scripts/renode_sim.py`, PEP 723, standard library, Python >= 3.11, `uses: [renode]` | `tools`, `profiles`, `validate`, `run`, `capture-uart`, `test`, `report` |

The support package is `scripts/renode_support/`. `elf.py` is a byte-identical copy of gdb-debug's
`gdb_support/elf.py`, and `workspace.py` of the shared lab/ELEC path module; a test keeps the copies identical.
`renode-sim` receives the engine path as `VERA_PROGRAM_RENODE` (VERA's `uses`); without it every engine operation is
`blocked` with code `engine-missing`.

## 2 Options and refusals

Every option is `--name value` (argparse, abbreviations off). The operations that write a run folder share
`--results-dir <dir>`, `--run-id <1-64 of [A-Za-z0-9._-]>` and `--label <1-120 printable>`:
- `--results-dir` defaults to `embedded-lab-results`. It must lie inside the working directory and never inside
  `.vera`.
- `--run-id` defaults to a ULID-like id, as gdb-debug.

The operations:
- `tools`: the engine path, its `--version` line and version, and its platforms folder. It starts no simulation.
- `profiles [--profile <id>]`: one compact row per plugin and workbench profile, plus the refused ones with their
  reason. With `--profile`, the full facts of that profile.
- `validate --profile <id> --firmware <elf> --arch <arch> --boot-address <0x...>`: offline. It prints the result and
  writes no run folder.
- `run <firmware options> [--virtual-budget <s>] [--real-timeout <s>] [--uart <name>]`: boot and run.
- `capture-uart <firmware options> --until <regex> [--virtual-budget <s>] [--real-timeout <s>] [--uart <name>]`.
- `test <firmware options> --test-set <id> [--param <name>=<value>]... [--virtual-budget <s>] [--real-timeout <s>]`.
- `report --run <dir> [--hil <dir>]`: report.md, report.html and junit.xml of a run folder. With `--hil`, a
  requirement comparison with a hil-testing run folder.

`<firmware options>` are `--profile`, `--firmware`, `--arch` and `--boot-address`, all required. The firmware is a
regular file inside the working directory, at most 32 MiB.

Bounds:
- `--virtual-budget` is 0.001...3600 virtual seconds. The default is 1 for `run`, 5 for `capture-uart`, and for `test`
  the sum of the case budgets (at most 3600).
- `--real-timeout` is 1...3500 real seconds (default 300). The manifest gives `run`, `capture-uart` and `test` a runner
  timeout of 3600 s, so the helper's own real budget always ends first.
- `--until` and the test-set patterns are Python regular expressions of at most 256 characters. Each is matched
  against one UART line without its line ending.
- `--param` names match `[a-z][a-z0-9_-]{0,31}`, at most 16 of them. A value must match its parameter's own `regex` in
  the test set.

Refusals before a run folder exists (exit 2, `kind: renode-refusal`): malformed options, paths outside the working
directory or inside `.vera`, an invalid `--run-id`, `--label`, `--until` or `--param` value, and every `validate`
refusal. For `run`, `capture-uart` and `test`, everything else that does not fit makes a run folder with status
`blocked` and its code, and the engine is never started:
- the profile or test-set file is unreadable or refused;
- the firmware does not fit;
- the UART is unknown;
- the engine is missing, has another version, or its platform files differ;
- the run folder's path has no form the monitor can take (`run-path`, section 5).

A blocked run folder holds result.json and junit.xml.

## 3 Profiles

A profile is a folder with `profile.json`, one `.resc`, and the `.repl` files it uses. Plugin profiles live in the
plugin's `profiles/<id>/`; workbench profiles in `renode/profiles/<id>/` of the working directory. An id defined in
both places is refused (`profile-duplicate`). `profile.json` is format 1, at most 64 KiB, and refuses unknown keys:

```json
{
  "format": 1, "id": "stm32f4-discovery", "title": "...", "platform": "...", "engine": "1.17.0",
  "verification": "verified|unverified", "repl": "platform.repl", "resc": "machine.resc",
  "engineFiles": {},
  "cpu": { "arch": "cortex-m4", "isa": "v7E-M" },
  "boot": "0x08000000",
  "memory": [ { "name": "flash", "kind": "flash", "start": "0x08000000", "size": "0x200000" },
              { "name": "sram", "kind": "ram", "start": "0x20000000", "size": "0x40000" } ],
  "uarts": { "usart2": "sysbus.usart2" }, "console": "usart2",
  "peripherals": [ { "name": "timer2", "model": "Timers.STM32_Timer", "address": "0x40000000", "note": "..." } ],
  "stimuli": { "user-button": { "kind": "button", "target": "sysbus.gpioPortA.UserButton" },
               "console-rx": { "kind": "uart-input", "uart": "usart2" } },
  "observables": { "user-led": { "kind": "led", "target": "sysbus.gpioPortD.UserLED" } },
  "unsupported": [ "..." ],
  "slice": 0.01
}
```

Field rules:
- Ids match `[a-z][a-z0-9-]{0,47}`.
- `arch` is one of `cortex-m0`, `cortex-m0plus`, `cortex-m3`, `cortex-m4`, `cortex-m7` or `cortex-m33`, with its ISA.
- Targets match `^sysbus(\.[A-Za-z_][A-Za-z0-9_]*){1,3}$`.
- `slice` is the helper's virtual step, 0.001...0.1 s.
- A value of the wrong JSON type is a refusal, never a traceback.
- `engineFiles` maps at most 16 files of the pinned engine (`platforms/...repl`) to their SHA-256.

The plugin profile `stm32f4-discovery` uses none of the engine's files. Its `platform.repl` and `stm32f4.repl` are
Renode 1.17.0's `platforms/boards/stm32f4_discovery.repl` and `platforms/cpus/stm32f4.repl`, copied beside it, with
two differences:
- The CPU file's final `sysbus: init:` block is removed. It downloads `STM32F40x.svd.gz` from dl.antmicro.com and tags
  three registers.
- The board file's `using` names the local copy.

**`.repl` validation** applies to the profile's own `.repl` and every `.repl` beside it that it uses, recursively,
with at most 8 files and 64 KiB each. Comments (`//`, `/* */`) are removed in one quote-aware pass. A string that holds
a comment marker, or that does not end on its line, is refused. A line is refused (`profile-refused`, with file, line
and cause) when it:
- is a `using "<path>"` whose path is neither a key of `engineFiles` nor the plain name of a `.repl` file beside the
  profile;
- contains `init` (monitor commands inside a platform description);
- has an `@` that is not a registration or a connection (`@ sysbus <...>`, `@ gpioPortA`, `@ none`, `@ { ... }`,
  `-> nvic@38`, `@[19-22]`);
- contains `://` or a backslash;
- names a word matching `python`, `script`, `socket`, `pty`, `tap`, `switch`, `hostnetwork`, `usbip`, `gdb`,
  `terminal`, `backend`, `filename` or `filepath` (case-insensitive);
- quotes a string that starts with `/`, `~` or a drive letter, or contains `..`.

**`.resc` validation**: comments (`#`) and blank lines are ignored. Every other line must be one of these:
- `using sysbus`;
- `mach create` or `mach create "<name>"`;
- `machine LoadPlatformDescription @<the profile's repl file name>`;
- `cpu PerformanceInMips <1-10000>` or `sysbus.cpu PerformanceInMips <1-10000>`;
- `emulation SetGlobalQuantum "<decimal seconds>"`.

Anything else is refused with its line number. That refuses `python`, `include`/`i`, `$var` assignments, `macro`,
`runMacro`, `showAnalyzer`, URLs, sockets, PTYs, GDB servers, TAP/switches, `logFile` and any other `@path`. The
helper never sends the `.resc` text itself; it sends the parsed, approved commands.

**Engine files**: before each engine start, the helper hashes every `engineFiles` entry under the engine's root (the
folder holding `platforms/`, searched at the executable's folder and up to 3 parents). Each of these blocks the run
with code `engine-files`:
- a missing file, or one with another hash;
- an engine file containing an `init` block or a URL;
- an engine file whose `using` names a file the profile does not hash.

The profile's `engine` must equal the engine's version (`engine-version`).

## 4 Firmware validation

`validate`, and every engine operation before the engine starts, reads the ELF with `elf.py` and checks, in order,
each with its own code:
1. the ELF is readable (`elf`);
2. it is 32-bit little-endian (`elf-class`);
3. the machine is ARM (`machine`);
4. it is an executable (`elf-type`);
5. `--arch` equals the profile's `cpu.arch` (`arch-mismatch`);
6. when the ELF carries ARM attributes, its Tag_CPU_arch matches the profile's `cpu.isa` (`arch-mismatch`). An ELF
   without attributes gets the note `no-attributes` instead;
7. `--boot-address` equals the profile's `boot` (`boot-address`);
8. every PT_LOAD segment's load and run range lies inside one memory region (`memory-map`);
9. a loadable segment at the boot address holds the vector table (`vector-table`): word 0 (the initial SP) lies inside
   a `ram` region or at its end, and word 1 (reset) is odd (Thumb) and lies inside a `flash` region.

A refusal names the code, a reason and the offending segment or value. `validated` lists the SHA-256, build id, entry,
ISA, the segments with their region, and the vector table.

## 5 Engine session

The helper starts `[engine, --disable-gui, --console, --plain, --hide-log, --config <run>/renode.config]` with stdin
and stdout piped and the run folder as cwd. The environment carries only system variables: no VERA token or run
control, plus `DOTNET_CLI_TELEMETRY_OPTOUT=1` and `DOTNET_EnableDiagnostics=0`.

Every `@` path is the absolute path of a file in the run folder. A path with characters outside
`[A-Za-z0-9_./:~+-]` uses its Windows 8.3 short form; when none exists, the run is `blocked` with code `run-path`.

The commands, in order:
1. `logFile @<run>/engine.log true`;
2. the profile's approved `.resc` commands, with the platform at `@<run>/profile/<repl>`;
3. `sysbus LoadELF @<run>/firmware.elf`;
4. `sysbus.cpu VectorTableOffset <boot>`;
5. for the selected UART, `<uart> CreateFileBackend @<run>/uart-<name>.<n>.part true`;
6. `emulation RunFor "<slice>"`, repeatedly.

After each slice:
- **UART.** When the current segment has grown, the helper sends `<uart> CloseFileBackend @...part`. It appends the
  segment to `uart-<name>.log`, deletes the segment and opens the next one. Lines get the virtual time of the
  slice's end.
- **Engine log.** It reads the new lines of `engine.log`. An `[ERROR]` line ends the run as `error`.

Stimuli are `<target> Press` / `Release` (button) and `<uart> WriteChar <byte>` per byte (uart-input). Observables
are read with `<target> State` (led: the answer's last line is `True` or `False`).

Any answer to a non-query command is an engine error, whatever its wording. The queries are `State` and
`GetTimeSourceInfo`.

At the end, the helper closes the last UART segment and reads `emulation GetTimeSourceInfo` (`Elapsed Virtual Time`).
It then sends `quit` and allows 10 s before it kills the process tree (Windows `taskkill /T /F`, POSIX kill of the
engine and its descendants found in /proc). The engine stays in the helper's process tree or group, so VERA's Stop
and timeout kills reach it.

Start check: the engine log must show `Setting initial values: PC = <reset>, SP = <initial SP>` equal to the
validated vector table. The engine's virtual time must also match the helper's within half a slice. Otherwise the
run is `error` with code `engine`.

Unmodeled accesses add entries to `unmodeled`, and any entry makes the run `incomplete` (code
`unmodeled-peripheral`):
- Engine log lines that report a read or write of a non-existing peripheral, or of an unimplemented register named
  by an SVD file, add `{address, access, width, count, firstVirtual}`.
- `Unhandled read/write` lines of a modeled peripheral add `{peripheral, offset, access, kind: "unhandled-register",
  count, firstVirtual}`.

A case is `incomplete` when the event count grew during it.

## 6 Test sets

A test set is `testset.json` (format 1, at most 64 KiB) in the plugin's `testsets/<id>/` or the workbench's
`renode/tests/<id>/`. An id defined in both places is refused.

```json
{
  "format": 1, "id": "board-basics", "title": "...", "profiles": ["stm32f4-discovery"],
  "params": { "version": { "default": "1.2.3", "regex": "^[0-9]+\\.[0-9]+\\.[0-9]+$" } },
  "cases": [ { "id": "boot-version", "requirement": "FW-BOOT", "hil": ["boot-banner"], "budget": 0.5, "steps": [
      { "do": "uart", "pattern": "^${banner}$", "within": 0.2 },
      { "do": "uart", "pattern": "^version ${version}$", "fail": "^version ", "within": 0.2 } ] } ]
}
```

Step kinds:
- `run {for}` advances virtual time.
- `uart {pattern, fail?, within}` waits for a line that matches `pattern` (pass) or `fail` (fail, assertion) within
  `within` virtual seconds; otherwise it is a timeout. Lines are consumed in order, and a later step sees only lines
  after the last matched one.
- `count {pattern, over, min, max}` runs `over` seconds and counts the matching lines that arrive. A count outside
  [min, max] is a fail.
- `stimulus {name, action: press|release}` or `stimulus {name, text}` applies a declared stimulus.
- `observe {name, equals, within}` reads a declared observable at each slice until it equals the value (pass). If
  `within` ends first, it is a fail. If a case or run budget ends first, it is a timeout.

`${name}` is replaced by the parameter's value:
- in patterns, regex-escaped;
- in `count` `min`/`max` and in stimulus `text`, verbatim.

After the replacement, `min`/`max` must be whole numbers 0...100000, and `text` must be 1...64 printable ASCII
characters (CR and LF allowed).

Limits: a case's `budget` (0.001...600 virtual s) bounds its steps; at most 32 cases, and 64 steps per case. Case ids
match `[a-z][a-z0-9-]{0,31}`, `requirement` matches `[A-Za-z0-9._-]{1,64}`, and `hil` lists at most 8 HIL step ids.
The test set must list the profile, and the profile must declare every stimulus and observable name; otherwise the
run is `blocked` (code `testset`) before the engine starts.

## 7 Run folder and result

`embedded-lab-results/<run-id>/` holds:
- `result.json`;
- `firmware.elf` (copy), and `profile/` (copies of the profile's files);
- `testset.json` (test only);
- `uart-<name>.log`, `engine.log` and `monitor.log` (the commands sent and the engine's answers);
- `renode.config` (the engine's own);
- `junit.xml`, written at the end of every engine operation;
- after `report`, report.md and report.html, with junit.xml rewritten.

`result.json` (format 1, kind `renode-result`) is first written when the run folder is created (state `running`). It
is rewritten:
- when the engine starts;
- when each case starts and ends;
- after a slice when 2 real seconds have passed since the last write (`heartbeat`).

The final write sets state `done`.

Fields:
- `operation`, `runId`, `state`, `status`, `code`, `reason`, `started`, `ended`, `heartbeat`;
- `engine {path, version, versionLine, pid}`;
- `profile {id, origin, sha256, files{}, engineFiles{}, verification}`;
- `firmware {path, sha256, buildId, arch, isa, bootAddress, entry, validation}`;
- `testSet {id, origin, sha256, params}`;
- `budgets {virtualSeconds, realSeconds}`;
- `time {virtualSeconds, engineVirtual, realSeconds}`;
- `uart {name, log, lines[] (at most 2000 {t, text}), total, truncated}`;
- `cases[] {id, requirement, hil, status, code, reason, startVirtual, virtualSeconds, realSeconds, steps[]}`, where
  each step is `{index, do, status, virtual, virtualSeconds, realSeconds, detail}`;
- `unmodeled[]`;
- `coverage {evidence: "virtual", simulated[], notCovered[], statement}`;
- `artifacts {name: sha256}`.

Virtual seconds are what the engine simulated; real seconds are wall-clock time. Neither is physical timing on
hardware.

Statuses (run and case):
- `pass`;
- `fail`: an assertion (code `assertion`);
- `timeout`: codes `virtual-timeout` and `real-timeout`;
- `incomplete`: codes `unmodeled-peripheral` and `not-run`;
- `blocked`: refused before the engine starts (section 2);
- `error`: the engine failed to start, crashed, answered a setup command, logged an error, or failed the start check
  (code `engine`);
- `stopped` (code `interrupted`): set by `report` on a run folder in state `running` whose heartbeat is older than
  90 s;
- `running`: a case that has not ended.

Run status precedence: blocked > error > stopped > timeout > fail > incomplete > pass. When the real budget ends or
the engine fails, the cases not run are `incomplete` with code `not-run`.

`coverage.notCovered` always holds:
- real electrical timing;
- analog power consumption;
- EMI;
- SPICE circuit behavior;
- peripherals without a model;
- the profile's `unsupported` entries.

Exit codes: 0 pass; 1 fail or timeout; 2 refused (section 2); 3 incomplete, blocked, error or stopped.

## 8 Report

`report --run DIR` reads a renode-result folder inside the working directory and writes report.md, report.html and
junit.xml in the hil-testing shape:
- one testsuite, named by the test set or the operation, with properties `status`, `runId`, `evidence=virtual`,
  `profile`, `firmwareSha256` and the note that times are virtual seconds;
- one testcase per case, with property `requirement`;
- fail becomes a failure; timeout, error and blocked become an error; incomplete and stopped become skipped.

`--hil DIR` reads a hil-test-result folder (state done) and adds a table: requirement, virtual status, and the
hardware status of the HIL steps named in the case's `hil` (`not in the HIL run` for a missing step, `not run on
hardware` when none is named). The table states that virtual evidence does not replace hardware evidence.

## 9 Engine facts (Renode 1.17.0, observed on Windows x64 2026-11-14)

- The archive `renode-1.17.0.windows-portable.zip` extracts to `renode_1.17.0-portable/renode.exe`. It is a .NET 8.0.10
  self-contained build, and `--version` prints `Renode v1.17.0`.
- The Linux archive path `renode_1.17.0-portable/renode` is INFERRED from `tools/packaging/make_linux_portable.sh` at
  tag v1.17.0; it was not downloaded.
- Console: each command is echoed. The answer follows, and then the prompt `(monitor) ` or `(<machine>) ` on its own
  line. Without `--hide-log`, log lines interleave with the console, even inside a prompt.
- Errors appear under several wordings: `There was an error executing command ...`, `Could not tokenize here`,
  `No such command or device`.
- A path token is `@` followed by non-whitespace; quoted paths are refused.
- Read paths are found relative to the start folder. Relative write paths resolve against the engine folder.
- `UartFileBackend` opens its file with `FileMode.CreateNew` and no sharing, so Windows denies reads until
  `CloseFileBackend`. `logFile` opens with `FileShare.ReadWrite`, and `true` flushes every write.
- Unmodeled-access line: `WriteDoubleWord to non existing peripheral at 0x40007400, value 0x1.` With the SVD applied,
  the line reads instead: `WriteDoubleWord of value 0x1 to an unimplemented register DAC:CR (0x40007400) generated from
  SVD`.
- The engine loads its own `scripts/monitor.py` at start.
- With these options the engine owns no TCP or UDP endpoint (`Get-NetTCPConnection`/`Get-NetUDPEndpoint` by PID).

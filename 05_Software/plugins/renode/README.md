# Renode virtual boards (renode)

Runs a firmware ELF on an explicitly supported virtual board with the pinned Renode 1.17.0. The engine runs headless,
and `renode-sim` drives its monitor over the console. UARTs go to files in the run folder, and no host device or GUI
is used. On Windows x64 a run with the real Renode 1.17.0 owns no TCP or UDP endpoint and downloads nothing; native
Ubuntu has not been checked yet. The specification is `.agentic/specs/REQ-DATA-8a943977.md`.

## Operations

| Call | Effect | Risk |
|---|---|---|
| `renode-sim tools` | the engine path, its `--version` and its platforms folder | safe |
| `renode-sim profiles [--profile ID]` | every plugin and workbench profile with its facts and hashes, refused ones with the reason | safe |
| `renode-sim validate --profile ID --firmware ELF --arch ARCH --boot-address 0x...` | offline check of the ELF against the profile: machine, architecture, memory map, vector table at the boot address | safe |
| `renode-sim run <firmware options> [--virtual-budget S] [--real-timeout S] [--uart NAME]` | boots the firmware and records the UART for the virtual budget | safe (host simulation) |
| `renode-sim capture-uart <firmware options> --until REGEX ...` | records the UART until a line matches or the virtual budget ends | safe (host simulation) |
| `renode-sim test <firmware options> --test-set ID [--param NAME=VALUE]...` | runs an approved test set; writes junit.xml | safe (host simulation) |
| `renode-sim report --run DIR [--hil DIR]` | report.md, report.html, junit.xml; with `--hil` a requirement table next to a HIL run | safe |

`renode` itself is blocked for direct calls. Results go to `embedded-lab-results/<run-id>/`: `result.json` (kind
`renode-result`, rewritten while the run goes on), `firmware.elf` and `profile/` (the copies the engine read),
`uart-<name>.log`, `engine.log`, `monitor.log` (every command sent and its answer), and `testset.json` for a test.

## Setup

Choose **Install programs** for the pinned Renode 1.17.0 portable package. Its SHA-256 is checked:
`renode-1.17.0.windows-portable.zip` (18bcf145...b9db) or `renode-1.17.0.linux-portable.tar.gz` (4ba7c68b...a5f).
A Renode 1.17.0 on PATH works too. A different engine version blocks a run, and so does a changed engine platform file
for a profile that uses one.

## Profiles and test sets

- `stm32f4-discovery` uses Renode 1.17.0's STM32F4 Discovery board and STM32F4 CPU model (MIT licence), copied beside
  the profile as `platform.repl` and `stm32f4.repl`.
  - The copy leaves out the CPU file's final `sysbus: init:` block, which downloads an SVD file from dl.antmicro.com
    and tags three registers.
  - It declares the console `usart2`, the stimuli `user-button` (PA0) and `console-rx` (bytes into usart2), and the
    observable `user-led` (PD12).
  - Its `unsupported` list names what the model does not simulate: the clock tree, cycle timing,
    DAC/ADC/USB/SDIO/DCMI, the removed register tags and the board's external parts.
  - It ran the fixture firmware and `board-basics` on the real engine on Windows x64 (2026-11-14). It stays
    `unverified` until native Ubuntu and a firmware other than the fixtures have run.
- `board-basics` is the approved test set. It checks the boot banner and version, a UART echo, ten timer ticks per
  virtual second, and that the button drives the LED. Its parameters `banner`, `version` and `ticks` let it test
  another firmware with the same behavior.
- Workbench profiles (`renode/profiles/<id>/`) and test sets (`renode/tests/<id>/`) are validated like the plugin's.
  A `.repl` may use only the engine's hashed `platforms/` files or `.repl` files beside it. These are refused:
  `init` blocks, Python or script peripherals, sockets, terminals, backends, TAP/switch/host network, GDB and USB/IP
  words, `@` file paths, URLs, backslashes, absolute or `..` paths, and comment markers inside strings. An engine file
  that a profile uses is checked too: one that holds an `init` block or a URL blocks the run. This is why Renode's own
  `platforms/cpus/stm32f4.repl` cannot be used directly.
  - Residual risk: a model type that binds a host resource without any of these words would pass. Review a workbench
    `.repl` like code.
- A `.resc` may hold only `using sysbus`, `mach create`, `machine LoadPlatformDescription @<the profile's repl>`,
  `cpu PerformanceInMips N` and `emulation SetGlobalQuantum "S"`. The stock Renode scripts are refused: they download
  ELFs and call `python`.

## What a result means

The run's evidence is always **virtual**. Virtual seconds are simulated, and the real seconds are wall-clock time;
neither is physical timing on hardware. No power is measured, and EMI and the analog circuit are not simulated.

Statuses:
- `fail` is an assertion: a failure line, a wrong count or a wrong LED state.
- `timeout`/`virtual-timeout`: nothing came within the virtual budget.
- `timeout`/`real-timeout`: the wall-clock budget ended, and the helper stopped the engine.
- `incomplete`/`unmodeled-peripheral`: the engine logged an access to an address or register without a model.
- `blocked`: the profile, firmware, test set or engine did not fit, and nothing ran.
- `stopped`/`interrupted`: set by `report` for a run that VERA stopped or killed.

## Renode's Robot Framework integration

VERA does not use it. Renode 1.17.0 starts its Robot keyword server on every network interface on Linux. Its
`Execute Command` keyword also reaches the monitor's `python`, so the server would expose host code execution to the
network. Approved test sets are data that `renode-sim` runs over the console instead, and they produce the same
JSON/JUnit shape as hil-testing.

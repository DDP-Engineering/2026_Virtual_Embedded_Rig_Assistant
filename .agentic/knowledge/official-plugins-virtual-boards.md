# Official plugins: virtual boards (Renode and Wokwi)

## Routing

Select for `renode` (programs `renode`, the pinned Renode 1.17.0 engine whose direct calls are blocked, and
`renode-sim`, which validates firmware against approved virtual-board profiles and runs it headless with UART capture
and data-only test sets; skill virtual-boards); and `wokwi`.

For renode, start at plugins/renode/plugin.yaml (programs `renode`, the engine: find or the pinned Renode 1.17.0
portable download, every direct rule blocked; `renode-sim` with `uses: [renode]`), scripts/renode_sim.py and
scripts/renode_support/:
- cli.py: operations and refusals;
- profiles.py: profile.json, the quote-aware `.repl` validator, the `.resc` parser and the engine-file check;
- firmware.py: ELF checks with the copied elf.py;
- testsets.py: data-only step kinds and parameters;
- engine.py: the headless console session, UART segments, the log watch and process-tree kill;
- operations.py: slices, steps and statuses;
- result.py: the progressive result.json;
- report.py: md/html/junit and the `--hil` table;
- workspace.py: the shared copy.

The spec is .agentic/specs/REQ-DATA-8a943977.md (section 9 records the observed engine facts). The plugin's
profiles/stm32f4-discovery/ holds Renode's board and CPU descriptions without the SVD download, and
testsets/board-basics/ is the approved test set.

Coverage:
- tests/plugins/renode.test.ts with tests/fixtures/renode/: the engine stand-in fake_renode.py made executable
  by make_engine.py, firmware/ ELFs built with zig cc plus variants.json, the stock vendor .resc, and engine/platforms/
  vendor copies. This is offline evidence.
- The opt-in `VERA_RENODE_REAL` suite runs against the real engine.

The plugin has no platform (core/shared/host) seam of its own. A run reserves no bench resource, so VERA's Stop is the runner's
tree kill, and the progressive result.json carries the partial report.

For wokwi, start at plugins/wokwi/plugin.yaml, scripts/wokwi_tool.py and scripts/wokwi_support/ (cli.py dispatch,
engine.py the pinned wokwi-cli, its child environment and offline lint, project.py wokwi.toml/firmware/origin, diagram.py,
scenario.py, job.py the job folder and its verification, credential.py the stdin token, run.py the one cloud run with its
watch loop, outcome.py the outcome table, collect.py, redact.py, report.py) with spec .agentic/specs/REQ-DATA-d985bb3d.md;
tests/plugins/wokwi.test.ts with tests/support/fake-wokwi-cli.py owns its coverage - offline evidence plus the real
wokwi-cli 0.29.1 offline (VERA_TEST_WOKWI_CLI), never a cloud run. Its workspace.py is a byte-identical copy of mqtt-tool's;
the token hand-off is platform behaviour, see [Plugin configuration and credentials](plugins-configuration.md).

The conventions shared by all official plugins (package format, catalog source, packs, versions and evidence
levels) and the page of every other plugin are in [Official plugins](official-plugins.md). The platform that
installs, classifies, approves and runs these programs is [Plugins](plugins.md); plugin skill discovery is
[Skills](skills.md).

## Public interface

- `renode` 0.3.0, ecosystem `lab` (pack Embedded lab, group Virtual boards (Renode), default on; activities
  testing/firmware-analysis), Windows x64/Linux x64.
  - Engine program `renode`: found (`==1.17.0`), or downloaded and SHA-256-checked from the 1.17.0 portable archives
    (`renode_1.17.0-portable/renode[.exe]`). Every direct call is blocked.
  - `renode-sim` (standard library, all rules safe, host simulation):
    - `tools`;
    - `profiles [--profile ID]`;
    - `validate --profile --firmware --arch --boot-address` (offline);
    - `run`, `capture-uart --until REGEX` and `test --test-set ID [--param N=V]...`, with `--virtual-budget` up to
      3600 virtual s and `--real-timeout` up to 3500 s (rule timeout 3600);
    - `report --run DIR [--hil DIR]`.
  - Profile `stm32f4-discovery` (`unverified`: Windows only) and test set `board-basics` (boot/version, UART echo,
    10 Hz timer, button/LED).
  - Results in `embedded-lab-results/<run-id>/`: result.json kind `renode-result` (state running/done), firmware.elf,
    profile/, uart-<name>.log, engine.log, monitor.log and junit.xml. `report` adds report.md/html.
  - Exit codes: 0 pass, 1 fail/timeout, 2 refused, 3 incomplete/blocked/error/stopped.
  - Evidence: Windows 11 with offline fixtures (the stand-in, VERA's real runner and Stop) and the real
    Renode 1.17.0: board-basics passes twice with equal virtual results, the wrong version fails, silence
    times out, the DAC write is unmodeled, the engine owns no TCP/UDP endpoint, and engine.log shows no download.
    No native Ubuntu run yet.

- `wokwi` 0.2.0, ecosystem `arduino` (Arduino pack, group "Cloud simulation (Wokwi)", default off; activity `testing`),
  Windows x64 and Linux x64. Program `wokwi-cli` = the official wokwi-cli 0.29.1 (sha 0aa185144b92) downloaded by
  SHA-256 from its GitHub release (`wokwi-cli-win-x64.exe`, `wokwi-cli-linuxstatic-x64`), version probe
  `--short-version` in range >=0.29.1,<0.29.2, every direct command blocked. Program `wokwi-tool` = `scripts/wokwi_tool.py`
  (PEP 723, `pyyaml==6.0.3`), `uses: [wokwi-cli]`, `credentials {option: --credential, scope: wokwi}`, timeout 120 s.
  Risks: `capabilities`, `inspect-project`, `validate-diagram`, `prepare-job`, `collect-results`, `report` safe;
  `run-scenario` irreversible (timeout 1900 s; transmits the job's files to wss://wokwi.com/api/ws/beta). The helper
  refuses another wokwi-cli version or build sha (`cli-version`) or none (`cli-unavailable`); every wokwi-cli child gets the helper's
  environment without any `WOKWI_*` variable plus `NO_COLOR=1`, and only run-scenario adds `WOKWI_CLI_TOKEN`.
  inspect-project reports wokwi.toml, firmware/ELF (form hex/bin/uf2/elf/ESP-IDF flasher_args.json, size, SHA-256,
  origin arduino-cli run+FQBN by result.json hash, PlatformIO environment, ESP-IDF target, else unknown; buildMatch),
  diagram parts and boards. validate-diagram runs structural checks and `wokwi-cli lint --offline`. prepare-job refuses
  wokwi.toml tables/keys beyond version/firmware/elf, chips, SD cards, GDB/RFC 2217 (`unsupported-input`), mismatched
  firmware (`firmware-invalid`), lint errors (`diagram-invalid`), not exactly one board, scenarios outside delay,
  wait-serial, write-serial, set-control, expect-pin (`scenario-invalid`/`unsupported-input`), no assertion
  (`assertion-missing`) or scenario plus expect-text; then writes `arduino-iot-results/<run-id>/` with `send/` (exact
  copies and a generated wokwi.toml), `job.json` (`wokwi-job`: files with role, source, size, SHA-256, transmitted;
  account, endpoint, board, limits virtual 100-600000 ms and real budget 10-1800 s, attempts 1, usage note) and
  `job.md`. run-scenario accepts only fields of the form prepare-job writes (`job-invalid`), verifies that send/ holds
  exactly the job's fixed layout with listed roles and hashes, a wokwi.toml byte-equal to the generated one and the
  flash files flasher_args.json names (`job-changed`), checks the copies again (one board equal to the job's,
  screenshot part, scenario, offline lint), then the account (`credential-mismatch`) and the CLI build sha before it
  reads the stdin token; a stop before the CLI starts sends nothing; writes result.json incomplete/running, runs
  wokwi-cli once on send/ with `--no-sdcard`, the virtual timeout and exit code 42, a 200 ms watch loop (real budget,
  serial log 16 MiB, stdout/stderr 4 MiB each, stop signal -> CTRL_BREAK_EVENT/SIGTERM, kill after 5 s), redacts the
  token from all CLI output it writes, then `exit.json` and the outcome: passed / virtual-timeout / fail-text /
  assertion-failed / auth-failed / network-error / connection-lost / api-error / credential-missing / cli-failed /
  stopped / real-budget-exceeded / output-limit / interrupted, with remote `not-started` (confirmed),
  `closed-by-client` or `unknown`, virtual and real time apart, `connectRetries`. Results `wokwi-run`, `report.md`,
  `serial.log`, optional `trace.vcd`/`screenshot.png`; report writes report.json/.md/.html and junit.xml; exit 0/1/2/3.
  Evidence: offline against the fake CLI and the real wokwi-cli 0.29.1 (version, offline lint, argument
  acceptance up to its missing-token check); no cloud run, native Ubuntu not run.

## Invariants

- renode: the agent never reaches the Renode monitor.
  - renode-sim sends only commands composed from an approved profile and fixed templates, with absolute run-folder
    `@` paths (8.3 short form, else blocked). Any answer to a setup or run command is an engine error.
  - Profiles: `.repl` files are validated line by line (quote-aware comments, using allowlist, denied host-binding
    words, no init or @file paths), and `.resc` files are parsed into five allowed commands. Engine files that a
    profile uses must be hashed and free of init blocks and URLs.
  - Firmware is checked against the profile's architecture, memory map, boot address and vector table before the
    engine starts, and the engine's initial PC/SP must match that vector table.
  - Unmodeled accesses make a run incomplete, never pass. Virtual and real time are separate fields.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| A renode profile or a profile validator rule | `plugins/renode/profiles/<id>/`, `renode_support/profiles.py` | the profile tests of `renode.test.ts`; the opt-in `VERA_RENODE_REAL` suite for a new profile before `verified` |
| A renode step kind, status or engine command | `renode_support/testsets.py`, `operations.py`, `engine.py`, `tests/fixtures/renode/fake_renode.py` | the stand-in tests and the allow-list test of `renode.test.ts`; the real-engine suite for any new monitor command |

## Files

- `05_Software/plugins/renode/`:
  - the manifest and README;
  - `profiles/stm32f4-discovery/` (`profile.json`, `platform.repl`, `stm32f4.repl`, `machine.resc`);
  - `testsets/board-basics/testset.json`;
  - skill virtual-boards;
  - `scripts/renode_sim.py`;
  - `scripts/renode_support/`: `cli`, `profiles`, `firmware`, `testsets`, `engine`, `operations`, `result`, `report`,
    `errors`, plus `elf` and `workspace` (copies).
- `05_Software/tests/plugins/renode.test.ts` and `tests/fixtures/renode/`:
  - `firmware/`: `demo.c`, `startup.c`, linker scripts, `build.py`, five ELFs and `variants.json`;
  - `fake_renode.py` and `make_engine.py`;
  - `engine/platforms/` (Renode's two STM32F4 descriptions);
  - `stock/stm32f4_discovery.resc`.
- `05_Software/plugins/wokwi/` — manifest, README, skills wokwi-simulation and wokwi-scenarios, `scripts/wokwi_tool.py`
  (entry), `scripts/wokwi_support/` (`cli`, `engine`, `project`, `diagram`, `scenario`, `job`, `credential`, `redact`, `run`,
  `outcome`, `collect`, `operations`, `report`, `workspace` shared).
- `05_Software/tests/plugins/wokwi.test.ts`, `tests/support/fake-wokwi-cli.py` (scripted wokwi-cli recording argv, cwd,
  WOKWI_* environment and the project listing).

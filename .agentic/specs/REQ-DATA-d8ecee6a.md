# zephyr plugin: request, operations, preflight, results and build folders

Governs the `zephyr` plugin (`05_Software/plugins/zephyr/`). Format version 1 everywhere; any other version is invalid
data. Section 9 holds facts observed on the real tools and is filled in as they are observed.

## 1 Programs and supported matrix

| Program | Install | Role |
|---|---|---|
| `zephyr` | `script: scripts/zephyr_tool.py` (PEP 723) | tools, inspect, prepare-workspace, build, artifacts, test-build, test-run, differences, clean |
| `zephyr-flash` | `script: scripts/zephyr_flash.py` (PEP 723), `uses: [stm32_programmer_cli]`, `resources {option: --probe, kinds: [probe]}` | tools, flash, release |
| `stm32_programmer_cli` | find (the stm32-cubeprog plugin's globs) | flash tool of the one verified runner; every direct call blocked |

- Both scripts pin their Python dependencies exactly; `zephyr` includes `west`, `cmake` and `ninja` from PyPI (the host
  tools every operation uses; Windows and Linux wheels exist) and `pytest`, which Twister imports even for build-only
  runs. A `west`, CMake or Ninja on PATH is never used; git is taken from PATH (Zephyr's module script reads the
  manifest through it).
- Zephyr: `>=4.4,<4.6` by `<zephyr>/VERSION`. Zephyr SDK: `>=1.0.1` and at least `<zephyr>/SDK_VERSION`, toolchain
  variant `zephyr` only, the GNU toolchain for the board's architecture inside the SDK folder. Verified board: the
  fixture target `stm32f4_disco`; other boards build when the preflight passes and are reported `unverified-board`.
- Support package `scripts/zephyr_support/` (imported by both scripts, never by another plugin); `workspace.py` is the
  shared byte-identical copy, `elf.py` a copy of gdb-debug's, `registry.py`/`lifecycle.py` follow gdb-debug's.

## 2 Request (`kind: zephyr-request`)

A UTF-8 JSON file in the workbench (at most 64 KiB), named by `--request`. Unknown fields are refused.

```json
{
  "format": 1, "kind": "zephyr-request",
  "workspace": "D:/vera-zephyr/ws",
  "manifest": "manifest",
  "projects": [{"name": "zephyr", "revision": "<40 hex>"}, {"name": "cmsis_6", "revision": "<40 hex>"}],
  "sdk": "D:/vera-zephyr/zephyr-sdk-1.0.1",
  "app": "apps/board-demo",
  "board": "stm32f4_disco",
  "configs": ["prj.conf"], "extraConfigs": ["fast.conf"], "overlays": [],
  "buildDir": "build/zephyr/board-demo",
  "tests": {"root": "tests/ztest-basic", "scenarios": ["vera.ztest.pass"]},
  "hooks": [{"file": "<absolute or workbench path>", "sha256": "<64 hex>", "reason": "text"}]
}
```

- `workspace`: the west top directory (absolute, or workbench-relative); it holds `.west/config` (prepare creates it).
  `manifest`: the manifest repository folder relative to it, holding `west.yml`.
- `projects`: every project the resolved manifest contains (imports resolved), by name, with its full commit SHA, the
  manifest repository excluded. A missing, extra or differently pinned project is a finding (section 4).
- `sdk`: the Zephyr SDK folder (holds `sdk_version` and `cmake/Zephyr-sdkConfig.cmake`). Never guessed: `tools` lists
  detected candidates, the request names one.
- `app`: the application folder (workbench-relative or absolute) with `CMakeLists.txt`.
- `board`: `name[@revision][/qualifiers]`, checked against the board's `board.yml` (section 4).
- `configs` (CONF_FILE, at least one), `extraConfigs` (EXTRA_CONF_FILE), `overlays` (DTC_OVERLAY_FILE, may be empty):
  paths relative to `app`, existing regular files inside it. The build passes them explicitly, so Zephyr picks no
  `boards/<board>.conf|.overlay` on its own; such files in `app` that the request does not list are `implicit-input`.
- `buildDir`: workbench-relative, inside the workbench, outside `.vera`, `app`, `workspace` and `sdk`, never a link.
- `tests` (test-build only): `root`, a test application folder (workbench-relative or absolute) with `testcase.yaml`
  and `CMakeLists.txt`, and `scenarios`, the scenario names to build (at least one). For test-build `app` may equal
  `tests.root`.
- `hooks`: files whose findings the user approves by content; an approval holds only while the hash matches.

## 3 Operations

`zephyr <op> [options]`; each writes one run folder `embedded-lab-results/<run-id>/` (exclusive creation, `--results-dir`
to change the parent) except `tools`, `inspect` (stdout JSON only) and refusals.

| Operation | Options | Effect |
|---|---|---|
| `tools` | `[--request R]` | versions of the helper's west, CMake, Ninja, Python, git on PATH; SDK candidates; with R the Zephyr version, SDK check and project heads |
| `inspect` | `--request R` | offline preflight report (section 4), board and inputs resolved; exit 0 when no refusing finding |
| `prepare-workspace` | `--request R` | `west init -l` when `.west` is missing, then `west update --narrow -o=--depth=1` of the listed projects; verifies heads afterwards |
| `build` | `--request R [--pristine]` | CMake configure + Ninja build into `buildDir`; artifacts copied to the run folder |
| `artifacts` | `--request R` | artifacts and sizes of the existing owned build folder, without building |
| `test-build` | `--request R [--pristine]` | Twister `--build-only` of `tests.scenarios` for `board`, outdir `buildDir/twister` |
| `test-run` | `--test-build RUN --scenario S --evidence RUN` | verdict of a test-build scenario from a LAB-06 renode run folder or a LAB-03 HIL run folder, with the declared differences |
| `differences` | `--build RUN --evidence RUN` | the declared target/model differences of a build's ELF executed in a renode or HIL run |
| `clean` | `--request R` | deletes `buildDir` when its marker is valid (section 6) |

`zephyr-flash flash --request R --build RUN --probe ALIAS --firmware-effect none|actuates` flashes the owned build folder
whose HEX matches the build run `RUN` through west's `stm32cubeprogrammer` runner; `release --probe ALIAS` is VERA's
cleanup (no I/O, physical `unknown`); `tools` reports the CLI's version.

Exit codes: 0 pass (test-build: every scenario built), 1 fail (build or test failure, flash failure), 2 refused (stdout
`{"status":"refused","code","reason"}`, nothing written, no process started), 3 incomplete, blocked, error or stopped.

## 4 Preflight (inspect, and before every operation that starts a process)

Findings `{code, detail, file, sha256, refuse, approved}`; any refusing finding refuses the operation with code
`preflight` and the list. A finding on a file listed in `hooks` with the same SHA-256 becomes `approved` (not
refusing). Never approvable: `extension-shadow`, `project-*`, `west-config`, `west-outer`, `testcase-missing`,
`testcase-nested`. build, test-build and prepare-workspace run the whole preflight (prepare skips `project-missing`
and `project-checkout`, which only the update can settle); zephyr-flash runs the workspace part again before the
probe is opened, because `west flash` imports zephyr's runners and every module's `runners:` code and the workspace
may have changed after the build.

| Code | Condition |
|---|---|
| `west-config` | `.west/config` missing (except prepare), a key outside `manifest.path`, `manifest.file`, `zephyr.base`, `update.narrow`, `update.fetch`, or `manifest.path` ≠ `manifest` |
| `west-outer` | a `.west` folder in a parent of `workspace` (a parent workspace would win for west) |
| `project-unlisted` / `project-missing` / `project-revision` | the resolved manifest has a project the request lacks, lacks one it lists, or pins another full SHA (a branch or tag pin is settled by `project-checkout` after the update) |
| `project-checkout` | a project's checked-out HEAD (read from `.git` files, no git process) differs from its revision |
| `extension-command` | a project other than `zephyr` declares `west-commands` (never invoked; refusing unless approved) |
| `extension-shadow` | such a declaration names `build`, `flash` or `twister` (never approvable) |
| `module-hook` | the manifest repository is itself a module, or a listed module's `zephyr/module.yml` adds `build.settings` roots other than `board_root`/`dts_root`/`soc_root`, or `runners` |
| `module-blobs` | a listed module declares binary blobs (not refusing: they are never fetched; hal_stm32 declares ten) |
| `app-cmake` | `CMakeLists.txt` of app or tests, read by a CMake tokenizer (byte-order mark, line and bracket comments, quoted and bracket arguments), cannot be parsed, or calls a command outside `cmake_minimum_required`, `find_package`, `project`, `target_sources[_ifdef]`, `target_include_directories`, `target_compile_definitions`, `zephyr_library*`, `zephyr_include_directories`, `if/elseif/else/endif`; `find_package` other than exactly `(Zephyr REQUIRED [HINTS $ENV{ZEPHYR_BASE}])`; `$ENV{}` of another variable. The build also passes `-DZephyr_DIR` (section 5). |
| `kconfig-macro` | a Kconfig file of app or tests holds `$(`, `osource`/`rsource`/`orsource` outside the app, or a `source` other than `Kconfig.zephyr` |
| `sysbuild` | `sysbuild.conf`, `sysbuild.cmake`, `Kconfig.sysbuild` or a `sysbuild/` folder in app or tests |
| `implicit-input` | a file under the app's `boards/` or `socs/`, or `app.overlay`/`<board>*.overlay|.conf` in the app folder, that the request does not list |
| `testcase` | a scenario (merged with `common`) with `harness` other than `ztest`/absent, `harness_config`, `extra_args`, `required_snippets`, `extra_conf_files`, `extra_dtc_overlay_files`, `extra_overlay_confs`, or `sysbuild: true` |
| `testcase-missing` | `testcase.yaml` of `tests.root` is missing or has no `tests`, or lacks a requested scenario |
| `testcase-nested` | another `testcase.yaml` or any `sample.yaml` below `tests.root` (Twister builds every suite there whose scenario name matches, and `sample.yaml` wins over `testcase.yaml`) |

Request checks before the preflight (code in brackets): a named folder (workspace, sdk, app, tests.root) or file
missing [`input`], `buildDir` placement [`build-dir`], Zephyr version outside the range [`zephyr-version`], board
unknown [`board`], revision on a board without revisions or unknown revision [`board-revision`], unknown qualifiers
[`board-qualifier`], an existing SDK folder without `sdk_version` and `cmake/Zephyr-sdkConfig.cmake` [`sdk-missing`],
SDK version too old [`sdk-version`], no toolchain for the board's architecture [`sdk-toolchain`].

## 5 Process environment and commands

- Environment: PATH = the helper environment's script folder (west, cmake, ninja) + the system folders of PATH; plus
  SYSTEMROOT/WINDIR/TEMP/TMP/HOME/USERPROFILE/LOCALAPPDATA/APPDATA/PATHEXT/COMSPEC/LANG; `ZEPHYR_BASE`; nothing else
  of the caller (no `ZEPHYR_*`, `WEST_*`, `CMAKE_*`, proxies, VERA variables). Added: `WEST_CONFIG_GLOBAL` and
  `WEST_CONFIG_SYSTEM` = empty files in the run folder, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL` = empty file,
  `GIT_TERMINAL_PROMPT=0`; for every operation except prepare also `GIT_ALLOW_PROTOCOL=file`, `HTTP_PROXY`/`HTTPS_PROXY`/
  `ALL_PROXY` = `http://127.0.0.1:9` and `NO_PROXY` empty.
- build: `cmake -S <app> -B <buildDir> -G Ninja -DBOARD=<board as requested> -DCONF_FILE=<;list> [-DEXTRA_CONF_FILE=..]
  -DDTC_OVERLAY_FILE=<;list or empty: defined, so Zephyr picks no overlay itself> -DZEPHYR_MODULES=<;listed module folders> -DZEPHYR_TOOLCHAIN_VARIANT=zephyr
  -DZEPHYR_SDK_INSTALL_DIR=<sdk> -DZephyr_DIR=<zephyr>/share/zephyr-package/cmake -DPython3_EXECUTABLE=<helper
  python> -DWEST_PYTHON=<helper python> -DCMAKE_MAKE_PROGRAM=<ninja>`, then `cmake --build <buildDir>`. No west
  command, no sysbuild. `Zephyr_DIR` makes `find_package(Zephyr)` take the workspace's own package.
- test-build: `<python> <zephyr>/scripts/twister --build-only -T <tests.root> -p <board> -s <scenario>... --outdir
  <buildDir>/twister --clobber-output -v --inline-logs -x ZEPHYR_MODULES=<;list>` with the same environment plus
  `ZEPHYR_TOOLCHAIN_VARIANT=zephyr` and `ZEPHYR_SDK_INSTALL_DIR`. The scenarios' own configuration (testcase.yaml,
  the test's prj.conf) applies; the request's configs/overlays do not.
- prepare: `<python> -m west init -l <manifest>` (cwd workspace, only when `.west` is missing) and `<python> -m west
  update --narrow -o=--depth=1` without project names: the preflight already refused every project the request does
  not list, so the update fetches exactly the listed ones.
- flash: `<python> -m west flash -d <buildDir> -r stm32cubeprogrammer --no-rebuild --dev-id <probe serial> --cli <CLI>`
  with the CLI's folder first on PATH, cwd workspace; the runner runs `--connect "port=swd reset=HWrst sn=<serial>"
  --download <buildDir>/zephyr/zephyr.hex --start`. Physical state `unknown` from the start of the flash step.

## 6 Build folder ownership

`<buildDir>/.vera-zephyr-build.json`: `{format: 1, kind: "zephyr-build-dir", family, fingerprint, created, runId,
request}` written when the folder is created, plus `lastRun`, `lastStatus` (`running` while a run works, then its
status), `regions` (the linker's memory regions) and `updated`, rewritten by each run. `family` is `build` or
`test-build`; `fingerprint` is the SHA-256 of the canonical JSON of the family, workspace, project revisions, sdk, app,
board, configs, extraConfigs, overlays and, for test-build, tests root and scenarios. `artifacts` refuses a request
whose fingerprint differs from the marker's (`build-dir-mismatch`) and reports `incomplete`/`build-unfinished` when
`lastStatus` is not `pass` (a killed or failed build).

- Absent folder: created with the marker. Folder with a valid marker and equal fingerprint: reused (incremental).
  Valid marker, other fingerprint: refused `build-dir-mismatch` unless `--pristine`, which deletes and recreates it.
  Folder without a valid marker, a link/junction, or a marker of the other family: refused `build-dir-foreign`; never
  deleted, `--pristine` included.
- Deletion (pristine, clean) walks the folder without following links or junctions (a link is unlinked, its target
  kept) and only after the marker and placement checks pass again at deletion time.

## 7 Results

`result.json` (`kind: zephyr-result`): `format, kind, operation, runId, state (running | done), status, code, reason,
started, ended, heartbeat, evidence (build | build-only | virtual | hardware | workspace), tools {helper, python, west,
cmake, ninja, zephyr {base, version, sdkMinimum}, sdk {path, version, toolchain}}, request {path, sha256, content},
workspace {topdir, projects [{name, path, revision, head}]}, board {name, revision, qualifiers, target, arch,
verified}, inputs [{role, path, sha256}], buildDir, artifacts [{role, path, source, sha256, size}], size {regions,
elf}, diagnostics [{code, log, line, text, file?}], findings, steps [{name, command, cwd, exit, log, seconds}]`, and by
operation: build `buildFolder` (created | reused | pristine) and `missing` (roles without a file); artifacts
`missing`, `lastRun`; clean `removed`; test-build and test-run `tests`; test-run `testBuild`, `execution`,
`coverage`, `differences`; differences `execution`, `differences`; flash `flash` {runner, probe, registrySha256,
image, firmwareEffect, cli, physical}. Statuses: `pass`, `fail`, `incomplete`, `blocked`, `skipped`,
`error`, `stopped`; a test that did not run is never `pass`. The run folder also holds the logs and, for build,
`artifacts/` with `zephyr.elf`, `zephyr.hex`, `zephyr.bin`, `config` (final .config), `zephyr.dts`, `zephyr.map`,
`build_info.yml`, `runners.yaml` where present. A run that VERA kills leaves result.json with `state: running` and
its last heartbeat (the status field holds the status reached so far); a `running` run folder whose heartbeat is older
than 90 s reads as `stopped`/`interrupted` when test-run, differences or flash uses it as evidence or as the build
run, and its build folder's marker keeps `lastStatus: running`, which `artifacts` reports as `build-unfinished`.

Tests (`tests`), test-build: `[{scenario, id, platform, status (built | build-error | filtered), twister (Twister's
own status), reason, elf {path, sha256, size}, cases [{name, status: not-run, twister, reason}]}]`, the result status
`incomplete`, code `build-only`, `evidence: build-only` (exit 0) whatever status Twister gives. test-run: `[{scenario,
status, end, cases [{name, status}]}]` with case statuses `pass`, `fail`, `skipped`, `not-run`, `blocked` (started,
no outcome). A case that failed stays failed when a later line passes it, and any `PROJECT EXECUTION FAILED` counts.
Verdict: any fail -> `fail`; no end marker -> `incomplete` (`output-ended`); more than one Zephyr boot banner ->
`incomplete` (`rebooted`); a skipped, blocked or missing case -> `incomplete` (`not-all-passed`); otherwise `pass`. A
`pass` becomes `incomplete` (`execution-<status>`) when the execution run itself is `stopped`, `error`, `blocked` or
`timeout`; an execution run that is `incomplete` (renode-sim's status for unmodeled register accesses) keeps the ztest
verdict, and the accesses it lists appear in `differences`. HIL step logs are read together, so a plan that resets
the board between console captures reads as `rebooted`; a reboot without Zephyr's boot banner is not detected. `junit.xml`: one testcase per case, `skipped` for every status but pass and fail,
`failure` for fail.

## 8 Error analysis

Diagnostics come from the step logs only, each with the log file and 1-based line: `cmake-error` (`CMake Error at`),
`kconfig` (`warning: ... undefined symbol`, `error: Aborting due to Kconfig warnings`, `error: ... Kconfig`),
`devicetree` (`devicetree error:`, dtc/edtlib errors), `compiler` (`<file>:<line>:<col>: error:`), `linker`
(`undefined reference to`, `region ... overflowed`), `ninja` (`FAILED:`), `toolchain` (`Could not find a package
configuration file provided by "Zephyr-sdk"`, `No such file or directory` of the compiler); at most 50, first first.
Input files are hashed before and after; a change is reported `input-changed` (VERA never edits them).

## 9 Observed facts

Real tools on Windows x64, 2026-11-14 (approved downloads in `D:\Temp\vera-zephyr`, SHA-256 verified):
- Zephyr v4.4.2 (dccb0959), CMSIS_6 30a859f4, hal_stm32 fc11896d by `west update --narrow -o=--depth=1`: 510 MB +
  1.1 GB. Zephyr SDK 1.0.1: the minimal bundle's root is `zephyr-sdk-1.0.1/`; the arm toolchain archive's root is
  `arm-zephyr-eabi/` and belongs in `<sdk>/gnu/` (setup.cmd, read not run); GCC 14.3.0. Windows' tar extracts both .7z.
- `zephyr_module.py` calls `west_projects()` (git) even with `ZEPHYR_MODULES`; without git on PATH the configure fails.
- `-DDTC_OVERLAY_FILE=` (empty) counts as defined: Zephyr then picks no app overlay itself
  (`cmake/modules/configuration_files.cmake`). `build_info.yml` lists `kconfig.user-files` and `devicetree.user-files`.
- The board-demo fixture builds in about 30 s (FLASH 1.6 % of 1 MB); a ztest scenario in about 30-40 s.
- Twister imports pytest at start; build-only suites and cases have status `not run`, reason "Test was built only";
  case ids are `<scenario>.<suite>.<case without test_>`; ELFs lie in
  `<outdir>/<board>_<qualifiers>/zephyr_gnu/<test path>/<scenario>/zephyr/zephyr.elf`.
- On the LAB-06 Renode profile `stm32f4-discovery` (Renode 1.17.0) Zephyr images boot. The profile clocks SysTick at
  72 MHz, the board's Zephyr configuration assumes 168 MHz: kernel time advances 0.43x of virtual time (100 ms ticks
  arrive every ~233 ms virtual). `CONFIG_ZTEST` selects `STM32_ENABLE_DEBUG_SLEEP_STOP`, whose DBGMCU_CR (0xE0042004)
  access the model does not implement, so every ztest run is `incomplete` in renode-sim; the board-demo's PA0 button
  interrupt routes through SYSCFG_EXTICR1 (0x40013808), also unmodeled, so board-basics' button case cannot pass.
- `west flash -r stm32cubeprogrammer` with STM32CubeProgrammer 2.23.0 and no probe attached: the runner runs the CLI
  with the serial as `sn=`, the CLI prints "Error: No debug probe detected." and exits 1. `--skip-rebuild` is
  deprecated in favour of `--no-rebuild`.

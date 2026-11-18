# Official plugins: Zephyr and PlatformIO builds

## Routing

Select for `zephyr` (programs `zephyr` for inspect, prepare-workspace, build, artifacts, test-build, test-run,
differences and clean of Zephyr applications from an explicit request, and `zephyr-flash` for the verified
stm32cubeprogrammer runner on a reserved probe; skill zephyr-builds); and `platformio` (programs `platformio` for
tools, inspections, prepare-packages, build, artifacts, test-host, test-device, test-run and clean of PlatformIO
projects from an explicit request, and `platformio-upload` for the verified stlink upload on a reserved probe; skill
platformio-projects).

For zephyr, start at plugins/zephyr/plugin.yaml (programs `zephyr`, `zephyr-flash` with `uses: [stm32_programmer_cli]`
and the probe lease, and the find-only, blocked `stm32_programmer_cli`), scripts/zephyr_tool.py, scripts/zephyr_flash.py
and scripts/zephyr_support/:
- request.py: the zephyr-request document and the build-folder fingerprint;
- model.py: the west workspace read offline (west's Manifest with a file importer, heads from `.git` files);
- boards.py and sdk.py: exact board identifiers and the named SDK folder;
- preflight.py: findings and hook approvals by SHA-256; cmake_scan.py: the CMake tokenizer it reads listfiles with;
- environment.py: the scrubbed, offline process environment;
- builddir.py: owned build folders (marker, safe deletion);
- ops.py: inspect, build, artifacts, clean and the shared checks; diagnostics.py and artifacts.py;
- tests.py and ztest.py: Twister build-only, test-run, differences; prepare.py; tools.py;
- flash.py, registry.py and lifecycle.py: the verified runner; elf.py and workspace.py are the shared copies.

The spec is .agentic/specs/REQ-DATA-d8ecee6a.md (section 9 records the observed Zephyr, SDK, Twister, Renode and
STM32CubeProgrammer facts). Coverage: tests/plugins/zephyr.test.ts with tests/fixtures/zephyr/ (apps/board-demo,
tests/ztest-basic, workspace/manifest/west.yml, stand-ins/: a fake Zephyr tree with a Twister stand-in and a `flash`
extension the real west loads, fake_cmake.py, fake_cli.py), run with a Python holding the pinned dependencies
(`VERA_ZEPHYR_PYTHON`); the opt-in `VERA_ZEPHYR_REAL` suite builds with the real tools, with `VERA_RENODE_REAL` and
`VERA_ZEPHYR_REAL_CLI` also on the real Renode and STM32CubeProgrammer. The plugin has no platform seam of its own: the probe lease is
the platform's `probe` registry kind.

For platformio, start at plugins/platformio/plugin.yaml (programs `platformio` and `platformio-upload` with the
probe lease), scripts/pio_tool.py, scripts/pio_upload.py and scripts/pio_support/:
- request.py: the platformio-request document and the build-folder fingerprint;
- config.py: platformio.ini through PlatformIO's own ProjectConfig under the scrubbed environment (effective options
  keyed by PlatformIO's canonical option names, with their source sections);
- preflight.py: findings and hook approvals by SHA-256; packages.py: the core and libdeps folders read offline;
- environment.py: the scrubbed process environment and the closed proxy; builddir.py: owned build folders;
- ops.py: tools, inspections, build, artifacts, clean and the shared checks; prepare.py; diagnostics.py, artifacts.py;
- tests.py and unity.py: test-host, test-device, test-run; upload.py, registry.py and lifecycle.py: the verified
  upload; elf.py and workspace.py are the shared copies.

The spec is .agentic/specs/REQ-DATA-865c8fbd.md (section 9 records the observed PlatformIO facts). Coverage:
tests/plugins/platformio.test.ts with tests/fixtures/platformio/ (board-demo: two STM32F4DISCOVERY environments,
one extending the other, a native environment, common.ini through extra_configs, Unity suites test_lines, test_skip,
test_fail and a custom unity_config for the CMSIS framework; stand-ins/: fake_pio.py and a fake core), run with a
Python holding the pinned dependencies (`VERA_PIO_PYTHON`); platformio.ini is always read by the real PlatformIO
parser. The opt-in `VERA_PIO_REAL` suite builds and tests with the real PlatformIO, with `VERA_PIO_REAL_GCC` also the
native host tests and with `VERA_RENODE_REAL` the firmware on the real Renode profile. The plugin has no platform seam
of its own.

The conventions shared by all official plugins (package format, catalog source, packs, versions and evidence
levels) and the page of every other plugin are in [Official plugins](official-plugins.md). The platform that
installs, classifies, approves and runs these programs is [Plugins](plugins.md); plugin skill discovery is
[Skills](skills.md).

## Public interface

- `zephyr` 0.2.0, ecosystem `lab` (pack Embedded lab, group Zephyr builds and tests, default on; activities
  build/testing/flash), Windows x64/Linux x64. Supported: Zephyr >=4.4,<4.6, Zephyr SDK >=1.0.1 (toolchain variant
  `zephyr`, GNU toolchain in `<sdk>/gnu/`), verified board `stm32f4_disco`.
  - `zephyr` (PEP 723, pinned west 1.5.0, cmake 4.4.4, ninja 1.13.2, pytest 9.2.0 and Zephyr's build/Twister imports):
    `tools [--request]`, `inspect`, `artifacts`, `test-run --test-build --scenario --evidence`, `differences --build
    --evidence` (safe); `build [--pristine]`, `test-build [--pristine]`, `clean` (device-write, host execution or
    deletion; build/test-build rule timeout 3600); `prepare-workspace` (device-write, network).
  - `zephyr-flash` (PEP 723, west and the runner's imports): `tools`, `release` (safe), `flash --request --build
    --probe --firmware-effect none|actuates` (device-write, irreversible with actuates), resources `--probe` kind
    probe, grace 30 s, cleanup release. `stm32_programmer_cli` is find-only and blocked.
  - The request (format 1, kind zephyr-request) names workspace, manifest folder, every project at its full SHA, the
    SDK folder, the app, the exact board, configs/extraConfigs/overlays, the owned buildDir, optional tests and hooks.
  - Results in `embedded-lab-results/<run-id>/`: result.json kind `zephyr-result` (state running/done), step logs,
    `artifacts/` for build (zephyr.elf/hex/bin, config, zephyr.dts, zephyr.map, build_info.yml, runners.yaml with
    SHA-256), junit.xml for test-build/test-run. Exit 0 pass (test-build: built), 1 fail, 2 refused, 3 incomplete,
    blocked, error or stopped.
  - Evidence: Windows 11 offline (stand-ins, real west and git for prepare-workspace, VERA's real runner for Stop and
    the probe lease) and the real tools: Zephyr 4.4.2 + SDK 1.0.1 builds of the fixtures, Twister
    build-only, ztest pass/skip/fail on the real Renode 1.17.0 profile, west flash through the real STM32CubeProgrammer
    2.23.0 with no probe attached. No board flashed, no native Ubuntu run yet.

- `platformio` 0.2.0, ecosystem `lab` (pack Embedded lab, group PlatformIO projects, default on; activities
  build/testing/flash), Windows x64/Linux x64. PlatformIO Core 6.2.0 pinned with its dependency closure; verified:
  `platformio/ststm32@20.0.0` + board `disco_f407vg` + framework `cmsis` (upload `stlink`), `platformio/native@1.2.1`,
  Unity 2.6.1.
  - `platformio` (PEP 723): `tools [--request]`, `inspect-project`, `inspect-environments`, `artifacts`, `test-run
    --test-device --suite --evidence` (safe); `build [--pristine]`, `test-host [--pristine]`, `test-device
    [--pristine]`, `clean` (device-write, host execution or deletion; rule timeout 3600); `prepare-packages`
    (device-write, network).
  - `platformio-upload` (PEP 723): `tools`, `release` (safe), `upload --request --build --probe --firmware-effect
    none|actuates` (device-write, irreversible with actuates), resources `--probe` kind probe, grace 30 s, cleanup
    release.
  - The request (format 1, kind platformio-request) names the project folder, the environment, the core folder, the
    owned buildDir, optional tests, hostToolchain and hooks.
  - Results in `embedded-lab-results/<run-id>/`: result.json kind `platformio-result` (state running/done), step logs,
    `artifacts/` (firmware.elf/bin/hex, program for native, per-suite test ELFs) with SHA-256, junit.xml for tests,
    PlatformIO's own JSON/JUnit test reports. Exit 0 pass (test-device: built), 1 fail, 2 refused, 3 incomplete,
    blocked, error or stopped.
  - Evidence: Windows 11 offline (real PlatformIO parser, stand-in commands, VERA's real runner) and the real
    tools: ststm32 20.0.0/CMSIS builds of two environments offline, native Unity on WinLibs GCC 16.2.0,
    device suites and board-basics on the real Renode 1.17.0. No board uploaded, no native Ubuntu run yet.

## Invariants

- zephyr: builds call CMake and Ninja directly (never `west build`) with `ZEPHYR_MODULES` = the listed modules,
  `-DDTC_OVERLAY_FILE` always defined, no sysbuild, a scrubbed environment (no ZEPHYR_*/WEST_*/CMAKE_* or VERA
  variables, empty west/git global configs, a closed loopback proxy, `GIT_ALLOW_PROTOCOL=file`). Only
  prepare-workspace runs `west update`.
  - Every refusal happens before a run folder or process exists. Unlisted projects, other revisions or checkouts,
    extension commands of projects other than zephyr, module build roots or runners, CMake commands outside the
    allowlist (read by a tokenizer: BOM, bracket and quoted arguments, comments; find_package only for Zephyr, with
    `-DZephyr_DIR` pinned), Kconfig macros/sources, sysbuild files, implicit board inputs, Twister harnesses other than
    ztest and nested or sample.yaml suites are findings; a file approved by SHA-256 in `hooks` passes while unchanged;
    shadowing build/flash/twister, project and nested-suite findings never. zephyr-flash reruns the workspace part.
  - A build folder is VERA's only with its marker of the same family and fingerprint; `--pristine` and `clean` delete
    only such folders, re-checked, without following links or junctions. build_info.yml user files beyond the
    request make the build `error` (undeclared-input).
  - Twister runs build-only; every case is `not-run`, the run `incomplete`. test-run takes the verdict from a renode or
    HIL run of exactly the scenario's ELF (SHA-256); a failure stays failed across reruns, a reboot or a skip or missing
    case is `incomplete`, never pass, and virtual
    verdicts carry the target/model differences (clock, unmodeled registers).
  - Flash: only stm32cubeprogrammer, runners.yaml arguments `--port=swd`/`--reset-mode=hw`, the HEX equal to the
    build run's and inside the build devicetree's `zephyr,flash` region; physical state `unknown` once flashing starts.
  - Results are always `evidence: virtual`, with a fixed not-covered list (electrical timing, power, EMI, SPICE).
  - Renode's Robot keyword server is never started: it listens on every interface on Linux.
- platformio: platformio.ini is read only by PlatformIO's own ProjectConfig, in the project folder and under the
  scrubbed environment the build gets; effective options are judged under PlatformIO's canonical names (old spellings
  such as extra_script or lib_install included). PlatformIO runs as the helper's `python -m platformio` with
  `-e <environment>` and explicit targets (`buildprog`; `nobuild` + `upload` only in platformio-upload), its workspace
  and libdeps in the owned build folder, telemetry and upgrade checks off and, except prepare-packages, a closed
  loopback proxy and PlatformIO's registry cache disabled (it otherwise installs from its caches with no network).
  No PLATFORMIO_* variable of the caller reaches it.
  - Every refusal happens before a run folder or process exists. Extra scripts, library build scripts, custom test
    runners and local board files are findings approvable by SHA-256 in `hooks`; '!' items (raw after PlatformIO's
    split and effective), ${sysenv.*}, `$` in script/library paths, `$` substitutions SCons would evaluate as Python
    (also in library.properties and mbed manifests), `.pio-link` libraries, more than 256 library folders, platform
    packages, non-registry or inexact platforms and libraries, custom upload commands, `targets`, PlatformIO folder
    options and extra_configs outside the project never. A missing platform, framework package, toolchain, tool-scons
    or library - the test framework whenever the project has `test_*` suites - is `packages-missing`.
  - A build folder is VERA's only with its marker of the same project, environment and core; `--pristine` and
    `clean` delete only its build/test-host/test-device folders, without following links; libdeps and the project's
    own .pio stay.
  - test-host runs only native environments and named suites; a skipped or errored case is never a pass.
    test-device builds only (`incomplete`, `build-only`); test-run takes a verdict from a renode or HIL run of exactly
    the suite's ELF (SHA-256) and Unity's output; a failure stays failed, a missing summary or count mismatch is
    `incomplete`.
  - Upload: protocol `stlink` only, no upload_flags of the project, the firmware equal to the build run's, every
    uploader the platform declares installed (prepare-packages installs them only with `upload: true`), the probe
    serial passed to OpenOCD through PLATFORMIO_UPLOAD_FLAGS; physical state `unknown` once the upload starts.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| A zephyr preflight finding or allowlist | `zephyr_support/preflight.py`, spec REQ-DATA-d8ecee6a §4 | the preflight test of `zephyr.test.ts` |
| A zephyr build/test command line or environment | `zephyr_support/ops.py`, `tests.py`, `environment.py`, `tests/fixtures/zephyr/stand-ins/` | the stand-in build/test-build tests of `zephyr.test.ts`; the opt-in `VERA_ZEPHYR_REAL` suite |
| Another zephyr flash runner | `zephyr_support/flash.py`, `plugin.yaml` (a find program per tool) | the flash tests of `zephyr.test.ts`; a real board before it is called verified |
| A platformio preflight finding | `pio_support/preflight.py`, `config.py`, spec REQ-DATA-865c8fbd §4 | the preflight test of `platformio.test.ts` (real ProjectConfig) |
| A platformio command line, environment or package check | `pio_support/ops.py`, `tests.py`, `environment.py`, `packages.py`, `tests/fixtures/platformio/stand-ins/` | the stand-in tests of `platformio.test.ts`; the opt-in `VERA_PIO_REAL` suite |
| Another platformio upload protocol | `pio_support/upload.py` (PROTOCOLS), `prepare.py` (UPLOADERS) | the upload tests of `platformio.test.ts`; a real board before it is called verified |

## Files

- `05_Software/plugins/zephyr/` — manifest, README, skill zephyr-builds, `scripts/zephyr_tool.py` and
  `scripts/zephyr_flash.py` (entries), `scripts/zephyr_support/` (`cli`, `request`, `model`, `boards`, `sdk`,
  `preflight`, `cmake_scan`, `environment`, `builddir`, `ops`, `diagnostics`, `artifacts`, `prepare`, `tests`, `ztest`, `tools`,
  `flash`, `registry`, `lifecycle`, `result`, `errors`, plus `elf` and `workspace` copies).
- `05_Software/tests/plugins/zephyr.test.ts` and `tests/fixtures/zephyr/` (`apps/board-demo/`,
  `tests/ztest-basic/`, `workspace/manifest/west.yml`, `stand-ins/`).
- `05_Software/plugins/platformio/` — manifest, README, skill platformio-projects, `scripts/pio_tool.py` and
  `scripts/pio_upload.py` (entries), `scripts/pio_support/` (`cli`, `request`, `config`, `preflight`, `packages`,
  `environment`, `builddir`, `ops`, `prepare`, `tests`, `unity`, `diagnostics`, `artifacts`, `upload`, `registry`,
  `lifecycle`, `result`, `errors`, `elf`, `workspace`).
- `05_Software/tests/plugins/platformio.test.ts` and `tests/fixtures/platformio/` (`board-demo/`, `stand-ins/`).

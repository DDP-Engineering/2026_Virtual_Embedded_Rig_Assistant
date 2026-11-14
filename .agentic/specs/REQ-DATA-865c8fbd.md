# platformio plugin: request, operations, preflight, results and build folders

Governs the `platformio` plugin (`05_Software/plugins/platformio/`). Format version 1 everywhere; any other version is
invalid data. Section 9 holds facts observed on the real tools.

## 1 Programs and supported matrix

| Program | Install | Role |
|---|---|---|
| `platformio` | `script: scripts/pio_tool.py` (PEP 723) | tools, inspect-project, inspect-environments, prepare-packages, build, artifacts, test-host, test-device, test-run, clean |
| `platformio-upload` | `script: scripts/pio_upload.py` (PEP 723), `resources {option: --probe, kinds: [probe]}` | tools, upload, release |

- Both scripts pin PlatformIO Core `6.2.0` and its whole dependency closure exactly. PlatformIO runs as
  `<helper python> -m platformio`; a `pio` on PATH or a `~/.platformio` folder is never used implicitly.
- Verified: platform `platformio/ststm32@20.0.0` with board `disco_f407vg` and framework `cmsis` (upload protocol
  `stlink` through the platform's `tool-openocd`), platform `platformio/native@1.2.1` with the host GCC, test framework
  `unity` (`throwtheswitch/Unity@2.6.1`). Other platforms, boards and frameworks build when the preflight passes and are
  reported `verified: false`.
- Support package `scripts/pio_support/` (imported by both scripts, never by another plugin); `workspace.py` is the
  shared byte-identical copy, `elf.py` gdb-debug's, `lifecycle.py` and `registry.py` follow zephyr's.

## 2 Request (`kind: platformio-request`)

A UTF-8 JSON file in the workbench (at most 64 KiB), named by `--request`. Unknown fields are refused.

```json
{
  "format": 1, "kind": "platformio-request",
  "project": "projects/board demo ș",
  "environment": "disco",
  "core": "D:/Temp/vera-pio/core",
  "buildDir": "build/pio/disco",
  "tests": ["test_lines"],
  "hostToolchain": "D:/Temp/vera-pio/gcc/mingw64/bin",
  "upload": false,
  "hooks": [{"file": "<absolute or workbench path>", "sha256": "<64 hex>", "reason": "text"}]
}
```

- `project`: the folder holding `platformio.ini` (absolute or workbench-relative; spaces and any Unicode letters are
  fine, control characters are not).
- `environment`: the `[env:NAME]` to act on. Required by prepare-packages, build, artifacts, test-host, test-device,
  clean and upload, optional for inspect-environments; it must be one the project defines. `default_envs` is never
  used.
- `core`: the PlatformIO core folder (`PLATFORMIO_CORE_DIR`: `platforms/`, `packages/`, `appstate.json`), absolute or
  workbench-relative, an existing folder.
- `buildDir`: workbench-relative, inside the workbench, outside `.vera`, `embedded-lab-results`, the project and the
  core folder, never a link. The owned build folder (section 6).
- `tests` (test-host, test-device): 1...16 suite names, each a folder under the project's `test/` (`test_dir`); they
  become `--filter` patterns. Running "all tests" is not offered.
- `hostToolchain` (environments of platform `native`): the folder holding `gcc`/`g++` (and `ar`, `ranlib`), placed
  first on the PATH PlatformIO sees; refused for other platforms.
- `upload` (prepare-packages): `true` also installs every uploader the platform declares (PlatformIO requires all of
  them for an upload target); default `false`.
- `hooks`: files whose findings the user approves by content; an approval holds only while the hash matches.

## 3 Operations

`platformio <op> [options]`; each writes one run folder `embedded-lab-results/<run-id>/` (exclusive creation,
`--results-dir` to change the parent) except `tools`, the two inspections (stdout JSON only) and refusals.

| Operation | Options | Effect |
|---|---|---|
| `tools` | `[--request R]` | helper, PlatformIO Core and Python versions; with R the core folder's platforms/packages and the build folder's libraries |
| `inspect-project` | `--request R` | parsed files with SHA-256, environments, `[platformio]` options, findings of every environment |
| `inspect-environments` | `--request R` | effective options with their source sections, resolved platform/board/framework/test framework/upload protocol, install state; one environment when R names it |
| `prepare-packages` | `--request R` | `pkg install -d PROJECT -e ENV --no-save`, the build engine `tool-scons@4.41101.0` and, with `upload: true` and a verified protocol, every uploader the platform declares (a J-Link package only for jlink) into `core` and `buildDir/libdeps`; the only operation with network |
| `build` | `--request R [--pristine]` | `run -e ENV -t buildprog` in `buildDir/build`; artifacts copied |
| `artifacts` | `--request R` | artifacts and sizes of the owned folder's last build, without building |
| `test-host` | `--request R [--pristine]` | `test -e ENV --filter S...` for a `native` environment, with PlatformIO's JSON and JUnit reports |
| `test-device` | `--request R [--pristine]` | `test -e ENV --filter S... --without-uploading --without-testing`: test firmware only |
| `test-run` | `--test-device RUN --suite S --evidence RUN` | verdict of a test-device suite from a LAB-06 renode run or a LAB-03 HIL run of the same ELF |
| `clean` | `--request R` | deletes `buildDir/build`, `buildDir/test-host`, `buildDir/test-device` when the marker is valid |

`platformio-upload upload --request R --build RUN --probe ALIAS --firmware-effect none|actuates` uploads the owned
build of RUN through PlatformIO's `nobuild` and `upload` targets; `release --probe ALIAS` is VERA's cleanup (no I/O,
physical `unknown`); `tools` reports the helper and PlatformIO versions.

Exit codes: 0 pass (test-device: built), 1 fail, 2 refused (nothing written), 3 incomplete, blocked, error or stopped.

## 4 Preflight

Read with PlatformIO's own `ProjectConfig` (the project file and every `extra_configs` file it loads) while
`os.environ` is the scrubbed environment of section 5, then every raw value of every option of every parsed file and
the effective values of the selected environment (all environments for inspect-project). A finding is
`{code, file, section, option, value, detail, refusing, approvable, approved, sha256}`.

| Code | Trigger | Approvable by file hash |
|---|---|---|
| `extra-script` | an `extra_scripts` entry (`pre:`/`post:` stripped) | yes (the script file) |
| `extra-script-missing` | that file does not exist | no |
| `library-script` | `build.extraScript` of a `library.json` under `lib_dir`, `lib_extra_dirs` or `buildDir/libdeps/ENV` | yes (the script file) |
| `library-link` | a `*.pio-link` file in one of those folders (PlatformIO builds the folder it names) | no |
| `library-limit` | more than 256 library folders in one of those folders | no |
| `scons-variable` | a `$` in an effective `extra_scripts` or `lib_extra_dirs` entry or a library `build.extraScript` (SCons expands it after the preflight) | no |
| `scons-expression` | a `$` substitution SCons would evaluate as Python in any effective environment or `[platformio]` value or library `build` field: anything but `$$`, `$(`, `$)`, `$NAME` or `${NAME}` with a plain name (`${len('x')}`, `$NAME.attr`) | no |
| `custom-test-runner` | `test_framework = custom` or a `test_custom_runner.py` under `test_dir` | yes (the runner file) |
| `local-board` | a `boards_dir` JSON for the environment's board | yes (the board file) |
| `testing-command` | `test_testing_command` | no |
| `shell-flag` | a value item beginning with `!` - raw items split as PlatformIO splits them (by line, else by `, `) and every effective item after interpolation; also library `build.flags/srcFlags/unflags` (SCons runs it through the shell) | no |
| `sysenv` | a `${sysenv.NAME}` interpolation | no |
| `platform-packages` | `platform_packages` | no |
| `platform-spec` | a platform not `owner/name@X.Y.Z` | no |
| `library-spec` | a `lib_deps` entry not `owner/name@X.Y.Z` | no |
| `config-outside` | a parsed file outside the project folder | no |
| `folder-option` | a `[platformio]` workspace/core/cache folder option (`core_dir` and its old name `home_dir`, `globallib_dir`, `platforms_dir`, `packages_dir`, `cache_dir`, `build_cache_dir`, `workspace_dir`, `build_dir`, `libdeps_dir`), or a source folder option outside the project | no |
| `upload-command` | `upload_command`, or `upload_protocol = custom` | no |
| `targets` | a `targets` option | no |
| `lib-extra-dirs` | a `lib_extra_dirs` entry outside the project | no |
| `config-warning` | PlatformIO's own warnings (unknown or renamed option) | not refusing |
| `default-envs` | `default_envs` (never used) | not refusing |

Options are judged under PlatformIO's current names (an old spelling such as `extra_script`, `src_filter` or
`lib_install` is read under the new one, with PlatformIO's own lookup). Raw findings (`shell-flag`, `sysenv`,
`targets`, `folder-option` of a section) are project-wide: they refuse every environment. An `extra_configs` pattern
that is absolute, a network or device path, starts with `~` or climbs with `..` is refused (code `config-outside`)
before PlatformIO reads it, also in the safe inspections; so is a match that resolves outside the project
through a link. Libraries without library.json are judged too: every `library.properties` value (Arduino's ldflags)
and every `module.json`/`mbed_lib.json` string gets the `shell-flag` and `scons-expression` checks.
Known limits (accepted in review): `mbed_lib.json` files in a library's subfolders are not searched, and a
`library.properties` is read up to 1 MiB; both matter only for mbed/Arduino libraries, outside the verified matrix.

Every process-starting operation refuses (code `preflight`, exit 2) while a refusing finding of the selected
environment is not approved. A parse error is code `input`.

## 5 Process environment

PlatformIO gets: the system variables (`SYSTEMROOT`, `WINDIR`, `TEMP`, `TMP`, `HOME`, `USERPROFILE`, `LOCALAPPDATA`,
`APPDATA`, `PROGRAMDATA`, `PATHEXT`, `COMSPEC`, `LANG`, `LC_ALL`, `NUMBER_OF_PROCESSORS`, `PROCESSOR_ARCHITECTURE`),
`PATH` = [hostToolchain] + the helper's Python folder + the system folders, `PLATFORMIO_CORE_DIR`,
`PLATFORMIO_WORKSPACE_DIR` (= `buildDir/<family>`), `PLATFORMIO_LIBDEPS_DIR` (= `buildDir/libdeps`),
`PLATFORMIO_SETTING_ENABLE_TELEMETRY=No`, `PLATFORMIO_SETTING_CHECK_PLATFORMIO_INTERVAL=3650`,
`PLATFORMIO_DISABLE_UPGRADE_CHECK=true`, `PLATFORMIO_DISABLE_PROGRESSBAR=true`, `PLATFORMIO_NO_ANSI=true`,
`PYTHONUTF8=1`, `PYTHONDONTWRITEBYTECODE=1`, `NO_COLOR=1`. Nothing else of the caller survives (no
`PLATFORMIO_*` of the caller: `PLATFORMIO_EXTRA_SCRIPTS`, `PLATFORMIO_BUILD_FLAGS`, ... would be appended to the
project's values). Every operation but prepare-packages adds `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` (both cases) =
`http://127.0.0.1:9`, an empty `NO_PROXY` and `PLATFORMIO_SETTING_ENABLE_CACHE=No` plus `PLATFORMIO_CACHE_DIR` = an empty `pio-cache` folder of the run (the
setting only stops cache writes; PlatformIO would otherwise resolve a package from its cached registry answers and
install it from its download cache with no network at all): an install attempt fails instead of installing.
prepare-packages instead keeps the caller's `HTTP(S)_PROXY`, `ALL_PROXY`, `NO_PROXY`, `REQUESTS_CA_BUNDLE`,
`SSL_CERT_FILE` and `SSL_CERT_DIR`.

Before PlatformIO starts (build, test-host, test-device, upload) the helper checks offline that the core holds the
platform at the exact version, the framework packages the platform manifest names for the environment's frameworks,
a toolchain package, `tool-scons`, and that `buildDir/libdeps/ENV` holds every `lib_deps` entry and, whenever the
project has `test_*` suites, the test framework (PlatformIO adds Unity to every `pio run` of such a project);
otherwise code `packages-missing`. Packages the platform's own code adds are guarded by the closed proxy only.

## 6 Owned build folder

`buildDir` holds `.vera-platformio-build.json` = `{format: 1, kind: "platformio-build-dir", fingerprint, project,
environment, core, created, runId, runs: {build|test-host|test-device: {runId, status, updated}}}`; `fingerprint` =
SHA-256 of `{project, environment, core}` (resolved paths). Families `build`, `test-host`, `test-device` use
`buildDir/<family>` as PlatformIO's workspace (build output in `buildDir/<family>/build/ENV/`); `buildDir/libdeps`
is shared and written only by prepare-packages.

- A missing `buildDir` is created with the marker. An existing one without a valid marker, or a link, is
  `build-dir-foreign` (never reused or deleted). Another fingerprint is `build-dir-mismatch` unless `--pristine`
  (which deletes the family folders, keeps libdeps and rewrites the marker; prepare-packages refills libdeps when an
  environment's libraries are missing).
- clean deletes the three family folders only; deletion re-checks the marker and never follows links or junctions
  (a link is removed, its target stays). The project's own `.pio`, the core and libdeps stay.

## 7 Results (`kind: platformio-result`)

`embedded-lab-results/<run-id>/result.json`, written at once with `state: running`, rewritten with a heartbeat while
a step runs and finally with `state: done`. A `running` document whose heartbeat is older than 90 s reads as
`stopped`/`interrupted` (the run reserves nothing, so VERA's Stop is a tree kill).

Fields: `format, kind, operation, runId, state, status (pass|fail|incomplete|blocked|skipped|error|stopped), code,
reason, started, ended, heartbeat, evidence (build|build-only|host|virtual|hardware|none), tools {helper, platformio,
python}, request {path, sha256, content}, project {path, files: [{path, sha256}]}, environment {name, platform, board,
framework, testFramework, uploadProtocol, native, options: {option: {value, section, spelled?}}, verified}, packages
[{kind, name, version, owner, path, manifestSha256}], inputs {before: {path: sha256}, after}, buildDir, artifacts [{role elf|bin|hex|program,
path (run-folder relative copy), source, sha256, size}], size {usage: {flash|ram: {used, limit, percent}} (PlatformIO's own summary, kept in the
marker for `artifacts`), limits: {flash, ram} (the board's), elf: {machine, entry, text, data, bss, sections}},
diagnostics [{file, line, message, log, logLine}], findings, steps [{name, command, cwd, exit, log, seconds}],
tests [{suite, status, cases: [{name, status, file, line, message}]}]`.

Statuses: build pass only with exit 0 and an ELF; test-host per case `PASSED/FAILED/SKIPPED/ERRORED` ->
`pass/fail/skipped/error`, run fail > error > incomplete (any skipped or no case) > pass; test-device `incomplete`
code `build-only` (exit 0), each suite `built` with its ELF and no case reported; test-run from a renode-sim (`renode-result`) or HIL
(`hil-test-result`) run whose `firmware.sha256` equals the suite ELF: Unity lines `<file>:<line>:<case>:PASS|FAIL[:
msg]|IGNORE[: msg]` and the summary `<n> Tests <f> Failures <i> Ignored` + `OK|FAIL`; a FAIL stays a FAIL; a missing
summary, a summary count that differs from the cases, a second summary (a reboot), an IGNORE or an execution run whose
own status is not `pass` is `incomplete`. A JUnit `junit.xml` is written for test results.

## 8 Upload

Checks before anything opens: the request's preflight is clean; RUN is a `platformio-result` `build` run of the same
request environment and project; the owned folder's `build/build/ENV/firmware.elf` has the run's ELF SHA-256; the
environment's `upload_protocol` (or the board default) is in `{stlink}`; the probe alias is a `probe` entry of
`lab/resources.json` (whose hash VERA approved). Then `run -e ENV -t nobuild -t upload` with
`PLATFORMIO_UPLOAD_FLAGS` = `-c "adapter serial <serial>"`; physical state `unknown` from the start of the upload.
Every uploader package the platform declares must be installed (`packages-missing` otherwise): PlatformIO's
`configure_default_packages` makes all of them required for an upload target.
release: no I/O, physical `unknown`.

## 9 Observed tool facts

Real runs on Windows 11 x64, 2026-11-14, PlatformIO Core 6.2.0 from PyPI in a uv venv (CPython 3.12.13), the approved
registry packages in `D:\Temp\vera-pio\core` (installed by the helper's own prepare-packages; PlatformIO checks
each registry SHA-256 before unpacking), WinLibs GCC 16.2.0 r2 (zip SHA-256 d5dbafc4...276a checked before
extraction) and the LAB-06 Renode 1.17.0:

- prepare-packages for `disco` installed ststm32 20.0.0, toolchain-gccarmnoneeabi 1.70201.0 (GCC 7.2.1),
  framework-cmsis 2.50501.200527 (CMSIS 5.5.1), framework-cmsis-stm32f4 2.6.11, tool-ldscripts-ststm32 0.3.0,
  tool-scons 4.41101.0 and Unity 2.6.1 in about 60 s; for `native` the platform native 1.2.1. platformio.ini
  unchanged. Unity 2.6.1's library.json declares `build.extraScript: platformio-build.py` (SHA-256
  64758324...a3d4; it only adds UNITY_INCLUDE_CONFIG_H and the unity_config.h folder), so every operation of a project
  with tests needs that approval.
- `pio run` of a project with `test_*` suites adds Unity to the build's dependencies and, with an empty libdeps,
  installed it from PlatformIO's own registry and download caches (`<core>/.cache/http`, `/downloads`) although
  the proxy was closed. Hence the test framework is required whenever suites exist and offline runs set
  `PLATFORMIO_SETTING_ENABLE_CACHE=No`; afterwards an install attempt fails (`HTTPClientError`).
- `run -e disco -t buildprog` builds offline in about 2 s: firmware.elf/.bin (no HEX for this board), the
  RAM/Flash summary (`RAM: ... (used 32 bytes from 131072 bytes)`), `checkprogsize` included; nothing is written into
  the project (no `.pio`). disco and disco_fast give different ELFs.
- The disco ELF passes board-basics on the LAB-06 Renode profile with all four cases (banner `VERA-FW
  platformio-demo`, version 1.2.3, UART echo, 10 ticks per virtual second, button to LED; 1.12 s virtual, about 15 s
  wall clock): a bare CMSIS image has none of the Zephyr image's unmodeled accesses.
- `test -e native` with the WinLibs GCC first on the child's PATH: test_lines pass (4 cases), test_skip incomplete
  (IGNORE), test_fail fail. When the test program exits non-zero PlatformIO adds an `ERRORED` pseudo-case named
  `<env>:<suite>` to its JSON report.
- `test -e disco --without-uploading --without-testing` builds each suite's firmware.elf; on the Renode profile
  (`capture-uart --until ^(OK|FAIL)`) test-run gives test_lines pass, test_skip incomplete, test_fail fail
  (evidence virtual). The custom test/unity_config.c on USART2 is required: Unity has no CMSIS configuration.
- `run -e disco -t nobuild -t upload` (stlink): PlatformIO's base platform makes every uploader package of ststm32
  required (tool-stm32flash, tool-stm32duino, tool-openocd, tool-dfuutil, tool-dfuutil-arduino); only tool-openocd
  3.1200.7 was approved, so the run stopped at installing tool-stm32flash behind the closed proxy (exit 1, nothing
  opened). The helper now refuses that case as `packages-missing` before PlatformIO starts. OpenOCD itself was not
  reached; no probe is attached.
- Known limit (accepted in review): the uploader check keeps tool-jlink only for a jlink protocol, while ststm32's
  platform code also keeps it for `debug_tool = jlink` or a board whose debug tools name J-Link; then PlatformIO's
  install attempt fails behind the closed proxy (exit 1, nothing opened) instead of `packages-missing`.

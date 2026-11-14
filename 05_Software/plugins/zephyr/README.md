# Zephyr builds, tests and flashing

Build, test and flash Zephyr RTOS applications through checked operations. The agent writes an explicit request; the
helpers run fixed command lines and never offer west, CMake, Twister or the programmer as free commands.

## What you install

- **The plugin's programs** (Install programs): two Python helpers whose pinned dependencies include west 1.5.0,
  CMake 4.4.4 and Ninja 1.13.2 from PyPI. These are the host tools every operation uses, on Windows and Linux.
- **A Zephyr SDK** (yourself): 1.0.1 or newer with the GNU toolchain of your board's architecture extracted in its
  `gnu/` folder. VERA does not run the SDK's setup script, register a CMake package or change PATH; the request names
  the SDK folder.
- **A west workspace** (yourself, or `zephyr prepare-workspace`, which runs `west init -l` and `west update` with
  network access as a separately approved step). Supported Zephyr: 4.4 and 4.5. Keep paths short on Windows.
- **STM32CubeProgrammer** for flashing (found where ST installs it).

## Operations

| Program | Operation | Risk |
|---|---|---|
| `zephyr` | `tools`, `inspect`, `artifacts`, `test-run`, `differences` | safe (reads, writes run folders) |
| `zephyr` | `build`, `test-build` | device-write: host execution of the workspace's and application's code |
| `zephyr` | `clean` | device-write: deletes the owned build folder |
| `zephyr` | `prepare-workspace` | device-write: network, changes the workspace |
| `zephyr-flash` | `flash` | device-write (irreversible with `--firmware-effect actuates`), reserves the probe |
| `zephyr-flash` | `tools`, `release` | safe |

## What is checked

- Every project of the resolved manifest must be listed in the request at its full commit SHA, and be checked out
  there. Only zephyr's own extension commands exist; another project declaring west commands is refused.
- Builds call CMake and Ninja directly with `ZEPHYR_MODULES` set to the listed modules, a scrubbed environment, a
  closed loopback proxy and git limited to the file protocol. No west command, no sysbuild, no network.
- Application CMake files may use only plain source/include commands; Kconfig files no `$(...)` macros; sysbuild
  files, implicit `boards/` inputs and Twister harnesses other than ztest are refused. A file the user approves by
  SHA-256 in `hooks` is allowed while its content stays the same.
- Build folders carry a marker binding them to one configuration; `--pristine` and `clean` delete only such folders,
  without following links.
- Twister runs build-only. A test verdict comes only from a renode-sim or HIL run of exactly the test build's ELF;
  skipped or missing cases are never a pass. Virtual results list the target/model differences.
- Flashing: one verified runner (`stm32cubeprogrammer`), allowlisted runner arguments, the HEX equal to the build
  run's and inside the flash region of the build's own devicetree.

Verified matrix: Zephyr 4.4.2, SDK 1.0.1, board `stm32f4_disco`, Windows x64. Native Ubuntu and a real board are not
verified yet.

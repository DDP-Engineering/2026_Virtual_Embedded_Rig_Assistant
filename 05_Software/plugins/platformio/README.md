# PlatformIO projects

Inspect, build, test and upload existing PlatformIO projects through checked operations. The agent writes an
explicit request; the helpers run fixed PlatformIO command lines and never offer `pio` as a free command.

## What you install

- **The plugin's programs** (Install programs): two Python helpers whose pinned dependencies are PlatformIO Core
  6.2.0 and its whole dependency closure from PyPI. PlatformIO runs from the helpers' own environment; a `pio` on
  PATH and your `~/.platformio` are never used unless a request names that folder.
- **A PlatformIO core folder** (any empty folder you choose, named by the request): `platformio prepare-packages`
  fills it from the PlatformIO registry as a separately approved network step (with `"upload": true` also every
  uploader the platform declares). Builds and tests afterwards run offline.
- **A host compiler** for `native` environments (GCC on Linux; a MinGW-w64 GCC on Windows), named by the request's
  `hostToolchain`. VERA does not install it or change PATH.

## Operations

| Program | Operation | Risk |
|---|---|---|
| `platformio` | `tools`, `inspect-project`, `inspect-environments`, `artifacts`, `test-run` | safe (reads, writes run folders) |
| `platformio` | `build`, `test-host`, `test-device` | device-write: host execution of the project's build and test code |
| `platformio` | `clean` | device-write: deletes the owned build folders |
| `platformio` | `prepare-packages` | device-write: network, fills the core and libdeps folders |
| `platformio-upload` | `upload` | device-write (irreversible with `--firmware-effect actuates`), reserves the probe |
| `platformio-upload` | `tools`, `release` | safe |

## What is checked

- platformio.ini and every extra_configs file are read with PlatformIO's own parser, in the environment the build
  gets, so the effective values judged are the ones PlatformIO uses. Every operation names its environment;
  `default_envs` is never used.
- Extra scripts, library build scripts, custom test runners and local board files are refused unless the request
  approves the file by SHA-256 in `hooks`; '!' flags, `${sysenv.*}`, platform packages, platforms or libraries that are
  not exact registry releases, custom upload commands, `targets` and PlatformIO folder options are always refused.
- PlatformIO gets a scrubbed environment (no `PLATFORMIO_*` variable of yours), telemetry and upgrade checks off, its
  workspace and libdeps in the owned build folder, and a closed loopback proxy for everything but prepare-packages.
  A missing platform, framework package, toolchain or library is reported before PlatformIO starts.
- Builds name their targets (`buildprog`); upload, uploadfs, erase or custom targets never run under a build or test.
- test-host runs only the named suites of a `native` environment; skipped or errored cases are never a pass.
  test-device only builds the device suites' firmware; a verdict comes from a renode-sim or HIL run of exactly that
  ELF, parsed from Unity's output.
- Uploads: protocol `stlink` only, the firmware equal to the build run's by SHA-256, PlatformIO's `nobuild` and
  `upload` targets, the probe serial passed to OpenOCD, the physical state `unknown` once the upload starts.
- Build folders carry a marker binding them to one project, environment and core folder; `--pristine` and `clean`
  delete only the operation folders inside such a folder, without following links.

Verified matrix (Windows x64, 2026-11-14): platform `platformio/ststm32@20.0.0` with board `disco_f407vg` and
framework `cmsis` (builds; device tests on the renode plugin's profile), platform `platformio/native@1.2.1` with
WinLibs GCC 16.2.0, Unity 2.6.1. A project with Unity tests needs Unity's own build script approved. Uploading to a
real board, native Ubuntu and other boards or frameworks are not verified yet.

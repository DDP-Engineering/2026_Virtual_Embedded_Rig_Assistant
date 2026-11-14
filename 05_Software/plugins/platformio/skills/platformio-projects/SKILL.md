---
name: platformio-projects
description: Build, test and upload existing PlatformIO projects through checked operations - write the explicit request (project folder, environment, core folder, owned build folder), inspect platformio.ini and the effective environments offline, prepare packages once as a network step, build offline with hashed artifacts and versions, run native Unity tests on the host, build device tests only and take their verdict from a real Renode or HIL run of the same ELF, and upload through the verified ST-Link protocol with a reserved probe. Use for any PlatformIO project in the workbench.
---

Use `run_program` with programs `platformio` and `platformio-upload`. Never ask for `pio` or `platformio` directly:
it is not offered. Never edit platformio.ini, a script or the code to make a build pass; report the diagnostics and
let the user decide.

## 1. The request

Write a JSON file in the workbench, for example `platformio/disco.json`:

```json
{"format": 1, "kind": "platformio-request",
 "project": "firmware/board demo", "environment": "disco",
 "core": "D:/pio-core", "buildDir": "build/pio/disco"}
```

- `environment` is required for every operation on an environment; never pick one yourself from `default_envs` -
  ask the user when the project has several.
- `core` is the PlatformIO core folder the user chose; `buildDir` a workbench-relative folder of its own (one per
  environment). Add `"tests": ["test_lines"]` for test-host/test-device and `"hostToolchain": "<folder with gcc>"`
  for a `native` environment.

## 2. Inspect first

`platformio inspect-project --request R` lists the parsed files with hashes, the environments and the findings;
`platformio inspect-environments --request R` shows each environment's effective options with the section they come
from, the resolved platform/board/framework/upload protocol and what is missing in the core folder. A finding such as
`extra-script` or `library-script` names a file and its SHA-256: show it to the user; only they decide to approve it,
by adding `{"file": ..., "sha256": ..., "reason": ...}` to `hooks`. Findings like `shell-flag`, `platform-packages`,
`upload-command`, `library-link`, `scons-variable` or `targets` are never approvable: the project must change.
Unity itself ships an SCons build script: after prepare-packages, every operation of a project with test suites
reports it as a `library-script` finding in `buildDir/libdeps/<env>/Unity/` (PlatformIO adds Unity to every build of
such a project); show it to the user and ask for that approval too.

## 3. Packages, build, size

- `platformio prepare-packages --request R` is the only network step (separate approval). Run it once per
  environment, with `"upload": true` in the request when the user wants to upload (it adds every uploader); afterwards builds and tests are offline and report `packages-missing` instead of downloading.
- `platformio build --request R` builds with explicit targets; the run folder holds firmware.elf/.bin with SHA-256,
  the effective options, the platform, package and library versions, the input hashes and build.log. A failed build
  cites the log lines; report them, do not fix the project yourself.
- `platformio artifacts --request R` reports the last build's outputs and memory use without building.
- `platformio clean --request R` deletes only VERA's build folders inside buildDir.

## 4. Tests

- `platformio test-host --request R` (a native environment, named suites) runs the tests on this computer: pass only
  when every case passed; a skipped (IGNORE) case is `incomplete`, never a pass.
- `platformio test-device --request R` only builds each suite's firmware (`incomplete`, `build-only`). Run that ELF on
  the renode plugin's profile (`renode-sim capture-uart`/`test`) or in a HIL plan (flash + serial capture), then
  `platformio test-run --test-device <run> --suite S --evidence <renode or HIL run>`: the verdict comes from that
  execution's Unity output, and virtual evidence is never presented as hardware evidence.

## 5. Upload

`platformio-upload upload --request R --build <build run> --probe <alias> --firmware-effect none|actuates` uploads
the owned build (protocol `stlink`) through the probe declared in `lab/resources.json`; VERA reserves the probe, so a
serial monitor, GDB session or HIL plan using it is BUSY. Ask the user for `--firmware-effect` and the probe; never
guess a port or probe. After an upload the target's state is `unknown` until something checks it.

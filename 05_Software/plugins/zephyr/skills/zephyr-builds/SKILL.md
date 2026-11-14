---
name: zephyr-builds
description: Build, test and flash Zephyr RTOS applications through checked operations - write the explicit request (west workspace and project revisions, Zephyr SDK folder, application, exact board, configuration and overlay files, owned build folder), inspect the workspace offline, build with hashed artifacts, build Twister test scenarios build-only, take a test verdict from a real Renode or HIL run of the same ELF, and flash through the verified STM32CubeProgrammer runner. Use for any Zephyr project in the workbench.
---

Use `run_program` with programs `zephyr` and `zephyr-flash`. Never ask for `west`, `cmake`, `ninja`, Twister or
`STM32_Programmer_CLI` directly: they are not offered. Never edit a `.conf`, overlay or Kconfig file to make a build
pass; report the diagnostics and let the user decide.

## 1. The request

Write a JSON file in the workbench, for example `zephyr/app.json`:

```json
{"format": 1, "kind": "zephyr-request",
 "workspace": "D:/zw", "manifest": "manifest",
 "projects": [{"name": "zephyr", "revision": "<40-hex SHA>"}, {"name": "cmsis_6", "revision": "<SHA>"},
              {"name": "hal_stm32", "revision": "<SHA>"}],
 "sdk": "D:/zephyr-sdk-1.0.1", "app": "apps/blinky", "board": "stm32f4_disco",
 "configs": ["prj.conf"], "extraConfigs": [], "overlays": [], "buildDir": "build/blinky"}
```

- `projects` lists every project of the resolved manifest with its full commit SHA. `zephyr tools --request ...` shows
  the heads that are checked out, so copy them from there only after the user confirms they are the intended ones.
- `sdk` is a folder the user installed (Zephyr SDK 1.0.1 or newer with the board's GNU toolchain in `gnu/`).
  `zephyr tools` lists candidates; never pick one silently.
- `board` is exact: `name[@revision][/qualifiers]`. Configuration and overlay files are relative to the app and are
  the only ones used; Zephyr's automatic `boards/` picks are refused as `implicit-input` until listed.
- `buildDir` is a folder of its own in the workbench; one configuration per folder.
- For tests add `"tests": {"root": "tests/foo", "scenarios": ["foo.basic"]}` (set `app` to the same folder).

## 2. Inspect, then build

1. `zephyr inspect --request zephyr/app.json` - offline. Read `findings`: a refusing finding (unlisted project,
   extension command, CMake command outside the allowlist, Kconfig macro, sysbuild file, implicit input, Twister
   harness) blocks every build. Explain it to the user. Only the user can approve a file: they add
   `{"file": "...", "sha256": "..."}` to `hooks`. Never add hooks yourself.
2. `zephyr build --request zephyr/app.json` - host execution, approval required. The run folder
   `embedded-lab-results/<run-id>/` holds the logs, `artifacts/` (zephyr.elf/hex/bin, config, zephyr.dts, zephyr.map,
   build_info.yml, runners.yaml) with SHA-256 and the memory regions. A failed build lists diagnostics with the log
   file and line; quote them.
3. `build-dir-mismatch` means the folder holds another configuration: use another `buildDir`, or `--pristine` if the
   user agrees to rebuild that folder. `build-dir-foreign` folders are never touched.
4. `zephyr artifacts --request ...` reports the current outputs and sizes without building; `zephyr clean --request
   ...` deletes the owned build folder only.

## 3. Tests

- `zephyr test-build --request ...` builds Twister scenarios build-only: status `incomplete`, every case `not-run`.
  Never call a build-only result passed.
- To execute on the virtual board: `renode-sim capture-uart --profile stm32f4-discovery --firmware <scenario ELF>
  --arch cortex-m4 --boot-address 0x08000000 --until "PROJECT EXECUTION (SUCCESSFUL|FAILED)" --virtual-budget 30`, then
  `zephyr test-run --test-build <test-build run> --scenario <name> --evidence <renode run>`. On hardware, a HIL plan
  flashes the same ELF and captures the console; pass its run folder as `--evidence`.
- The verdict is `pass` only when every case passed; a skip or a missing case is `incomplete`. Report the
  `differences` list (clock, unmodeled registers, target vs model) with every virtual result.
- `zephyr differences --build <build run> --evidence <renode or HIL run>` declares the same for an application ELF.

## 4. Flash

`zephyr-flash flash --request ... --build <build run> --probe <alias> --firmware-effect none|actuates` flashes the
owned folder's HEX through Zephyr's stm32cubeprogrammer runner after checking it against the build run, the flash
region and the runner arguments. The probe is a `probe` alias of `lab/resources.json`. Live debugging is the
gdb-debug plugin's job.

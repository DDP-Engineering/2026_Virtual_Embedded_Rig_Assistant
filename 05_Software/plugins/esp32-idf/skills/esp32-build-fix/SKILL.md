---
name: esp32-build-fix
description: Build an ESP-IDF project, diagnose compiler or linker errors, edit the smallest source fix and rebuild with the selected EIM installation.
---

# ESP-IDF build and repair

Load this skill before using the esp32-idf programs. Use `run_program` with `program: "idf.py"` and argument arrays; VERA handles EIM activation. Never run a shell or pass an `eim run` string yourself.

1. Read the project's instructions, CMakeLists.txt, sdkconfig.defaults and existing build metadata. Confirm the project directory, target and intended changes. Do not guess the board or target. The user installs ESP-IDF/EIM and selects its version with `eim select`; missing-program hints require that user action. VERA never installs the vendor suite or drivers.
2. Run `idf.py` with `args: ["build"]` and the project-relative `cwd`. Use `program_output` for a background build. Read the returned output and full `.vera/runs/...log` with `read` if truncated. Separate the first compiler/linker error from later cascading diagnostics; quote the source file and line.
3. Read the implicated source before editing. Explain the smallest fix, make it with `edit` under normal file approvals, then run the same build again. Repeat only from new diagnostics. Report the real exit code and remaining failures; a scripted fixture is not an actual ESP-IDF build.
4. Never edit `sdkconfig` directly. Put intended persistent configuration in `sdkconfig.defaults` (or the project's existing target defaults), then use `args: ["reconfigure"]`. Defaults initialize a new configuration or an unset value; they do not override an already-set value in `sdkconfig`. Read the effective generated configuration after reconfigure and verify the requested values before rebuilding or claiming a change. If an existing value remains, explain it and agree on the project's supported configuration-regeneration workflow before running it; never silently discard the existing configuration or reset the target. `menuconfig` is blocked because it is interactive. `set-target` and `fullclean` delete generated output; use them only when needed and explain that effect. Do not reset the target just to clear a diagnostic. See [ESP-IDF configuration defaults](https://docs.espressif.com/projects/esp-idf/en/v5.4.3/esp32/api-guides/build-system.html#custom-sdkconfig-defaults).
5. A successful build reports its binaries and ELF under the chosen build directory. Keep the ELF paired with the exact flashed binary for panic analysis. `size`, `size-components` and `size-files` report host build sizes.

For flashing, load serial-monitor's identification skill, list ports and confirm the board. Stop any background capture holding that port before `args: ["-p", "<confirmed-port>", "flash"]` or `app-flash`. Let the normal device-write approval occur; never change rules or session mode to avoid it. Check build output and flash success. Do not combine `monitor` with `flash`: any command containing it is blocked. Use serial-monitor for bounded capture after flashing.

`efuse-*` and `secure-*` commands are irreversible. Ordinary compile repair never needs them; do not invoke them to fix a build.

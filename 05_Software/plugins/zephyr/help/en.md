# Zephyr builds, tests and flashing

This plugin lets the agent build Zephyr RTOS applications for an exact board, build Twister test scenarios and flash a board through checked operations. The agent writes an explicit request: the west workspace with every project at its pinned revision, the SDK folder, the application, the board, configuration files and its own build folder. Builds keep the firmware files with hashes, configuration, devicetree and map. Unlisted projects, extension commands and build hooks are refused unless you approve them by hash. Results go to `embedded-lab-results/`.

## What it needs

- **Two Python helpers** with pinned west 1.5.0, CMake 4.4.4 and Ninja 1.13.2, which VERA installs itself with **Install dependencies**.
- **A Zephyr SDK 1.0.1 or newer**, which you install yourself, with your board's GNU toolchain in its `gnu/` folder.
- **A west workspace** with Zephyr 4.4 or 4.5, set up by you or by the agent in a separately approved network step. Keep paths short on Windows.
- For flashing: **STM32CubeProgrammer**, which you install yourself from https://www.st.com/en/development-tools/stm32cubeprog.html (an ST account is required), an ST-LINK probe, and the bench registry `lab/resources.json`, which declares the probe by alias (optional; not needed for builds and tests). The plugin page's **Configuration** section shows whether it is present and valid.

## How to use it

The agent uses the `zephyr-builds` skill. It never edits `.conf`, overlay or Kconfig files to make a build pass.

- "Inspect the workspace D:/zw for apps/blinky on stm32f4_disco."
- "Build blinky and report the memory use."
- "Build the foo.basic Twister scenario and run it on the Renode STM32F4 Discovery board."
- "Flash the last build through probe stlink1; the firmware drives no actuators."

## Risk and approvals

- **Safe** (runs without asking): inspecting, reporting artifacts, evaluating test runs and listing differences; no build, project code or network.
- **Device write** (asks in **Ask** and **Auto-edit** modes): building and test-building, because workspace and application code runs on your computer (an approval is not a sandbox); cleaning the build folder; preparing the workspace, the only network step; and flashing, which overwrites the target's flash.
- **Irreversible** (asks, and you type the confirmation word shown on the card): flashing firmware that drives actuators once it starts. In **Bypass — full access** this runs without asking.
- **Blocked**: calling STM32_Programmer_CLI directly; use the flash operation or the stm32-cubeprog plugin.

## Limits

- Windows x64 and Linux x64. Verified with Zephyr 4.4.2, SDK 1.0.1 and `stm32f4_disco` on Windows x64; native Ubuntu and a real board are not verified yet.
- Flashing supports the `stm32cubeprogrammer` runner only. Live debugging belongs to the gdb-debug plugin.
- Twister runs build-only; a build-only result is never a pass.

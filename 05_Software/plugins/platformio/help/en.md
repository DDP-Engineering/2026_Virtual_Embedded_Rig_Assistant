# PlatformIO projects

This plugin lets the agent inspect, build, test and upload existing PlatformIO projects through checked operations. The agent writes an explicit request naming the project folder, the environment, a PlatformIO core folder and its own build folder. Extra scripts, library scripts and custom test runners are refused unless you approve them by hash, and builds keep the firmware files with hashes, versions and logs. The agent never runs `pio` directly.

## What it needs

- **Two Python helpers** with a pinned PlatformIO Core 6.2.0, which VERA installs itself with **Install dependencies**. Your own `pio` is not used.
- **A PlatformIO core folder**: any empty folder you choose. A separately approved network step fills it with packages; builds and tests then run offline.
- **A host compiler** for `native` environments, which you install yourself: GCC on Linux, a MinGW-w64 GCC on Windows.
- For uploads: an ST-Link probe and the bench registry `lab/resources.json` in the workbench, which declares the probe by alias (optional; not needed for builds and native tests). The plugin page's **Configuration** section shows whether it is present and valid.
- No other plugins are required.

## How to use it

The agent uses the `platformio-projects` skill. It asks you which environment to use and never edits platformio.ini or your code to make a build pass.

- "Inspect firmware/board demo and show the effective options of the disco environment."
- "Prepare the packages for the disco environment in D:/pio-core."
- "Build the disco environment and report the memory use."
- "Run the native Unity tests test_lines on this computer."
- "Upload the last build to the board through probe stlink1; the firmware drives no actuators."

## Risk and approvals

- **Safe** (runs without asking): inspecting the project and environments, reporting artifacts and evaluating test runs. These start no build, no project code and no network access.
- **Device write** (asks in **Ask** and **Auto-edit** modes): building and testing, because project code runs on your computer (an approval is not a sandbox); cleaning VERA's build folders; preparing packages, the only network step; and uploading, which overwrites the target's flash.
- **Irreversible** (asks, and you type the confirmation word shown on the card): an upload of firmware that drives actuators once it starts. In **Bypass — full access** this runs without asking.

During an upload VERA reserves the probe.

## Limits

- Windows x64 and Linux x64. Verified on Windows x64 with the ststm32 platform (disco_f407vg) and the native platform; real-board uploads and native Ubuntu are not verified yet.
- Uploads support the `stlink` protocol only.
- Device tests are only built here; their verdict needs a Renode or HIL run of the same ELF.

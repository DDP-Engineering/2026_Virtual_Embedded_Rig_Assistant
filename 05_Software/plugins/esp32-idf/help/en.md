# ESP32 ESP-IDF

ESP32 ESP-IDF lets the agent build and repair ESP-IDF projects, report firmware sizes, flash the result to a board and analyse ESP32 panics: it decodes Guru Meditation backtraces to source lines with the matching ELF and reads core dumps from the chip. It uses the ESP-IDF that you installed and selected yourself.

## What it needs

- **ESP-IDF 5.4 or newer (below 7)**, installed with the ESP-IDF Installation Manager (EIM). VERA finds `idf.py` through EIM but never installs it. Install ESP-IDF with EIM, select the version with `eim select`, put `eim` on PATH, start VERA, then use **Check dependencies** on the plugin page. Guide: https://docs.espressif.com/projects/idf-im-ui/en/latest/
- The Xtensa and RISC-V `addr2line` decoders from the ESP-IDF toolchains, also installed with EIM. For a custom tools root, start VERA with `IDF_TOOLS_PATH` set to that root.
- USB drivers for your board, installed by you.
- The **serial-monitor** plugin, which finds the board's port and captures the console. **Install with dependencies** adds it.
- No configuration parameters.

## How to use it

- "Build the project in firmware/ and fix the first compile error." (skill `esp32-build-fix`)
- "Enable core dump to flash in sdkconfig.defaults, reconfigure and rebuild."
- "Which components take the most flash?"
- "Flash the build to the board on COM5."
- "The board crashed with a Guru Meditation. Capture it on COM5 and decode the backtrace with the flashed ELF." (skill `esp32-panic`)
- "Read the core dump from the board on COM5."

The agent never edits the generated `sdkconfig`; it changes `sdkconfig.defaults`, reconfigures and checks the effective configuration. It decodes a backtrace only with the ELF of the exact build that was flashed and says so when the match is unknown.

## Risk and approvals

- Safe, runs without asking: build, size reports, `set-target`, `fullclean`, `reconfigure`, and the addr2line decoders. `set-target` and `fullclean` remove generated build output.
- Device-read: `coredump-info`, which reads the core dump partition and may reset the board.
- Device-write: `flash`, `app-flash`, `erase-flash` and `erase-otadata`, which overwrite firmware or data on the chip; erasing OTA data changes the selected app.
- Irreversible: `efuse-*` and `secure-*` commands, which can change the chip permanently. VERA asks you to type the confirmation word, except in Bypass. A build repair never needs them.
- Blocked: `monitor`, `menuconfig`, `gdb` and `gdbtui`, which are interactive, including `flash monitor`. Use the serial monitor for console capture.

In Ask mode VERA asks before each device-read and device-write command; Auto-edit runs device-read commands without asking.

## Limits

- Windows x64 and Linux x64.
- The EIM command transport is verified with EIM 0.20.1. A real ESP-IDF build, flash and panic decode on hardware is not yet proven.
- References: https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/tools/idf-py.html and https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/core_dump.html

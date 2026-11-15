# GNU binutils (ARM, RISC-V)

GNU binutils lets the agent inspect local ARM and RISC-V firmware ELF files with `size`, `nm`, `readelf`, `objdump` and `addr2line` from the `arm-none-eabi-` and `riscv-none-elf-` toolchains. It compares section and symbol sizes between two builds, explains the memory layout, disassembles one function or a small address range, and decodes crash addresses to functions and source lines. It only reads files on this computer and never touches a board.

## What it needs

- The ten binutils programs (five per architecture). VERA first looks for a toolchain you already have: PATH, STM32CubeCLT and STM32CubeIDE (ARM), PlatformIO, Arduino, the Zephyr SDK and xPack folders. A toolchain in another location can be put on PATH.
- If none is found, **Install dependencies** on the plugin page downloads the pinned xPack toolchain (ARM 15.2.1-1.1, RISC-V 15.2.0-1) into VERA's program folder and checks its SHA-256. Nothing is installed globally.
- The ELF file of the exact build you are investigating. A later rebuild can give plausible but wrong source lines.
- No required plugins, hardware or configuration. Espressif ELF files and toolchains belong to the esp32-idf plugin.

## How to use it

- "Compare build/v1.2/app.elf with build/v1.3/app.elf and tell me which symbols grew the most." (skill `firmware-size`)
- "Where did the 2 KB of extra RAM come from in the new build?"
- "Decode this HardFault: PC 0x08001a3c, LR 0x08001a11, using build/app.elf." (skill `crash-decode`)
- "Show the sections and load segments of firmware.elf and check them against the linker script." (skill `elf-inspect`)
- "Disassemble the function `uart_rx_handler` with its source."

The agent disassembles only the function or address range being investigated, never the whole image. It reports `??` or `:0` as unresolved instead of guessing a line.

## Risk and approvals

Every command of this plugin is rated safe: the programs analyze host files and never access hardware, so they run without asking in every permission mode, including Read-only. There are no device-write or irreversible commands.

## Limits

- Windows x64, Linux x64 and Linux arm64. The Linux arm64 archives are verified, but running them is not yet proven on an arm64 host.
- An existing binary whose version cannot be read stays unavailable; VERA does not silently download another.
- Command output returned to the agent is capped at the last 12,000 characters; the full output stays in the run log.
- Reference: https://sourceware.org/binutils/docs/binutils/

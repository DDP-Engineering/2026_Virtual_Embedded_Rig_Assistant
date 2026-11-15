# STM32CubeProgrammer

This plugin lets the agent program STM32 parts with your own STM32CubeProgrammer (STM32_Programmer_CLI). It connects through an ST-LINK or a UART, USB DFU, SPI, I2C or CAN bootloader, reads memories, flashes and verifies images, erases, resets, and reads or changes option bytes. Use it to program an STM32 board or inspect its protection state.

## What it needs

- **STM32CubeProgrammer**, which you install yourself from https://www.st.com/en/development-tools/stm32cubeprog.html (an ST account is required), or STM32CubeIDE, which bundles it. VERA never downloads it; it looks in the standard install folders and on PATH.
- On Linux, a custom install needs a lower-case `stm32_programmer_cli` link on PATH.
- An ST-LINK probe or a bootloader connection and the target board. The installer adds the ST-LINK drivers on Windows; on Linux you install ST's udev rules yourself.
- No other plugins and no configuration.

## How to use it

The agent uses the `stm32-flash` and `stm32-option-bytes` skills. It agrees the probe and interface with you before it connects.

- "List the connected ST-LINK probes."
- "Connect over SWD and tell me the device ID and flash size."
- "Flash build/app.elf over SWD, verify it and reset the board."
- "Read 4 KB of flash from 0x08000000 into captures/flash.bin."
- "Show the option bytes and explain each field."

## Risk and approvals

- **Safe** (runs without asking): help, version, output settings, host-file tools and listing probes without connecting.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): connecting, reading, verifying, resets, halt/run/step and displaying option bytes, OTP or product state. Resets affect the running program.
- **Device write** (asks in **Ask** and **Auto-edit**): writing, erasing or filling flash or RAM, running code, writing core registers and wireless-stack changes; also unknown commands. A hex, srec or ELF image can carry option-byte or OTP segments, which a write programs too.
- **Irreversible** (asks, and you type the command, for example `-ob`): option-byte writes, read-protection and TrustZone regression (mass erase), RDP lock and unlock, OTP, keys, secure firmware, product state, debug authentication, HSM licenses and switching the target supply. RDP level 1 is removed only by a mass erase; RDP level 2 is permanent and blocks debug access forever. In **Bypass — full access** these run without asking.
- **Blocked**: script files, because VERA cannot classify the commands they contain.

## Limits

- Windows x64 and Linux x64. Rules were measured on STM32CubeProgrammer 2.23.0; commands of later releases count as unknown until the rules list them.
- Files the CLI writes on your computer (memory reads, logs, register dumps) need no separate approval.
- The plugin has not yet connected to a real board or changed option bytes.

# Microchip pymcuprog (AVR, PIC)

This plugin lets the agent identify, program, verify and erase Microchip AVR (UPDI) and PIC parts with pymcuprog, read their memories back, and read or change fuses and config words. It works through a Curiosity Nano or Xplained kit with nEDBG, a PICkit 4 or MPLAB Snap in AVR mode, an Atmel-ICE, or a SerialUPDI adapter.

## What it needs

- **pymcuprog 3.19** (below 4), a Python package that VERA installs itself with **Install dependencies**.
- A supported programmer or kit and the target board. A SerialUPDI adapter is any USB serial adapter with a resistor between RX, TX and UPDI.
- On Windows the USB tools need no extra driver. On Linux you may need the udev rules from the pymcuprog README (https://github.com/microchip-pic-avr-tools/pymcuprog) for nEDBG, PICkit and Atmel-ICE access.
- No other plugins and no configuration.

## How to use it

The agent uses the `microchip-flash` and `microchip-fuses` skills. Tell it which tool and which device you use; it does not guess them.

- "Ping the ATtiny416 on the SerialUPDI adapter on COM5."
- "Write build/app.hex to the ATtiny416, erase first and verify."
- "Read the first 64 bytes of flash and save the EEPROM to captures/eeprom.hex."
- "Read the fuses of the ATtiny416, save them as a record and explain each byte."
- "Set fuse 2 (OSCCFG) to 0x01, then read the fuses again and compare."

## Risk and approvals

- **Safe** (runs without asking): help, version and release information, and converting a hex file to UF2.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): ping, read, verify, reset and voltage readings.
- **Device write** (asks in **Ask** and **Auto-edit**): writing flash, EEPROM or user row, chip erase, rebooting the debugger, and erasing or writing a locked UPDI part. An argument pymcuprog would reject is also treated as a device write.
- **Irreversible** (asks, and you type the confirmation word `write` or `erase` shown on the card): every write of a hex file, because an Intel hex file can carry fuse, config-word and lock-bit data; every fuse, config-word or lock-bit write or erase; changing the kit's supply voltage; any command with UPDI high voltage (12 V, `-H`). A wrong fuse can disable UPDI or reset, and lock bits enable code protection. In **Bypass — full access** these run without asking.

## Limits

- Windows x64 and Linux x64.
- pymcuprog 3.19 does not drive a PICkit 5.
- The files that a read to file or a UF2 conversion writes on your computer are not approved separately.
- The plugin has not yet been tested against a real tool or board.

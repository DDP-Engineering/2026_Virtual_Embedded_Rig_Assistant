---
name: board-identify
description: Find which boards and debug probes are connected, on which serial ports, and which VERA tools fit each. Use when the user asks what is plugged in, or before the first flash, capture or debug session with a board that is not an ESP32.
---
# board-identify

## Procedure

1. Run `serial list` (load the `serial-console` skill for the program's details). Never guess a port.
2. Read `family` and `vid_pid` of each port:

   | Family | What it usually is | Where to go next |
   |---|---|---|
   | Espressif native USB, CP210x, CH340, CH343, CH9102 | an ESP32 or ESP8266 board | load `esp32-identify` |
   | ST-Link V2-1 or V3 virtual COM port | an STM32 Nucleo or Discovery board; the same cable flashes and debugs | stm32-cubeprog or probe-rs |
   | SEGGER J-Link, CMSIS-DAP (DAPLink) virtual COM port | a debug probe with a UART pass-through; the board is behind it | probe-rs, gdb-debug |
   | Raspberry Pi Pico | a Pico running MicroPython, CircuitPython or a C SDK program with USB serial | micropython, circuitpython, probe-rs |
   | Arduino, Teensy | an Arduino-compatible board | arduino-cli (`board list` names the exact model) |
   | STM32 USB CDC, Nordic Semiconductor, NXP, Microchip, Texas Instruments XDS110 | firmware or a vendor probe that presents a serial port | ask which board it is |
   | FTDI, Prolific, a bare CP210x or CH34x adapter | a USB-to-serial cable; anything can be behind it | ask what it is wired to |
   | null | a built-in or Bluetooth port, or an unknown device | ask before using it |

   The family names the USB interface, not the microcontroller: say what it suggests and what is not
   yet known. Only programs listed in `<programs>` can be used; name the plugin when it is not enabled.
3. Tell boards of the same family apart by `serial_number`; on Linux name each by its
   `/dev/serial/by-id/...` path (`by_id`), which stays the same when boards are replugged.
4. Confirm what runs on a port by listening: `serial capture --port P --duration 3`. A boot banner, a
   prompt (`>>> ` for MicroPython and CircuitPython, `uart:~$` for a Zephyr shell) or a version line
   names the firmware. Do not use `--reset` on a board that is not ESP32-style without asking: the
   reset lines are wired differently per board, and opening the port already restarts some Arduino boards.
5. Record in the conversation, for each board: port (and by-id path), family, serial number and what
   it is, so later steps reuse them instead of listing again.

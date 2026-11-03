---
name: esp32-identify
description: Find which serial port each connected ESP32 board uses and what kind of USB bridge it has. Use before flashing, monitoring or debugging an ESP32 board, or when the user asks which boards are connected.
---
# esp32-identify

## Procedure

1. Run `serial list` (load the `serial-console` skill for the program's details). Never guess a port.
2. Map each port's `vid_pid` to a family:

   | VID:PID | Family | Typical board |
   |---|---|---|
   | `303A:*` (`303A:1001` USB-Serial-JTAG) | Espressif native USB | ESP32-S3, C3, C6, H2 on their USB port; S2/S3 USB-OTG CDC |
   | `10C4:EA60` | Silicon Labs CP210x | ESP32 DevKitC and many ESP32/ESP32-S2 boards |
   | `1A86:7523`, `1A86:55D4` | WCH CH340, CH343 | low-cost boards, ESP32-C3/S3 boards with a UART port |
   | `0403:6001`, `0403:6010`, `0403:6014` | FTDI (`6010` = ESP-Prog) | external adapters; ESP-Prog's second channel is JTAG |

   A board with two USB sockets (for example an ESP32-S3 DevKitC) shows up once per connected socket:
   `303A:1001` on the USB socket and a bridge (CP210x or CH343) on the UART socket. Ports without a
   family are not necessarily ESP32 boards; ask the user before using them.
3. On Linux, name each board by its `/dev/serial/by-id/...` path (`by_id`) when it is present; it stays
   stable when boards are replugged.
4. If several ports could be the same board, capture a boot log to tell them apart:
   `serial capture --port P --reset --until "main_task: Calling app_main|rst:0x" --duration 5`. The ROM
   banner names the chip (`ESP-ROM:esp32s3-...`, `ets Jun  8 2016` for the original ESP32).
5. Confirm the chip with `esptool chip-id` when the `esp32-esptool` plugin is enabled (its program
   `esptool` is listed in `<programs>`): `esptool --port P chip-id`. It resets the chip into its
   bootloader and needs the user's approval. Without that plugin, report the family and the ROM
   banner, and say the chip type is not confirmed.
6. Record in the conversation, for each board: port (and by-id path), family, serial number and chip
   type, so later steps reuse them instead of listing again.

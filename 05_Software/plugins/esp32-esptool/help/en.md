# ESP32 esptool

ESP32 esptool lets the agent identify, flash, verify, erase and read Espressif chips over a serial port with esptool v5. It reads the images and offsets of an ESP-IDF build, writes them to the chip, checks that every image verified and captures the boot log that follows.

## What it needs

- **esptool** 5 from PyPI, installed automatically by **Install dependencies** on the plugin page.
- The **serial-monitor** plugin, which finds the board's port and captures its boot log. **Install with dependencies** adds it.
- An ESP32-family board on a serial port. On Linux your user must be in the group that owns serial ports: `dialout` (Debian, Ubuntu, Fedora) or `uucp` (Arch).
- No configuration parameters.

## How to use it

- "Which chip is on COM5?" (skill `esp32-flash`)
- "Flash the ESP-IDF build in build/ to the ESP32-S3 on COM5, verify it and show the boot log."
- "Verify that the board on COM5 still holds this build."
- "Back up the whole flash of the ESP32 on COM5 to backup.bin."
- "Erase the flash of the board on COM5."

The agent finds the port with the serial monitor and never guesses it. It confirms the chip type first and then passes it to every command, so a wrong board fails instead of being written. It uses the offsets from `build/flasher_args.json` exactly. If the build enables secure boot or flash encryption, it stops and asks you before flashing, because such a bootloader burns eFuses on its first boot. Before erasing it tells you that NVS data and Wi-Fi credentials are removed too.

## Risk and approvals

- Safe, runs without asking: commands that work on files only (`merge-bin`, `image-info`, `elf2image`).
- Device-read: identifying the chip, reading the MAC, flash ID and security state, verifying and reading flash. Every command that connects resets the chip into its bootloader and stops the running firmware.
- Device-write: `write-flash`, `erase-flash`, `erase-region` and `load-ram`. The approval card lists each image with its SHA-256; if an image is rebuilt after you approve, the run fails and is requested again.
- Irreversible: `write-mem`, `write-flash-status` and any command with `--force`, `--encrypt`, `--encrypt-files` or `--ignore-flash-enc-efuse`. These can set eFuse bits or flash lock bits for good, or make a secured chip unbootable. The agent uses them only when you ask for exactly that command, and VERA asks you to type the confirmation word, except in Bypass.

In Ask mode VERA asks before each device-read and device-write command; Auto-edit runs device-read commands without asking.

## Limits

- Windows x64 and Linux x64.
- When the chip does not enter its bootloader, you may have to hold BOOT, press RESET and release BOOT.
- Reference: https://docs.espressif.com/projects/esptool/en/latest/

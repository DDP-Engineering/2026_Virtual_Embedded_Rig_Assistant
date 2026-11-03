ESP32 esptool: program `esptool` (esptool v5 from PyPI, `esptool>=5,<6`) identifies, flashes, verifies, erases and
reads Espressif chips over a serial port. VERA installs it with its bundled uv. Skill: `esp32-flash`. Requires the
`serial-monitor` plugin, which finds the board's port and captures its boot log.

Commands that only work on files (`merge-bin`, `image-info`, `elf2image`) are safe; commands that connect reset the
chip into its bootloader (device-read); `write-flash`, `erase-flash`, `erase-region` and `load-ram` are device-write;
`write-mem`, `write-flash-status` and any `--force` are irreversible and need the typed confirmation.

On Linux the user must be in the group that owns serial ports: `dialout` (Debian, Ubuntu, Fedora) or `uucp` (Arch).

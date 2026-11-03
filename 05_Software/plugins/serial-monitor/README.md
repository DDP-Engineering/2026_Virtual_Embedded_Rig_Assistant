Serial monitor: program `serial` lists serial ports with their USB IDs and board family, captures a
board's console (optionally after a DTR/RTS reset) and sends one line. It is a PEP 723 script on
pyserial 3.5 that VERA installs with its bundled uv. Skills: `serial-console`, `esp32-identify`.

On Linux the user must be in the group that owns serial ports: `dialout` (Debian, Ubuntu, Fedora) or
`uucp` (Arch).

Serial monitor: program `serial` lists serial ports with their USB IDs and board family, captures a
board's console (optionally after a DTR/RTS reset, with `--timestamps` or as a `--hex` dump) and sends
one line or bytes. It is a PEP 723 script on pyserial 3.5 that VERA installs with its bundled uv. Skills:
`serial-console`, `board-identify`, `esp32-identify`.

A port is a device name, or a simulator's pseudo-terminal (`/dev/pts/N`), `socket://host:port` or
`rfc2217://host:port`; a terminal and a plain socket have no DTR and RTS, so `--reset` is refused there.
`--until` returns the whole line it matched: a line that had not ended is read to its line break or until
0.2 seconds pass without bytes. The frame is 8N1 unless `--bytesize`, `--parity` and `--stopbits` say
otherwise; `--baud auto` listens at the usual rates and keeps the one that reads as text. A foreground
capture may run one hour.

A running capture owns its port and leaves its address in the user's temporary folder
(`vera-serial-monitor`). `send` without `--port` hands its bytes to that capture over a local socket: the
capture writes them, notes `[serial-monitor] sent ...` in its own output and copies what it reads back
to the sender. `--name` on a capture and `--capture` on a send tell several captures apart.

On Linux the user must be in the group that owns serial ports: `dialout` (Debian, Ubuntu, Fedora) or
`uucp` (Arch). Legacy ports the kernel lists without hardware (`/dev/ttyS*` of unknown type) are left out.

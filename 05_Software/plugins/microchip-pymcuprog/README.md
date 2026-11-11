# Microchip pymcuprog (AVR, PIC)

Enable **Programming (pymcuprog)** in the Microchip pack. VERA installs
pymcuprog 3.19 from PyPI with its bundled uv (**Install programs**); USB tools
need no extra driver on Windows, while Linux users may need the udev rules from
the pymcuprog README for nEDBG, PICkit and Atmel-ICE access. SerialUPDI uses
any USB serial adapter with a resistor between RX, TX and UPDI.

| Command | Risk |
|---|---|
| `--help`, `--version`, `-R`, `makeuf2` | safe |
| `ping`, `read`, `verify`, `reset`, `getvoltage`, `getsupplyvoltage`, `getusbvoltage` | device-read |
| `write` to flash, EEPROM, user row or another data memory; `erase` (chip erase or a data memory); `reboot-debugger`; `-U`, `-C` | device-write |
| `write` to `fuses`, `lockbits`, `config_words` or `all` (also a write without `-m`), every `write -f <file>.hex`, `erase -m fuses/lockbits/config_words` | irreversible (typed `write` / `erase`) |
| `setsupplyvoltage`; any command with `-H` (UPDI high voltage) | irreversible (typed action) |
| an argument pymcuprog would reject | device-write |

The rules read pymcuprog's arguments the way its argparse parser does:
options before or after the action, unique abbreviations (`--mem`), attached
values (`-mfuses`, `-m=fuses`, `--memory=fuses`), grouped flags (`-xmfuses`),
`-l` value lists (a separate list runs to the next option; an attached `-l0x01`
is a single value), negative numbers as values, the last of repeated options
and `--`. Hex writes are irreversible because an Intel hex file can carry fuse,
config-word and lock-bit segments that pymcuprog writes along with flash.

## Limits

`makeuf2 --uf2file` and `read -f` write host files without approval, like other
analysis outputs. pymcuprog 3.19 drives nEDBG kits, PICkit 4 and MPLAB Snap in AVR
mode, Atmel-ICE and SerialUPDI; it has no PICkit 5 support, so the ticket's PICkit 5
is not covered.

No test has run against a real tool or board; the opt-in acceptance converts a
hex file and pings a port that does not exist. avrdude and MPLAB X IPE are
later candidates in this ecosystem.

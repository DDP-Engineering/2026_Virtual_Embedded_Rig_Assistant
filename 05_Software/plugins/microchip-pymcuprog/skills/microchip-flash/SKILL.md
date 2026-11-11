---
name: microchip-flash
description: Identify a Microchip AVR or PIC part with pymcuprog, program a hex image with verification, read memories back and erase the chip.
---

Use `run_program` with program `pymcuprog` and separate arguments. Agree the
tool and device with the user; never guess them. A Curiosity Nano or Xplained
kit needs no `-t`/`-d`. A standalone debugger needs `-t` (`pickit4`,
`atmelice`, `snap`; PICkit 4 and Snap must be in AVR mode, and pymcuprog 3.19
does not drive a PICkit 5), `-d` (for example `attiny416`,
`atmega4809`, `avr128da48`) and, where the part has several, `-i updi`. A
SerialUPDI adapter is `-t uart -u <port>` (find the port with the
serial-monitor plugin) and `-d <device>`; add `-c 115k` only if asked.

Identify the part first; it proves wiring and power:

```text
pymcuprog ping -t uart -u COM5 -d attiny416
```

Program the build's hex image and verify it in the same run:

```text
pymcuprog write -t uart -u COM5 -d attiny416 -f build/app.hex --erase --verify
```

Every hex write asks for the typed word `write`: an Intel hex file can carry
fuse, config-word or lock-bit segments, and pymcuprog writes all of them. Before
the call, say which image you write, from which build, and whether its source
sets fuses (`FUSES` or `LOCKBITS` sections, `#pragma config` on PIC). Only a
file the user built for this board belongs on it.

Read memories back to check or archive them:

```text
pymcuprog read -m flash -o 0 -b 64 -t uart -u COM5 -d attiny416
pymcuprog read -m eeprom -f captures/eeprom.hex -t uart -u COM5 -d attiny416
```

`pymcuprog erase` (no `-m`) is a chip erase; on AVR it also clears lock bits.
Erase a locked UPDI part only on request (`erase --chip-erase-locked-device`).
Report the tool, device, file and pymcuprog's verification line. A ping that
cannot open the port or reports a wrong signature calls for checking the
device name, wiring and target power before anything is written.

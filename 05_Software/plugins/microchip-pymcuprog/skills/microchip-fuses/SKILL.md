---
name: microchip-fuses
description: Read and explain AVR fuses or PIC config words with pymcuprog and change one fuse at a time only on the user's explicit request.
---

Read before you change anything, and keep the values as a record:

```text
pymcuprog read -m fuses -t uart -u COM5 -d attiny416
pymcuprog read -m fuses -f captures/fuses-before.hex -t uart -u COM5 -d attiny416
```

Explain each byte from the device datasheet (fuse offsets differ per family:
on tinyAVR 0/1 and AVR Dx, offset 5 is SYSCFG0 and 2 is OSCCFG). Cite the
datasheet section behind every bit you name.

Change one fuse per call, only the fuse the user asked for, with the value you
computed and showed first:

```text
pymcuprog write -m fuses -o 2 -l 0x01 -t uart -u COM5 -d attiny416
```

Every fuse, config-word and lock-bit write is irreversible in VERA: in ask mode
it waits for the typed word `write`. State the old value, the new value and the
consequence before the call. Some settings lock you out: an AVR whose UPDI pin
becomes GPIO (RSTPINCFG) can only be reached again with a high-voltage
programmer (`-H`, which VERA also treats as irreversible and which only boards
built for 12 V tolerate), and PIC code protection or a wrong oscillator setting
can stop programming. Never write `lockbits` or code-protection bits unless the
user asks for exactly that and understands that a chip erase is the only way
back. Never batch several fuses into one write.

Read the fuses again afterwards and compare them with the record. Report any
difference, and stop if a read fails after a fuse write.

---
name: can-transmit
description: Send one CAN frame or replay a log file on a live bus, only on the user's explicit request and after the typed confirmation.
---

Transmitting acts on real hardware: the receiving ECUs execute the frame at
once (move a motor, change a setpoint, reset). Send or replay only what the
user asked for, on the interface and channel they confirmed. Before the call,
state the bus, the identifiers, the payload and what you expect the receiver to
do. In ask mode VERA waits for the typed confirmation word (`send` or
`replay`); never repeat a refused transmission with different arguments.

One frame, or a few repeated with a period:

```text
can send --interface pcan --channel PCAN_USBBUS1 --bitrate 500000 --id 0x200 --data E80301
can send --interface socketcan --channel can0 --id 0x18FF0001 --extended --data 0102 --count 5 --period-ms 100
```

IDs and data are hexadecimal. Classic frames carry at most 8 bytes; add `--fd`
(and `--brs`, `--data-bitrate`) for CAN FD. Replay sends every frame of a log
file with its recorded timing; bound it with `--max-messages` when only the
start is needed, and use `--ignore-timestamps` only when the user asks for back
to back frames:

```text
can replay --interface pcan --channel PCAN_USBBUS1 --bitrate 500000 --input captures/startup.asc --max-messages 50
```

Prefer a capture running at the same time (can-capture skill, background run)
so the effect can be checked afterwards. Report the line the program prints
(`sent N frame(s)` or `replayed N frame(s)`) and any error with its hint.

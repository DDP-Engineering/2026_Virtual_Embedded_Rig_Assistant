---
name: can-capture
description: Find a CAN adapter and capture a bounded, listen-only trace of a bus to a workbench ASC, BLF or candump log.
---

Use `run_program` with program `can` and separate arguments. Start with
`can list`: it shows detected channels and whether the PEAK, Vector, Kvaser,
slcan, gs_usb and SocketCAN drivers are available, with an install hint for
each missing one. Driver installation and bringing up a SocketCAN link are the
user's steps; quote the hint instead of trying to install anything.

Agree the interface, channel and bitrate with the user. Never guess a bitrate:
a wrong one corrupts the capture and, on an adapter that is not listen-only,
raises error frames on the bus. Typical channels: `PCAN_USBBUS1` (pcan), `0`
(vector, kvaser, gs_usb), `COM5` or `/dev/ttyACM0` (slcan), `can0` or `vcan0`
(socketcan).

Create `captures/` in the workbench and choose an unused file name. Always
bound the capture with `--duration <seconds>` or `--max-messages <n>`:

```text
can capture --interface pcan --channel PCAN_USBBUS1 --bitrate 500000 --duration 10 --output captures/bus.asc
can capture --interface socketcan --channel can0 --max-messages 2000 --output captures/can0.blf
```

The capture opens PEAK, Vector, Kvaser and slcan adapters listen-only, so they
never acknowledge or disturb traffic. Software buses (`udp_multicast`,
SocketCAN `vcan*`) need nothing. A SocketCAN `can0` counts as listen-only only
when the user brought it up with `listen-only on`. Any other backend (gs_usb,
for example) is refused unless `--active` is added; ask the user before adding
it, and say that the adapter will then acknowledge frames.

Prefer `.asc` or `.log` for long or background captures: they are written frame
by frame, while a stopped `.blf` capture can be incomplete. For a longer capture
use `background: true` with a `--duration`, follow it with `program_output`,
and let it end by itself. The summary line on stderr gives the frame count and
the stop reason; zero frames calls for checking the bitrate, wiring and
termination before retrying. Decode the file with the can-dbc plugin.

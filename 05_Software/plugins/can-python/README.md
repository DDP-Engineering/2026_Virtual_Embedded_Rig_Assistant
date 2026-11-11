# CAN bus (python-can)

Enable **Bus capture and transmit** in the CAN pack. The plugin exposes program
`can`, a PEP 723 script on python-can 4.6.1 (with the serial, gs-usb, pcan and
multicast extras) that VERA installs with its bundled uv, and two skills:
`can-capture` and `can-transmit`. Decode captures with the can-dbc plugin.

| Command | Risk |
|---|---|
| `can list`, `--version`, `--help` | safe |
| `can capture ... --duration S` or `--max-messages N` | device-read |
| `can capture ... --active` | device-write |
| `can send`, `can replay` | irreversible (typed confirmation `send` / `replay` in ask) |

## Drivers and links

VERA never installs drivers. `can list` reports each one with its hint:

- **PEAK** (`--interface pcan`): PEAK device driver with PCAN-Basic.
- **Vector** (`vector`, Windows): Vector driver setup and XL Driver Library.
- **Kvaser** (`kvaser`): Kvaser drivers and CANlib.
- **slcan** (`slcan`): the adapter's serial port is the channel.
- **gs_usb / candleLight** (`gs_usb`): WinUSB through Zadig on Windows; on
  Linux the kernel driver turns it into SocketCAN.
- **SocketCAN** (`socketcan`, Linux): bring the link up yourself, for example
  `sudo ip link set can0 up type can bitrate 500000 listen-only on`, or a
  virtual bus with `sudo modprobe vcan`,
  `sudo ip link add dev vcan0 type vcan` and `sudo ip link set up vcan0`.

`udp_multicast` (channel `239.74.163.2`) joins processes on one host without
hardware, which is useful to rehearse a capture and a replay.

## Listen-only capture

A capture opens PEAK adapters in the passive state, Vector and slcan with
listen-only, and Kvaser in silent driver mode, so the adapter never
acknowledges frames. Software buses need nothing; a SocketCAN channel counts
only when `ip` reports it LISTEN-ONLY. Any other backend exits 2 unless
`--active` is given, which the rules classify as device-write. The output file
must not exist yet. PEAK, Kvaser and gs_usb need `--bitrate` (python-can would
assume 500 kbit/s). Bus settings come only from the command line: `~/.canrc`,
`can.ini` and `CAN_*` variables are ignored. The summary line on stderr gives
the frame count, the mode (listen-only, software bus or active) and the stop
reason. The first argument must be a command, so `can -- send` never reaches a
transmission. Exit codes: 0 done, 2 invalid arguments or a refused capture
(nothing opened), 3 the interface could not be opened or failed (with the
driver hint).

## Limits

Real adapters and Linux vcan0 have not been exercised by VERA's tests; the
opt-in acceptance uses udp_multicast. Listen-only is requested from the
backend as documented by python-can and is not read back from the adapter. A
background `.blf` capture that is stopped before its duration can be
incomplete; `.asc` and `.log` are written frame by frame.

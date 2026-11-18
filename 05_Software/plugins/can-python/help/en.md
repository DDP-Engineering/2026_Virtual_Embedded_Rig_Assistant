# CAN bus (python-can)

CAN bus lets the agent find CAN adapters, capture a bus listen-only to an ASC, BLF or candump log, and send single frames or replay a log on a live bus through python-can. Supported interfaces are PEAK, Vector, Kvaser, slcan, gs_usb (candleLight) and SocketCAN, plus a software bus (`udp_multicast`) for rehearsing without hardware. Decode the captures with the can-dbc plugin.

## What it needs

- **can**: a script on python-can 4.6.1, installed automatically by **Install dependencies** on the plugin page.
- A CAN adapter and its vendor driver, which you install yourself; VERA never installs drivers. `can list` reports each missing one with a hint: the PEAK driver with PCAN-Basic, the Vector driver setup and XL Driver Library (Windows), the Kvaser drivers and CANlib, WinUSB through Zadig for gs_usb on Windows.
- On Linux, bring a SocketCAN link up yourself, for example listen-only at the right bitrate, or create a virtual `vcan0` bus.
- The interface, channel and bitrate of your bus. The agent never guesses a bitrate.
- No configuration parameters.

## How to use it

- "Which CAN interfaces and drivers are available?"
- "Capture 10 seconds of the bus on PCAN_USBBUS1 at 500 kbit/s to captures/bus.asc." (skill `can-capture`)
- "Record 2000 frames from can0 to captures/can0.blf in the background."
- "Send ID 0x200 with data E80301 on PCAN_USBBUS1 at 500 kbit/s." (skill `can-transmit`)
- "Replay the first 50 frames of captures/startup.asc while capturing the response."

## Risk and approvals

- Safe, runs without asking: listing interfaces and drivers.
- Device-read: a listen-only capture. PEAK, Vector, Kvaser and slcan adapters are opened so they never acknowledge frames; a SocketCAN link counts only when you brought it up listen-only.
- Device-write: a capture with `--active`, where the adapter joins the bus and acknowledges frames; a wrong bitrate can raise error frames that disturb other nodes. The agent asks you before adding it.
- Irreversible: `send` and `replay`, which transmit on a live bus; receiving ECUs act on the frames at once. VERA asks you to type `send` or `replay` to confirm, except in Bypass.

In Ask mode VERA asks before each capture; Auto-edit runs listen-only captures without asking.

## Limits

- Windows x64 and Linux x64.
- Real adapters and Linux `vcan0` are not yet exercised by VERA's tests; listen-only is requested from the backend and not read back from the adapter.
- A capture limited only by a frame count ends after 240 seconds at the latest; ask for a duration to record longer.
- A `.blf` capture stopped before its duration can be incomplete; `.asc` and `.log` are written frame by frame.
- Bus settings come only from the command line; `~/.canrc`, `can.ini` and `CAN_*` variables are ignored.
- Reference: https://python-can.readthedocs.io/en/v4.6.1/

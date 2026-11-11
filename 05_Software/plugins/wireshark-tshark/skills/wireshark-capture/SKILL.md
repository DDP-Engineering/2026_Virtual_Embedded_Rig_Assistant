---
name: wireshark-capture
description: Capture live traffic from a network or USB interface with TShark into a bounded workbench .pcapng file, then analyse it.
---

A live capture listens on the host's interfaces and needs the user's approval
in ask mode. It requires Npcap on Windows (installed with Wireshark) or
dumpcap capture permissions on Linux (the `wireshark` group). VERA never
installs either; if tshark reports that no interfaces are available or that
permission is denied, tell the user which of these steps is missing.

List interfaces first and let the user confirm which one carries the board's
traffic. Never guess an interface from an example:

```text
tshark -D
```

Create `captures/` in the workbench and choose an unused file name. Always
bound the capture with a duration (`-a duration:<seconds>`) or a packet count
(`-c <packets>`), and add a capture filter (`-f`) that keeps only the board's
traffic. For example, after the user confirmed interface 3 and the board's
address:

```text
tshark -n -i 3 -f "host 192.168.7.10" -a duration:30 -w captures/board.pcapng
tshark -n -i 3 -f "udp port 5683" -c 200 -w captures/coap.pcapng
```

Keep durations short (60 s or less) for a foreground run. For a longer
capture use `background: true`, follow it with `program_output` and end it
with `program_stop`; tshark still closes the file on `-a duration`. A
capture without `-w` prints packets instead of saving them; prefer saving and
analysing the file with the wireshark-analyze skill.

Report the interface, filter, bound, the workbench-relative file and the
packet count (`tshark -n -r <file> -q -z io,phs`). An empty capture calls for
checking the interface, filter and cabling before retrying. Remote and extcap
interfaces (`rpcap://`, sshdump) reach other hosts; use them only when the
user asks, and never put credentials on the command line.

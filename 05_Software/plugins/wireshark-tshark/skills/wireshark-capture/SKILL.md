---
name: wireshark-capture
description: Capture live traffic of a board into a workbench .pcapng file - from a network, USB or sniffer interface of this computer with tshark, or on a Raspberry Pi with tcpdump - then analyse it. Use whenever a task needs to see what a board sends or receives on the wire.
---

A live capture listens on an interface of this computer and needs the user's approval in Ask mode. It needs Npcap
on Windows (installed with Wireshark) or dumpcap capture permissions on Linux (the `wireshark` group). VERA
installs neither; when tshark reports no interfaces or a denied permission, tell the user which is missing.

## Choose the interface

```text
tshark -D
```

lists the interfaces with their numbers and names (`Ethernet`, `Wi-Fi`, `\Device\NPF_Loopback`, and sniffer
interfaces such as USBPcap or an nRF Sniffer when installed). The board is usually behind the USB-Ethernet
adapter or the network card it is cabled to. When it is unclear, capture a few seconds on a candidate and count
what the board's address sent:

```text
tshark -n -i Ethernet -a duration:3 -q -z conv,ip
```

## Capture

Give `-i` the number or the name, bound the capture with a duration or a packet count, and write into
`captures/` under an unused name:

```text
tshark -n -i Ethernet -a duration:30 -w captures/board.pcapng
tshark -n -i 3 -f "host 192.168.7.10" -a duration:30 -w captures/board.pcapng
tshark -n -i 3 -f "udp port 5683" -c 200 -w captures/coap.pcapng
```

- A capture filter (`-f`) keeps the file small: `host <address>`, `port <n>`, `ether host <mac>`. Leave it out
  to see everything on the cable.
- tshark captures in promiscuous mode, which also sees frames not addressed to this computer (a mirror port, a
  tap, a hub); `-p` turns that off.
- Capture around an action - a boot, a flash, a failing request - by running the capture in the background:
  `run_program` with `background: true` and a duration that covers the action, then trigger the action and
  let the duration end the capture, which closes the file cleanly. `program_output` shows its progress and
  `program_stop` ends it early; the file then holds what was written until that moment.
- For a long watch use a ring buffer that keeps the newest files:
  `tshark -n -i 3 -b duration:60 -b files:5 -w captures/ring.pcapng`.
- A capture without `-w` prints packets instead of saving them; saving and analysing the file is nearly always
  better.

When the Wireshark Dumpcap plugin is enabled, prefer its tools for a network interface:
`wireshark_dumpcap` with `activity` shows which interface the board is on, and `wireshark_dumpcap_start`
captures by interface name for a set time, in the background around an action or as a rolling capture, and
keeps the result as a verified capture with a manifest of losses (skill wireshark-rolling-capture). tshark
remains the way for sniffer interfaces such as USBPcap or an nRF Sniffer and for captures written straight
into a workbench file.

## Capture on the board itself

A board that runs Linux can capture its own traffic, which also shows what never reaches this computer. With
the Raspberry Pi plugin:

```text
pi-tool exec --board pi --command "sudo timeout 20 tcpdump -i eth0 -w /tmp/board.pcap port 1883"
pi-tool fetch --board pi --path /tmp/board.pcap
```

`fetch` copies the file into its run folder in the workbench (8 MiB at most, so keep the filter narrow or the
time short); analyse that file here. `tcpdump` is installed with `sudo apt-get install -y tcpdump`.

## Afterwards

Report the interface, the filter, the bound, the workbench-relative file and the packet count (`capinfos -c
<file>`). An empty capture calls for checking the interface, the filter and the cabling before trying again.
Then answer the question with the wireshark-analyze skill. Remote capture interfaces (`rpcap://`, sshdump) reach
other hosts; use them only when the user asks, and never put a password on the command line.

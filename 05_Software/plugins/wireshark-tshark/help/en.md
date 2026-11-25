# Wireshark (TShark)

Use the offline capture tool to select fields, filter packets and cite frames from a verified capture. Import a capture to keep its verified bytes in the workbench.

This plugin lets the agent analyse network capture files with TShark and capture live traffic from an interface of your computer. It answers questions about `.pcap` and `.pcapng` captures of a board's Ethernet, Wi-Fi or USB traffic with display filters, field export, protocol statistics and packet details, and saves bounded live captures in the workbench.

## What it needs

- **TShark**, which you install yourself with Wireshark from https://www.wireshark.org/download.html (on Windows it includes TShark and offers Npcap), or your distribution's `tshark` package (`sudo apt install tshark` on Debian and Ubuntu). VERA never downloads it; the **Dependencies** section of the plugin page shows whether it was found.
- For live captures: Npcap on Windows, or dumpcap capture permissions on Linux (install `wireshark-common`, allow non-root capture, join the `wireshark` group and log in again). VERA leaves these steps to you.
- No other plugins and no configuration.

## How to use it

The agent uses the `wireshark-analyze` and `wireshark-capture` skills. It always reads files with `-r` and keeps addresses numeric, so no name lookups reach the network. For a live capture it lists the interfaces and lets you confirm which one carries the board's traffic.

- "Give me a protocol overview of captures/board.pcapng."
- "List every CoAP request in the capture with its time and URI path."
- "Show the TCP problems the expert analysis reports, with frame numbers."
- "Decode UDP port 5684 as CoAP and export the codes."
- "Capture 30 seconds of traffic to and from 192.168.7.10 on interface 3 into captures/board.pcapng."

## Risk and approvals

- **Safe** (runs without asking): reading a saved capture with any filter, field, statistics or output option, help, version and listing the interfaces.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): a live capture, and any command that writes a file or folder (`-w`, `--export-objects`, `--export-tls-session-keys`, `--log-file`), such as a filtered copy of a capture. A command without `-r` also captures live, on the first interface.
- **Device write** (asks in **Ask** and **Auto-edit**): an option this plugin does not recognise.
- **Blocked**: Lua scripts, which can run arbitrary code, and RPCAP passwords on the command line, which would be stored in run logs.

## Limits

- Windows x64 and Linux x64. The rules were measured against TShark 4.6.8.
- Typed offline analysis uses an isolated Wireshark profile. Generic TShark runs load your Wireshark profile and its extensions.
- Remote and extcap interfaces (sshdump, `rpcap://`) capture on other hosts. Configure remote capture and its credentials outside VERA.

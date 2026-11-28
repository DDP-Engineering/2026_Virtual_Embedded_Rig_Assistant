---
name: wireshark-rolling-capture
description: Capture traffic on a local interface with the wireshark_dumpcap tools into managed storage - find the interface a board is on, capture for a set time or around an action, or roll and keep the newest segments - with a manifest of what was kept and lost. Use whenever a task needs a live capture of what a board sends or receives on a network interface of this computer.
---

`wireshark_dumpcap_start` keeps what it captures as verified managed captures and reports exactly what was
retained, rotated out and dropped. It asks for approval as any device read does: in Ask mode, and not in
Auto-edit or Bypass.

1. `wireshark_dumpcap` with `operation: "discover"` lists the local interfaces with their IDs and names.
   `operation: "activity"` counts the packets each one sees during a few seconds (`seconds`, 2 by default)
   without reading them: the busy interface while the board talks is the one it is on.
2. `wireshark_dumpcap_start` needs only `interfaceId`: an ID or a listed name such as `Ethernet`.
   - `filter`: a pcap capture filter - `host 192.168.7.10`, `udp port 5683`, `ether host 02:00:00:00:00:01`.
     Without one every packet is kept.
   - `durationSeconds`: 30 by default, 3600 at most. `totalBytes`: 16 MiB by default, 64 MiB at most. Each
     packet is kept up to 4096 bytes and a file ends at 50,000 packets.
   - The interface is opened in promiscuous mode, which also sees frames not addressed to this computer (a
     mirror port, a tap, a hub); `promiscuous: false` keeps to this computer's own traffic.
3. A capture of up to 60 seconds waits and returns its manifest. A longer one, or any with `background: true`,
   returns a `captureId` at once. That is how to capture around an action: start it, run the action (a boot, a
   flash, the failing request), then `wireshark_dumpcap` with `operation: "stop"` and that ID. `status` shows
   whether it still runs. One capture runs per session.
4. `rotation: { segmentSeconds, segmentBytes, retain }` rolls: the newest `retain` segments (8 at most) are
   kept while waiting for a rare event. Stop when the event has happened, so its segment is still retained.
5. Read the manifest: `segments` with their `reference`, packet counts and first and last packet times,
   `rotatedOut`, `lastSegmentPartial` and `stats` (captured, received, dropped; null means dumpcap did not
   report it). Say what was lost.
6. Pass a segment's exact `reference` as `source: { reference }` to `wireshark_capture` to read it (the
   wireshark-analyze skill of the Wireshark TShark plugin).

Sniffer interfaces that Wireshark reaches through extcap (USBPcap, an nRF Sniffer, sshdump) are not listed here;
capture on those with `tshark -i` (the wireshark-capture skill).

`npcap_missing`: Windows needs Npcap, which the Wireshark installer offers. `capture_permission`: on Linux add
the user to the `wireshark` group and log in again. `invalid_capture_filter`: dumpcap could not compile the
filter. `interface_unavailable`: the ID or name matches no listed interface, or more than one.

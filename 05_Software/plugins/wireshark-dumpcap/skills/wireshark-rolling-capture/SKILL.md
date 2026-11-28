---
name: wireshark-rolling-capture
description: Capture traffic on a local interface with the wireshark_dumpcap tools into managed storage - one bounded capture, or a rolling capture that keeps the newest segments - with a manifest of what was kept and lost. Use when a capture must be retained as verified evidence or must roll while waiting for a rare event.
---

`wireshark_dumpcap_start` keeps what it captures as verified managed captures and reports exactly what was
retained, rotated out and dropped. For an ordinary capture into a workbench file, `tshark -i` (the
wireshark-capture skill of the Wireshark TShark plugin) is simpler and has fewer limits.

1. `wireshark_dumpcap` with `operation: "discover"` lists the local interfaces with their IDs
   (`\Device\NPF_{...}` on Windows, `eth0` on Linux). Let the user confirm which one carries the board's
   traffic.
2. `wireshark_dumpcap_start` takes that `interfaceId`, a `filter`, `durationSeconds` and `totalBytes`. VERA asks
   the user to approve every capture, in every mode.
   - The filter is required and uses numbers only: `host 192.168.7.10`, `udp port 5683`, `ether host
     02:00:00:00:00:01`, `ip or ip6 or arp` for everything. Host names are refused.
   - A capture lasts 1 to 120 seconds and holds 16,000 bytes to 32 MiB. Each packet is kept up to 4096 bytes.
   - The interface is opened without promiscuous mode, so only frames to and from this computer (and broadcast)
     are seen. Sniffer interfaces such as USBPcap are not offered.
3. Without `rotation` the call waits and returns the manifest. With `rotation: { segmentSeconds, segmentBytes,
   retain }` it starts a rolling capture that keeps the newest `retain` segments (at most 8) and returns a
   `captureId`: `wireshark_dumpcap` with `status` or `stop` and that ID follows and ends it. Stop when the event
   has happened, so the segment that holds it is still retained.
4. Read the manifest: `segments` with their `reference`, packet counts and first and last packet times,
   `rotatedOut`, `lastSegmentPartial` and `stats` (captured, received, dropped; null means dumpcap did not
   report it). Say what was lost.
5. Pass a segment's exact `reference` as `source: { reference }` to `wireshark_capture` to read it (the
   wireshark-analyze skill).

`npcap_missing`: Windows needs Npcap, which the Wireshark installer offers. `capture_permission`: on Linux add
the user to the `wireshark` group and log in again. `invalid_capture_filter`: use numbers and the words above.

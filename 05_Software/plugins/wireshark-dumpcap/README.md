# Wireshark Dumpcap

Optional Windows and Linux plugin for local PCAPNG acquisition. VERA finds an installed Dumpcap from
Wireshark 4.2 or later. Windows needs Npcap. Linux needs permission for the selected device. Enable the
separate Wireshark TShark plugin to analyse retained files. The skill `wireshark-rolling-capture` carries
these steps.

- `wireshark_dumpcap` with `discover` lists the local interfaces with their IDs and names; with `activity` it
  counts the packets each one sees during a few seconds (dumpcap's statistics mode, `-S -M`; no packet is
  read), to find the interface a board is on.
- `wireshark_dumpcap_start` takes the interface by ID or by name. Everything else is optional: a pcap capture
  `filter` (none keeps every packet), `durationSeconds` (30 by default, 3600 at most), `totalBytes` (16 MiB by
  default, 64 MiB at most), `promiscuous` (true by default) and `background`. A capture is a device read: VERA
  asks in Ask mode and runs it in Auto-edit and Bypass.
- A capture of up to 60 seconds waits for the final result. A longer one, one with `background: true` and a
  rolling one (`rotation` with `segmentSeconds`, `segmentBytes` and `retain`, eight segments at most) return a
  capture ID at once; `wireshark_dumpcap` with `status` or `stop` and that ID follows and ends it, which is
  how to capture around an action. One capture runs per session.
- Each packet is kept up to 4096 bytes and a file ends at 50,000 packets. Native rotation also obeys the
  space reserved for PCAPNG framing.
- The final manifest records the interface, the filter, the mode, the exact managed references, timestamps,
  counts, retention gaps and any incomplete last segment. Unavailable drop counts are unknown. Forward the
  exact managed `reference` to `wireshark_capture` for offline inspection.
- Interfaces Wireshark reaches through extcap (USBPcap, sniffer dongles, sshdump) are not offered; use
  `tshark -i` of the TShark plugin for those.

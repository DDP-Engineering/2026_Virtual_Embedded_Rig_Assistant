# Wireshark Dumpcap

Optional Windows and Linux plugin for bounded local PCAPNG acquisition. VERA finds an installed
Dumpcap from Wireshark 4.2 or later. Windows needs Npcap. Linux needs permission for the selected
device. Enable the separate Wireshark TShark plugin to analyse retained files.

- Use `wireshark_dumpcap` with `discover` to find current interface IDs. Choose a local interface
  explicitly. The typed command uses non-promiscuous capture and numeric capture filters.
- Use `wireshark_dumpcap_start` with the interface ID, filter, duration and total byte maximum.
  Confirm the exact request in the session. Short capture waits for the final result. For rolling
  capture, specify a smaller interval, byte maximum per segment and a retained segment count.
- The limits are 1–120 seconds, 16,000 bytes to 32 MiB per capture, and up to eight retained
  segments. Native rotation also obeys the host packet budget and space reserved for PCAPNG framing.
- Use `wireshark_dumpcap` with `status` or `stop` and the issued capture ID. Runs can stop the owned
  process directly. The final manifest records the exact managed references, timestamps, counts,
  retention gaps and any incomplete last segment. Unavailable drop counts are unknown. Forward the
  exact managed `reference` to `wireshark_capture` for offline inspection.

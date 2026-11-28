# Wireshark Dumpcap

Enable this optional plugin and install Dumpcap 4.2 or later. Windows requires Npcap. On Linux the selected interface requires capture permission.

Ask VERA to list local capture interfaces. Choose one and provide a capture filter using numeric addresses or ports, a duration and a byte limit. Approve the displayed request. For a rolling capture, also set the segment limits and how many segments to keep. Use the capture ID to check status or stop it. The manifest reports retained segments and known losses. Enable Wireshark TShark to inspect a retained capture.

A capture lasts at most 120 seconds and holds at most 32 MiB, VERA asks you to approve every one, and only traffic to and from this computer is seen. For any other capture, ask the agent for a TShark capture into a workbench file.

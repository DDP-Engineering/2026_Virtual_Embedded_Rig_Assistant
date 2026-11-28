# Wireshark Dumpcap

Enable this optional plugin and install Dumpcap 4.2 or later. Windows requires Npcap. On Linux the selected interface requires capture permission.

Ask VERA to capture what a board sends and receives on a network interface of this computer. It lists the interfaces and can count the packets each one sees for a few seconds, to find the one the board is on. Name the interface; a capture filter, a duration (30 seconds by default, up to an hour) and a size limit are optional. A capture longer than a minute runs in the background, so you can ask VERA to start it, run a test or reboot the board, and then stop it. For a rare event, ask for a rolling capture that keeps the newest segments. The result reports what was kept and what was lost. Enable Wireshark TShark to inspect a retained capture.

A capture is a device read: VERA asks you in Ask mode and runs it on its own in Auto-edit and Bypass. USB and sniffer interfaces that Wireshark reaches through extcap are captured with TShark instead.

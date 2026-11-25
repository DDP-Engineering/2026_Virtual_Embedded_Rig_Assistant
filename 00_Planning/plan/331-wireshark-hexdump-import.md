# #331 Wireshark firmware and UART hexdump import

Epic #400. Uses managed capture references from #401 and verified publication from #330.
Source: [Gitea #331](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/331).

- Discover and version-probe text2pcap. Convert a bounded ASCII hexdump subset offline using an explicit parser, encapsulation or synthetic header, and timestamp profile.
- Publish a validated PCAPNG with a managed binary reference and a manifest recording the source hash, parser profile, tool version, and synthetic headers and timestamps.
- Preserve source bytes. Reject malformed, incompatible, oversized and cancelled imports without a complete result.
- Verify packet boundaries, bytes, counts and timestamp origin with independent synthetic fixtures and native Windows readback. Native Ubuntu acceptance and complete suites belong to user-started final verification.

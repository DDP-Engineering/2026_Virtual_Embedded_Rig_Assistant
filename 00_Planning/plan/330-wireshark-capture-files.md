# #330 Wireshark capture files

Epic #400. Uses offline inspection and managed capture references from #401.
Source: [Gitea #330](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/330).

- Discover and version-probe capinfos, editcap and mergecap. Report readiness per operation independently of existing TShark analysis.
- Inspect PCAP/PCAPNG metadata. Select frames, split by count or time, merge chronologically, convert, reorder, deduplicate and explicitly clean capture comments, packet comments and embedded decryption secrets.
- Store verified derived captures under the existing managed capture contract. Record source and output hashes, tool versions, parameters and verifiable frame lineage. Bound structured field, PDU and object exports and keep extracted data local.
- Verify independent synthetic fixtures, unchanged sources, ordering, cleanup, reuse and failed publication. Use focused Windows native checks and static validation. The user owns native Ubuntu acceptance and complete suites at final verification.

# #402 Wireshark traffic analysis

Epic #400. Builds on saved-capture inspection in #401 and frame citations in #334.
Source: [Gitea #402](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/402).

- Add protocol hierarchy, directional endpoints and conversations, interval traffic, Expert Info,
  supported request/response timing and bounded TCP and UDP stream evidence.
- Report observed packet and byte counts, filter and time scope, capture interfaces, reassembly
  settings, gaps, truncation and checksum status. Attach source frames and keep payload local.
- Reconcile synthetic saved captures against native TShark with focused checks. Native Ubuntu
  acceptance and complete suites belong to the user-started final verification.
- Leave protocol profiles and capture comparison to #214, #233 and #333.

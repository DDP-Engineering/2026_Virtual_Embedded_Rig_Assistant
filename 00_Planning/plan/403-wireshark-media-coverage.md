# #403 Wireshark media profiles and Desktop workflows

Epic #400. Depends on the integrated proof in #404 and the saved-frame handoff in #334.
Source: [Gitea #403](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/403).

- Add bounded offline Wi-Fi/802.11, BLE, USB and VoIP/RTP profiles using the existing
  TShark and capture-evidence path. Report coverage and available RTP stream statistics.
- Verify each profile on independently generated synthetic traffic with native Windows
  utilities, including source frames. Record a repeat-query cost comparison and the sharkd decision.
- Maintain a guide-linked matrix of VERA operations and Wireshark Desktop handoffs, platform
  conditions, permissions and proof. Reuse #334 for native frame opening. Document operator steps
  for specialized views, playback, profiles and local decryption configuration.
- Windows live capture, native Ubuntu and full suites are deferred to final verification.
  Keep live hardware, playback and manual Desktop procedures pending until exercised. Remote
  extcap, a sharkd backend and automated decryption are optional and need separate evidence.

## Done criteria

- Each offline family has a compact result, explicit coverage and a native synthetic
  oracle that establishes its source frames. RTP statistics include their availability or limits.
- The coverage matrix identifies platform and permission conditions, evidence, Desktop steps
  and outstanding adapter, driver, codec or manual checks. Keys and decoded payload stay local.
- The repeat-query comparison records the workload, results and backend decision. Focused
  tests, statics, strict AEGIS and both independent reviews cover the complete candidate.

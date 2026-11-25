# #332 Wireshark Dumpcap local capture

Source [Gitea #332](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/332), in epic #400.

- Deliver the optional official `wireshark-dumpcap` plugin. Discover the installed tool and local
  interfaces, with distinct diagnostics for missing Npcap, capture permissions and unavailable interfaces.
- Require an explicit local observation point, an approved capture filter and host-bounded duration,
  byte budget and retention. Short and rolling capture share session ownership, status, Stop and expiry.
- Preserve validated finalized PCAPNG segments and expose losses and partial output in a capture
  manifest. Retained segments use the verified managed capture identity from #401.
- Verify runner failures, approval, ownership, Stop, expiry and storage bounds with stand-ins. Use
  bounded synthetic UDP on an isolated loopback for live proof. Native Windows and Ubuntu live
  capture and full suites belong to final verification. Windows discovery requires Npcap.

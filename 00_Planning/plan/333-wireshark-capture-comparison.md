# #333 Compare saved Wireshark captures

Epic #400. Uses saved capture inspection #401, traffic analysis #402, normalized networking
evidence #233 and exact frame navigation #334.
Source: [Gitea #333](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/333).

- Compare verified baseline and candidate captures offline under declared windows, protocol
  scope and endpoint matching rules. Report conversation, packet and wire-byte changes,
  observed TCP retransmissions and supported response-time distributions.
- Preserve exact representative frame references and immutable source hashes. Report coverage,
  capture duration, clock uncertainty, unavailable metrics and unmatched traffic explicitly.
- Return bounded machine-readable evidence and a concise local report for later HIL reporting
  or assertions (#104).

## Done criteria

- Independent offline fixtures exercise planted differences and an equivalent pair. Windows
  proof reconciles metrics and frame references with the structured result and local report.
- Partial captures, incompatible windows, unmatched traffic and inadequate timing evidence
  receive comparability diagnostics. Repeated results agree and input hashes stay unchanged.
- Run focused and static checks, strict AEGIS and independent reviews. The user owns native
  Ubuntu acceptance and complete suites at the final verification gate.

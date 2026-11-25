# #233 Wireshark networking profiles

Epic #400. Uses saved-capture inspection #401, frame citations #334 and traffic analysis #402.
Source: [Gitea #233](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/233).

- Add typed offline Ethernet/VLAN, IPv4/IPv6, ARP/ND, DNS/DHCP, TCP/UDP,
  multicast and observable TLS queries. Preserve #214 and the CoAP and Modbus workflows.
- Return compact, redacted evidence with native fields, capture and frame provenance,
  filter, endpoints, tool version and explicit coverage limits for #333.
- Reconcile independent synthetic captures with native Windows TShark. The user owns
  native Ubuntu acceptance and complete suites at the final verification gate.
- Keep acquisition, active probes, decryption and data publication outside this package.

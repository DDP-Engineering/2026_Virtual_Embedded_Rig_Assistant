# Offline Automotive Ethernet evidence

`wireshark_capture` operation `automotive` accepts `automotiveProfile` (`doip`, `someip` or
`someip_sd`), a verified saved capture source, optional VLAN, numeric IP addresses, TCP/UDP
ports and typed Decode As mappings. Address and port lists match either observed endpoint.
The VLAN selector matches any tag and the evidence retains the ordered tag stack. The SD
profile supplies UDP 30490 as SOME/IP unless the caller supplies that mapping. Other SOME/IP
service ports are capture-specific. TShark's SD message-ID dissector handles Service Discovery.

The selected profile projects each native DoIP or SOME/IP protocol node as its frame citation
and one-based occurrence of the protocol within that frame. Field names are native abbreviations
within that occurrence or SD entry. TCP completion includes the upstream contributing segments.
SOME/IP-TP fragments and completion are distinguished and include upstream fragment references
when available. Field references and payload lengths refer back to the verified local capture
and its native tree. Payload bytes, vehicle identifiers and native display strings stay local.

Directional counts are grouped by transport, native stream, endpoint pair, VLAN stack and
capture section/interface. Raw frame evidence retains decimal epoch, per-packet observation
direction when present, point and media encapsulation. Unsupported or ambiguous transport
context, saved drops, timestamp gaps, truncation and reassembly gaps are explicit coverage
observations. A partial scan can only make claims about its prefix. Timestamp synchronization
and drops not reported by the capture are unknown.

A frame can carry a complete TCP PDU and the start of its successor. Coverage compares native
TCP bytes with the bytes accounted for by native PDU nodes and their contributing segments.
Contributor bytes count as resolved only within the completion's directional observation context.
SOME/IP-TP forward links are checked against the native completion and its contributor contexts.
The tool cites corroborated completion frames and reports unverified context as partial coverage.
An IP fragment can match a known address while its transport port remains unresolved. Such a
fragment remains in coverage without being counted as a matching transport observation.

Profile and native preferences accompany the capture identity. The cursor binds the exact
selection, capture and native settings. Pages and native output use host-owned bounds.
Invalid Decode As, unavailable native fields, malformed native output and bounds use typed errors.

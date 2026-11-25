# Wireshark (TShark)

Enable **Capture analysis** in the Wireshark pack. The plugin exposes
`tshark` through VERA's program tools with two skills: `wireshark-analyze`
for saved `.pcap`/`.pcapng` files and `wireshark-capture` for bounded live
captures. The official package also enables VERA's typed `wireshark_capture`
tool for saved captures.

## Offline inspection in VERA

Use `wireshark_capture` to inspect a PCAP or PCAPNG in the workbench, discover
fields and protocols, check a display filter, page through selected packets and
retrieve one frame. The tool uses VERA's offline dissection profile with name
resolution disabled. A Decode As entry selects TCP or UDP, a port and a
dissector. Offline filters accept protocol presence and comparisons on selected
fields with numeric addresses. Packet values are untrusted capture data.

Use the returned capture reference and page cursor to continue a query. Cite
the SHA-256 and the frame number. Check coverage for incomplete scans, more pages
and truncated fields. Use `wireshark_import` to retain a verified copy in managed
workbench storage. The `verify_reference` operation checks file identity even
when TShark is unavailable. Small text reports use the session artifact store.

## Saved capture files

Use `capabilities` to check Capinfos, Editcap, Mergecap and TShark by operation.
`file_metadata` reports the encapsulation, interface IDs, link types, timestamp
resolution, snapshot lengths, packet counts, available epoch times and SHA-256.

Use `wireshark_derive` to select frame ranges, display-filter matches or a
half-open epoch range. You can split by packet count or elapsed seconds from
the first packet in each part, merge in timestamp order, reorder without
changing timestamps, deduplicate using a preceding-packet window, or convert
to PCAPNG or nanosecond PCAP. Time splitting requires a chronological source.
Chronological operations require timestamps. PCAPNG is the default. PCAP may
drop metadata and requires compatible encapsulation.

Each completed result lists verified managed capture references, input
references, versions and parameters. Lineage ranges contain the first output
frame, zero-based input index, first source frame and length. The result gives
a bounded preview and a managed `lineageReport`. Use `file_lineage` with that
reference, a 1-based output `part` and the returned `nextOffset` to read
every verified row. Indistinguishable packets
at a tied timestamp can have ambiguous ancestry. Reuse the returned capture
reference with `wireshark_capture` to inspect and cite a derived frame.

Cleanup can clear capture comments, packet comments and embedded decryption
secrets. It reports the affected blocks and comments. Packet data and
identifiers can remain. Field, PDU and HTTP object records stay local. Field
and object exports are retained as JSON session artifacts. Object export
includes complete, unencoded HTTP bodies with matching Content-Length and
keeps their bytes as inert base64 with frame numbers and SHA-256. PDU exports
use fixed native taps and retain a managed PCAPNG. Native origin tags can
identify the emitting frame and have no contributor list. Structured reports
are refused when the active export mask would alter their data.

The operation limits include 64 MiB and 50,000 packets across the inputs,
64 MiB total derived output, 16 split parts, 24 chronological runs, and 200
rows per report. The combined object body budget is 256 KiB. Operations
work on verified snapshots, preserve the original files, and publish a
complete group after checking the output bytes and packet evidence. Derived
captures and lineage reports use exclusive publication on filesystems that
support hard links. VERA reports unsupported PCAPNG records explicitly.

## Import a firmware or UART hexdump

Check `capabilities.fileOperations.importHexdump` for Text2pcap readiness. Call
`wireshark_derive` with `operation: "import_hexdump"`, the saved workbench
`path`, and an explicit `hexdumpProfile` with these entries.

| Field | Values |
| --- | --- |
| `parser` | `"ascii-offset-v1"` |
| `timestamps` | `"trace_utc"` uses a UTC timestamp before every packet. `"synthetic"` assigns one microsecond per packet starting at 2000-01-01T00:00:00Z. |
| `encapsulation` | `{ kind: "ethernet" }` for complete Ethernet frames of at least 14 bytes. `{ kind: "user0" }` for opaque bytes. `{ kind: "udp_ipv4", sourcePort, destinationPort }` to add Ethernet, IPv4 and UDP headers, plus Ethernet padding when needed. |

Use one to 32 two-digit hex bytes per line, preceded by a 3–8 digit hex
offset. Separate tokens with space or tab. Reset the offset to zero for
each packet and give subsequent lines the offset in bytes. Use LF or CRLF.
Blank lines are allowed. Keep timestamps on their own lines as
`@YYYY-MM-DDTHH:mm:ss[.fraction]Z` (1970–2099, up to nine fractional
digits). Leave out timestamps in synthetic mode. Comments, omitted bytes
and printable text columns are outside this profile.

~~~
@2026-03-14T15:09:26.123456789Z
000 DE AD
002 BE EF
@2026-03-14T15:09:27Z
000 13 37 00 55 AA
~~~

The converter accepts up to 4 MiB of input, 256 bytes per line, 16 KiB per
packet and 10,000 packets. The PCAPNG limit is 8 MiB. Synthetic UDP uses
192.0.2.1 and 192.0.2.2 and the supplied ports (1–65535). The packet bytes,
boundaries, lengths and timestamps are checked before publication. Reuse the
managed capture reference with `wireshark_capture`. The returned provenance
and its managed JSON manifest identify the original size and SHA-256, the
selected profile, Text2pcap's version, synthetic metadata and the output hash.
The original stays in place. Failed or cancelled conversions leave no complete
import. The workbench stores the JSON manifest at
`.vera/captures/<manifest.sha256>.provenance.json`. The [Text2pcap manual](https://www.wireshark.org/docs/man-pages/text2pcap.html)
describes the underlying converter.

## Traffic statistics and streams

Use `statistics` for protocol stack prefixes, directional endpoint and conversation counts
(Ethernet, IPv4, IPv6, TCP or UDP), interval traffic, Expert Info and capture diagnostics,
or DNS and HTTP response timing. Traffic intervals cover a half-open window in milliseconds
relative to the first timestamped frame and return counts and per-second rates. Wire bytes come from frame
lengths and captured bytes come from saved lengths. Evidence includes the capture section and
interface identifiers when available. A capture records one or more observation points, and the
tool cannot infer where a packet was lost or why a checksum was marked. Set `validateChecksums`
to request TCP and UDP validation and partial checksum observations. The result identifies the
applied reassembly preferences and reports truncated frames and incomplete measurements.

Use `follow` with a TCP or UDP stream ID from the conversation rows. Its directional byte
totals count native follow records anchored to frames in the requested scope. TCP retransmissions
can appear in packet and diagnostic counts while contributing no repeated bytes to the followed
stream. Gap records carry the frame that revealed the gap and a byte estimate when TShark
provides one. Follow reads the scanned capture prefix before selecting records by filter or window.
Open a cited frame in Wireshark Desktop and use **Follow Stream** there for payload.
The verified local capture retains the exact bytes.

Continue evidence pages with `trafficCursor` and the original query. Check scan and measurement
coverage before interpreting an empty interval, missing response, absent stream or transport
observation. The capabilities list names the typed statistics and dissectors. A native tool that
lacks their required fields or preferences returns an explicit capability diagnostic.

## Networking profiles

Use `network` with `networkProfile` set to `ethernet_vlan`, `ipv4_ipv6`, `arp_nd`,
`dns_dhcp`, `tcp_udp`, `multicast` or `tls`. Check the installed version and profile
list with `capabilities`. An optional offline display filter and scan bound select
the scope. Continue with `networkCursor` and the original query.

- `networkQuery.kind: exchanges` shows ARP/ND and DNS/DHCP message roles and
  observed transaction attributes. Native DNS request and response links require a
  corroborating frame in the scanned prefix with matching observation context.
  The result identifies counterpart frames outside the filter and unresolved links.
- `networkQuery.kind: conversations` requires `transport: tcp` or `udp` and groups
  the scoped frames by stream, endpoints, VLAN stack and observation point.
  Directional counts have representative frame links. Frames with both TCP and
  UDP and fragments with unverified transport endpoints remain visible in coverage.
- `networkQuery.kind: tcp_symptoms` shows native sequence symptoms, resets,
  checksum markers and truncation. Checksum validation is opt-in. An offload
  marker or unobserved segment identifies a limit of the capture.
- `networkQuery.kind: multicast` shows observed group destinations and IGMP/MLD
  messages. Broadcast addresses are excluded from multicast destination matching.
- The TLS profile shows visible record and handshake metadata, opaque records
  and port 443 candidates without decoded TLS metadata. Reassembled observations
  link to verified same-context contributors, including those outside the filter.
  Incomplete and mixed-context assembly can withhold decoded fields. Embedded
  decryption secrets are rejected before dissection. Payload and key material stay local.

The Ethernet and VLAN profile reports decoded VLAN tags on Linux cooked captures
with Ethernet endpoints unavailable. An ordered VLAN stack that exceeds the
result limit is marked as truncated.

Use `evidenceMode: compact` to hide network addresses, MAC addresses and name
values while retaining frame links, ports, transaction attributes and coverage.
Compact results also hide the local path and display filter. The exact navigation
context stays in the private workbench tool record. Use an exact returned
frame reference to open a verified local packet. Check the per-field redaction
list, missing values, drop metadata, truncated frames and reassembly markers
before interpreting the evidence. Unknown drop counts are reported as unavailable.

## Automotive Ethernet

Use `automotive` with `automotiveProfile` set to `doip`, `someip` or `someip_sd` in a saved
capture. DoIP uses native TCP/UDP port 13400. Service Discovery supplies a UDP 30490 Decode As
mapping to SOME/IP. For a service on a capture-specific port, supply `decodeAs` with protocol
`someip` and the relevant transport and port. The optional `vlan`, `addresses` and `ports`
selectors constrain the observed frames. `expectedPoints` lists expected section and interface IDs.
Continue with `automotiveCursor` and the original selection.

A PDU locator identifies its native protocol occurrence and byte range within the frame or TCP
reassembly buffer. Native field abbreviations identify header fields and fields within individual
Service Discovery entries. Open the cited frame in Wireshark Desktop to inspect payload locally.
Conversations use native streams and directional counts. They include the ordered VLAN tag stack
and the observation section and interface where available. Frame records retain epoch timestamps
and per-packet capture direction when present.

Coverage describes the scanned prefix. Check for unsupported encapsulation, capture truncation,
unfinished or malformed payload, missing observation points and timestamp backsteps. Drop counts
use packet metadata when available. Clock synchronization remains unknown. The profiles support
Ethernet and PPI-wrapped Ethernet with TCP or UDP and use upstream in-order TCP and SOME/IP-TP
reassembly. IP-fragmented traffic is reported outside the exact PDU projection. Native field
or preference support is checked when requested. The saved-capture host limits apply.
The scan can report an unfinished TCP suffix alongside a completed PDU in the same frame.
TCP bytes attributed to a completion from another VLAN or observation point remain unresolved
in the selected context. A SOME/IP-TP fragment links to its corroborated completion frame.
Mixed or unknown contributor context remains visible even when the completion is outside the selection.
An address-matched IP fragment with an unknown port remains an unresolved observation.

## Installation

VERA uses the user's TShark and never downloads it. On Windows it searches
PATH, then `%ProgramFiles%\Wireshark\tshark.exe`, where the Wireshark
installer places it. On Linux it searches PATH, then `/usr/bin/tshark`
(`sudo apt install tshark` on Debian and Ubuntu). When none is found, the
Plugins page shows the program as missing with an install hint. The rules
were measured against the options of TShark 4.6.8.
Capinfos, Editcap, Mergecap and Text2pcap use the corresponding executable names and
locations. Typed readiness is independent of TShark analysis.

## Risk levels

| Command | Risk |
|---|---|
| `-r <file>` with any filter, field, statistics or output option; `-v`, `-h`, `-G` reports; `-D`/`--list-sources` interface listing | safe |
| an option that writes a file or folder: `-w <file>`, `--export-objects`, `--export-tls-session-keys`, `--log-file` | device-read |
| `-i`/`--source`, `-I`, `-L`, `--list-time-stamp-types`, or no `-r` at all (tshark then captures the first interface) | device-read |
| an option this plugin does not recognise | device-write |
| `-X lua_script…` (runs Lua code), `-A user:password` (RPCAP credentials) | blocked |

The plugin parses tshark's options the way tshark does: case-sensitive
letters (`-x` dumps bytes, `-X` sets extension options), grouped flags
(`-nr`), attached values (`-ifoo`), unique long-option abbreviations and the
end of options at the first filter word or `--`. A filter word never lowers
the risk of the options after it. A command that writes a file asks like a
live capture does, because the path may lie outside the workbench; `-w -`
writes to standard output and stays safe.

## Live capture

Live capture needs Npcap on Windows (offered by the Wireshark installer) or
dumpcap capture permissions on Linux: install `wireshark-common`, allow
non-root capture, add the user to the `wireshark` group and start a new login
session. VERA leaves both steps to the user.

## Limits

Typed offline operations use isolated configuration with host-owned limits.
Generic program runs use the user's Wireshark profile and its extensions.
Extcap interfaces such as sshdump or `rpcap://` capture on other hosts and
are classified like any live capture. Only `-A` is refused as a credential:
extcap options passed with `-o extcap.<tool>.<option>:<value>` can also carry
passwords, so configure remote capture outside VERA.

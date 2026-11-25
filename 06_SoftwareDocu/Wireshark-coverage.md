# Wireshark coverage and Desktop workflows

VERA's typed offline tools analyze saved PCAP and PCAPNG snapshots in the owning
workbench. They require the enabled official Capture analysis plugin, a compatible
TShark installation, and read access to the source. VERA runs native dissection
with names unresolved and an isolated Wireshark configuration. On Linux, run VERA
as an ordinary user. Offline reads need neither Npcap nor capture privileges.
The **Open in Wireshark** action requires a native Wireshark Desktop installation
and a user gesture. [Wireshark User's Guide](https://www.wireshark.org/docs/wsug_html_chunked/).

## Coverage matrix

| Family and guide | VERA operation and backend | Wireshark Desktop responsibility and prerequisites | Evidence and platform status |
|---|---|---|---|
| [Saved files and display filters](https://www.wireshark.org/docs/wsug_html_chunked/ChWorkDisplayFilterSection.html) | TShark discovery, filter checks, packet queries and citation. Capinfos, Editcap, Mergecap and Text2pcap provide typed metadata and derivation where installed. | Inspect packet detail and bytes locally. A verified citation opens the exact source or derived-file frame with its applicable filter. | Existing Windows source and derived-frame proof in [#334](../.agentic/tasks/TASK-41c72419.md), plus native offline workflow replay in [#404](../.agentic/tasks/TASK-3416fe29.md). Native Ubuntu remains in final verification. |
| [Statistics and Follow Stream](https://www.wireshark.org/docs/wsug_html_chunked/ChAdvFollowStreamSection.html) | TShark traffic and protocol profiles return scoped counts, timing, TCP and UDP stream metadata and cited frames. | Use Statistics, Flow Graph and Follow Stream for detailed views and payload. Menu availability depends on the dissector and selected packet. | [#404 integrated evidence](../.agentic/tasks/TASK-3416fe29.md) for generic offline workflows. #403 Desktop menu walkthroughs remain manual. |
| [Wi-Fi and WLAN Traffic](https://www.wireshark.org/docs/wsug_html_chunked/ChWireless.html) | `mediaProfile: wifi` reports WLAN frame type, subtype, protected flag and available Radiotap frequency and signal. | Wireless → WLAN Traffic for local station and network detail. The saved trace needs decoded 802.11 frames and Radiotap headers for radio measurements. | In `media-wifi.pcapng`, native Windows 4.6.10 reads a Radiotap beacon at frame 1 and clipped protected data at frame 2. Native Ubuntu and monitor mode capture remain pending. |
| [BLE and Bluetooth summary views](https://www.wireshark.org/docs/wsug_html_chunked/ChWireless.html) | `mediaProfile: ble` reports BLE advertising PDU type, LE HCI event subtypes and ATT opcode/handle when present. ATT is also shared by other Bluetooth transports. | Wireless → Bluetooth Devices, Bluetooth HCI Summary or Bluetooth ATT Server Attributes. Views need the corresponding decoded packets. | Native Windows 4.6.10 reads advertisement frame 1 in `media-ble.pcapng` and LE HCI frame 1 and ATT frame 2 in `media-ble-hci.pcapng`. Native Ubuntu and real acquisition remain pending. |
| [USB capture formats](https://wiki.wireshark.org/CaptureSetup/USB/) and [USB CDC Follow](https://www.wireshark.org/docs/wsug_html_chunked/ChAdvFollowStreamSection.html) | `mediaProfile: usb` reports transfer type, endpoint, applicable IRP direction or status and available setup request code. | Use Statistics → Conversations → USB for USB conversations. Analyze → Follow → USB CDC Stream applies to decoded CDC traffic. | Native Windows 4.6.10 reads synthetic USBPcap and Linux usbmon bulk records at frames 1–2 in `media-usb.pcapng` and `media-usbmon.pcapng`. Native Ubuntu and either live driver remain pending. |
| [VoIP and RTP](https://www.wireshark.org/docs/wsug_html_chunked/ChTelRTP.html) | `mediaProfile: voip` reports observed SIP, SDP, RTP and RTCP with allowlisted status and RTP headers. It computes bounded directional RTP metrics from native packet fields. Supply a known UDP `rtpPort` if signaling is unavailable. | Telephony → VoIP Calls or SIP Flows for signaling. Use Telephony → RTP → RTP Streams or Stream Analysis for native stream statistics and packet inspection. | Native Windows 4.6.10 identifies SIP frame 1 and RTP frames 2–6 in `media-voip.pcapng` with explicit Decode As. In `media-voip-signaled.pcapng`, SDP at frame 1 identifies RTP at frames 2–3 without overrides. RTCP-specific behavior and native Ubuntu remain pending. |
| [RTP Player](https://www.wireshark.org/docs/wsug_html_chunked/ChTelPlayingCalls.html) | The VoIP profile cites a representative RTP packet. | In RTP Streams, select the relevant direction, choose **Play Streams**, then **Play** in RTP Player. Check codec availability in Help → About Wireshark → Plugins. Playback needs a decoded codec, captured audio payload and working audio output. | Stream metrics and exact handoff preparation have Windows terminal proof. Actual playback, codec output and the manual menu steps remain pending. |
| [Configuration Profiles](https://www.wireshark.org/docs/wsug_html_chunked/ChCustConfigProfilesSection.html) and [WLAN decryption keys](https://www.wireshark.org/docs/wsug_html_chunked/Ch80211Keys.html) | VERA's media profiles use isolated dissection and reject PCAPNG decryption secrets blocks. | Use a personal or task-specific profile in the normal local Desktop installation for custom settings and authorized decryption. | The synthetic secrets block is refused before TShark reads the capture. Profile editing and key-based decoding are documented manual steps and remain pending. |
| [Local live, multiple interfaces and monitor mode](https://www.wireshark.org/docs/wsug_html_chunked/ChCapCaptureOptions.html) | The separate Dumpcap plugin exposes typed bounded acquisitions with one explicit interface per approved start. | Capture → Options handles native interface selection and PCAPNG output. Windows needs Npcap for network capture and supported monitor-mode hardware and driver. Linux needs the appropriate Dumpcap privileges and a driver with monitor-mode support. | [#332](../.agentic/tasks/TASK-6ca805fc.md) has WSL2 loopback short and rolling evidence. Windows live, native Ubuntu, multi-interface and real monitor mode are pending. |
| [Live USB](https://wiki.wireshark.org/CaptureSetup/USB/) | Saved USB dissection uses TShark. | On Windows, select the controlled bus through installed USBPcap. On Linux, the usbmon kernel interface, bus device and suitable capture permissions are required. | Synthetic files establish dissection only. Controlled bus and device smoke tests remain pending. |
| [Extcap and remote capture](https://www.wireshark.org/docs/man-pages/extcap.html) | Typed local acquisition covers its verified local sources. | External capture sources have their own setup, access and credentials. Any approved use is configured in the native operator's environment. | No reviewed VERA integration or proof for remote/extcap sources. |
| [sharkd](https://www.wireshark.org/docs/man-pages/sharkd.html) | TShark remains the verified offline backend. | No Desktop dependency on sharkd for these workflows. | Native Windows standard-I/O performance experiment completed. See the decision below. |

## Native terminal evidence

Fixtures are generated independently from VERA by
[`tests/support/build_media.py`](../05_Software/tests/support/build_media.py).
Their frame layout is recorded in the [fixture inventory](../05_Software/tests/fixtures/wireshark-tshark/README.md).
Run Capinfos with `-T -t -E -c -H` to confirm format, link type, count and SHA-256.
On each fixture, run `tshark -n -r FILE -T fields -e frame.number -e frame.protocols`
and add the relevant native fields. For the unsignaled VoIP fixture, add
`-d udp.port==5004,rtp`. The independent stream comparison uses
`tshark -n -r FILE -d udp.port==5004,rtp -q -z rtp,streams`.

The native RTP tap reported three forward packets, one sequence gap and 45 ms
maximum interarrival delta. The reverse direction had two packets, zero gaps
and 22 ms maximum delta. VERA reports 0.3125 ms final jitter on the forward
stream under the labeled 8 kHz RTP/AVP default assumption. The native table
reports mean and maximum jitter, with its
forward maximum printed as 0.312 ms. VERA reports the reverse dynamic clock as
unavailable. VERA's jitter is the final successive estimate defined by
RFC 3550. It uses the default clock only on unsignaled Decode As streams with
a consistent payload type of 0 or 8 and eligible timings. The signaled
fixture rebinds payload type 0 to 16 kHz. VERA leaves jitter unavailable there
and keeps packet counts, sequence coverage and capture-arrival delta.
[RFC 3550 §6.4.1](https://datatracker.ietf.org/doc/html/rfc3550#section-6.4.1) and
[RFC 3551 §3](https://datatracker.ietf.org/doc/html/rfc3551#section-3).

Sequence gaps describe the observed span, and arrival delta uses capture
timestamps. Filtered or incomplete scans, unidentified RTP, and packet
truncation anywhere in the selected scope suppress full-scope statistics.
In the clipped fixture, frame 3 has only the UDP header and still counts as
truncated. Packet counts alone establish neither network loss nor audio quality.

The native replay test exercises the read-only VERA tool, assistant citations and
the #334 handoff preparation. It verifies the copied bytes and exact frame,
display filter and Decode As arguments using TShark. It exercises both missing
signaling and native SDP, and empty, clipped and filtered observations. A
capture with no decoded RTP still needs usable signaling or a verified Decode
As port before drawing conclusions about its media. VERA
projects up to 12 packet rows and six RTP streams, with omitted counts. Private
locators remain in the workbench. Shell and replay receipts for this checkout
are in `05_Software/test-outputs/403/windows-native.log`,
`windows-native-variants.log`, `windows-native-review.log` and
`win32-media-replay.json`. The replay prepares
launch arguments in the terminal. The existing [#334 Windows proof](../.agentic/tasks/TASK-41c72419.md)
establishes native opening and selection for saved and derived frames.

## Local Desktop procedures

1. Select **Open in Wireshark** on the cited frame. Confirm the selected frame
   number and display filter. Use the Wireless, Statistics or Telephony
   menus in the matrix for the relevant view. The temporary VERA viewer
   uses an isolated configuration.
2. For profile or decryption work, start the regular Desktop installation,
   choose a task-specific local profile in **Edit → Configuration Profiles**,
   and open the authorized original or local copy through **File → Open**.
   Use **Go → Go to Packet** with the cited frame number. A derived capture
   needs its own file and frame numbering. For RTP without signaling, use
   **Analyze → Decode As** on the known UDP port if needed.
3. For authorized WLAN decryption, use **Edit → Preferences → Protocols →
   IEEE 802.11**, enable decryption and add the operator-supplied material
   through **Decryption Keys**. The native dissector requires the applicable
   key type and handshake or session material for the capture. Keep keys,
   personal profiles, decoded payload and any audio on the analysis host.
   Avoid VERA chat, command arguments, shared profiles and exported reports
   for this material. [WLAN key requirements](https://www.wireshark.org/docs/wsug_html_chunked/Ch80211Keys.html).

## Extending a profile

Start with an independent saved fixture and the installed TShark field catalog.
Verify the actual native protocol stack, fields and encapsulation using `-r`
and `-T fields`. Use numeric or other explicitly bounded metadata fields in a
typed projection. Give any dissector-specific overrides a finite input shape
and verify missing fields, empty matches, incomplete scans and exact citations.
Test synthetic markers to verify that payload and identifiers stay local.
Keep specialized visualization and native preferences in the Desktop procedure.

## Repeat-query cost and sharkd decision

On native Windows 11 with TShark and sharkd 4.6.10, a synthetic 40,000-frame
PCAPNG (24,000,048 bytes, SHA-256
`d8cfb6e4796cf48b081ad0dfc1dcfba9754745f6b7397a57794eb928a5610bf0`)
was queried 12 times for different exact frame numbers. The generator's
`--benchmark` option reproduces the trace. Each standalone TShark command
read the same file with a frame-number display filter and returned just the
matching number. Each sharkd batch used one local process in console mode,
one `load`, the same filters via `frames` and a `bye`. Every returned frame
was checked. The test warmed both executables, ran three batches per backend
with alternating order, and used a private configuration and wall-clock
timings. Batch times include TShark process startup per call or sharkd startup
and load once. They exclude OS cold-cache loading and VERA overhead.

| Windows backend | Median batch of 12 | Per-run median lookup range | Startup and load |
|---|---:|---:|---:|
| TShark per lookup | 18.12 s | 1.10–1.45 s | Included per lookup |
| sharkd standard I/O | 11.05 s | 0.816–0.819 s | 0.776–0.787 s per batch |

This workload measured an approximately 39% reduction in batch time.
Keep TShark as the product backend. The experiment covers a synthetic
lookup batch on one machine. Adoption requires a representative latency
budget and equivalent reviewed controls for file confinement and fresh capture
identity, plugin revocation, cancellation, worker ownership and isolation,
request/response size, and private data projection. The standard-I/O prototype
opened no socket. Original method, samples and assertions are in
`05_Software/test-outputs/403/measure_media_queries.py` and `benchmark-windows.json`.
[sharkd manual](https://www.wireshark.org/docs/man-pages/sharkd.html).

## Final verification

- On native Ubuntu, run the saved-fixture profiles and handoff with the installed
  TShark and Desktop versions, then run the planned full suites on both platforms.
- On authorized controlled adapters, record hardware, driver, OS, capture
  inventories and permissions. Prove multi-interface capture with traffic and
  preserved PCAPNG interface IDs from both sources. For monitor mode, verify raw
  802.11 management frames and radio metadata on an adapter that advertises the
  mode. For USB, verify a transfer on a selected controlled device and bus.
- Exercise the named Desktop views, local profile and decryption steps with
  authorized synthetic material, and actual RTP Player output with a known
  supported codec and an audio sample. Track each result separately from
  the saved-frame handoff.

# Official plugins: CAN, network capture and bus transactions

## Routing

Select for `can-python` (program `can`, a PEP 723 python-can script: list, listen-only capture, send, replay; skills
can-capture and can-transmit); `can-dbc` (pip cantools plus the `can-decode` script; skill can-decode);
`wireshark-tshark` (typed offline capture evidence, generic program risk classification, and bounded
live capture through the user's TShark); and `bus-tools` (program `bus-tool`, a pinned flatbuffers/pyserial PEP 723 script:
bounded I2C, SPI and UART transactions through a Bus Pirate 5/6 in BPIO2 mode declared in `lab/resources.json`, with
devices, capabilities, identify, configure-bus, read-register, transfer, capture, release and report; skills
bus-transactions and bus-profiles).

For bus-tools, start at plugins/bus-tools/plugin.yaml, scripts/bus_tool.py and scripts/bus_support/ (cli.py dispatch
and argument limits, registry.py bus-adapter entries, profile.py bus profiles, ports.py identity keys, adapter.py the
binary-port link, bpio.py FlatBuffers slots, cobs.py, operations.py the operation flow and final state, lifecycle.py,
report.py) with spec .agentic/specs/REQ-DATA-634d35da.md; tests/plugins/bus-tools.test.ts and
tests/fixtures/bus-tools/fake-serial (a simulated Bus Pirate 5 in BPIO2 mode with I2C, SPI and UART targets - offline
evidence only) own its coverage. Its workspace.py is a byte-identical copy of circuitpython-tool's; its reservation and
cleanup are platform behaviour, see [Plugin bench resources](plugins-bench-resources.md).

The conventions shared by all official plugins (package format, catalog source, packs, versions and evidence
levels) and the page of every other plugin are in [Official plugins](official-plugins.md). The platform that
installs, classifies, approves and runs these programs is [Plugins](plugins.md); plugin skill discovery is
[Skills](skills.md).

## Purpose and boundaries

These plugins provide capture and device evidence for embedded work. The typed Wireshark
operations read verified saved files using externally installed TShark. Generic capture and
device commands follow their own program risk and approval rules.

## Public interface

- `can-python` 0.2.0, ecosystem `can` (CAN pack, Bus capture and transmit, default on), Windows x64/Linux x64:
  program `can` = `scripts/can_bus.py` on `python-can[serial,gs-usb,pcan,multicast]==4.6.1` (imports python-can
  lazily, so `--version` needs no dependency), timeout 300 s. `can list` prints `{configs, drivers}`:
  detected configs for pcan/vector/kvaser/slcan/gs_usb/socketcan and per-backend driver availability
  (ctypes library lookup, pyserial, libusb backend, Linux) with install hints; no bus opens. `capture`
  requires `--duration` or `--max-messages`, writes `.asc`/`.blf`/`.log` through `can.Logger` (text formats
  flushed per frame) or prints candump-style lines, and ends with `[can] N frames ... (mode) ..., stopped by
  duration|max-messages` on stderr. `send` (hex ID/data, extended, FD/BRS, count/period) and `replay`
  (`can.MessageSync` timing, `--ignore-timestamps`, `--max-messages`). Exit 0 done, 2 usage or refused capture
  before any bus opens, 3 open/IO failure with the backend hint. The first argument must be a command (a
  leading `--` would reach a subcommand on CPython 3.12+); every Bus gets `ignore_config=True` and digit-only
  channels are passed as integers (ignore_config skips python-can's casting); pcan, kvaser and gs_usb need --bitrate; the capture output must be new (removed again if the bus never opened); FD payloads use
  canonical lengths and --brs needs --fd; replay stops right after --max-messages. Rules: list/help/version
  safe, capture device-read, capture `--active` device-write, send/replay irreversible (confirm word =
  subcommand), backstop `can * {send,replay} *` irreversible.
- `can-dbc` 0.3.0, ecosystem `can` (DBC decoding, default on): pip `cantools>=45,<46` (version probe range
  `>=45,<46`; dump/list/convert/generate_c_source safe; decode/plot blocked because they read stdin, monitor
  blocked as an interactive view) and `can-decode` = `scripts/can_decode.py` on cantools 45.1.2 + python-can
  4.6.1: `--dbc --input [--id]... [--limit] [--no-choices] [--no-strict]`, one `time id message sig=value unit`
  line per decoded frame and a decoded/errors/unknown-ID summary; exit 2 for unreadable inputs; safe.
  Opt-in VERA_CAN_UV acceptance captures, transmits after typed words and decodes on udp_multicast; real
  adapters and Linux vcan0 remain unverified. Optional can-utils is not shipped.

- `wireshark-tshark` 0.6.0, ecosystem `wireshark` (own Wireshark pack, Capture analysis group, default
  on), Windows x64/Linux x64: find-only `tshark` (Windows `%PATH%` then `%ProgramFiles%/Wireshark/tshark.exe`;
  Linux `$PATH` then `/usr/bin/tshark`), never downloaded; missing shows the Wireshark/distribution hint with
  its download link. `--version` probe without a range (rules measured on 4.6.8), timeout 300 s.
  `optionSyntax: tshark` projects role tokens: `<info>` (-h/-v/-D/--list-sources, -G reports) and `<file>` (-r)
  safe; `<capture>` (-i/--source/-I/-L/--list-time-stamp-types, or neither -r nor info) device-read; `<unknown>`
  (unrecognised or ambiguous) device-write; `<write>` (-w to a file, --export-objects,
  --export-tls-session-keys, --log-file) device-read;
  `<execute>` (-X lua_script*) and `<credentials>` (-A) blocked. Skills wireshark-analyze (overview,
  filters, field export, statistics, frame citations) and wireshark-capture (tshark -D, confirmed interface,
  capture filter, -a duration or -c bound, saved .pcapng). Windows replay uses the real TShark and the
  generated sample; the opt-in VERA_TSHARK_LIVE_INTERFACE test captures self-sent loopback datagrams after
  approval on Windows/Npcap. Native Linux live capture remains unverified. `-o extcap.*` credential values are not refused.

- The verified enabled official package enables `wireshark_capture` (read) and `wireshark_import`
  (session) in ordinary Desktop and CLI sessions. The typed read tool offers discovery, validation,
  inspection, queries, frame details and reference verification. Reference verification uses the
  stored bytes independently of externally discovered TShark. The capture contract includes
  SHA-256, frame number, available interface and timestamp, version, profile, filter and coverage.
  Query rows and frame details carry opaque frame refs for assistant citations. Desktop reopens a
  cited source or managed file through its owner, checks the exact bytes and packet in a private
  snapshot, then starts the installed Wireshark Desktop with the file's own frame number. It preserves
  applicable display filters and visibly adds the frame when a filter would hide it. Desktop removes
  completed or failed private viewer profiles, and reclaims orphaned profiles on startup after both
  associated processes have exited.

- The typed tool also returns measured protocol stacks, directional endpoints and conversations,
  interval counts and rates, expert codes, TCP and checksum observations, DNS/HTTP response timing,
  and TCP/UDP follow metadata. The scope carries saved observation interfaces, filter, time window,
  applicable native preferences and completeness. Follow returns counts and frame evidence from
  the native tap in stream order. The verified local capture holds exact payload for Wireshark Desktop.

- The typed `automotive` operation profiles saved DoIP, SOME/IP and SOME/IP-SD. Native
  ordered protocol nodes provide per-PDU header and SD entry metadata, payload lengths and
  frame/field locators. The projection keeps directional transport conversations, VLAN order,
  capture observations, and verified contributor citations for upstream TCP and SOME/IP-TP.
  Capture gaps, unsupported or ambiguous input and incomplete reassembly remain visible in coverage.

- The typed `network` operation applies finite Ethernet/VLAN, IPv4/IPv6, ARP/ND, DNS/DHCP,
  TCP/UDP, multicast and visible TLS field profiles to saved captures. Exchange rows expose
  message roles and corroborated native DNS frame links. Conversation rows count directions
  by native stream within a capture section, interface and VLAN stack. TCP symptoms are
  capture observations. Shared evidence reports scope, packet drops, truncation, reassembly
  and opaque TLS. Cooked VLAN tags, tunneled transport ambiguity and fragments remain visible.
  Reassembled rows can cite related same-context frames outside the filter and withhold
  higher-layer fields when contributor context is unverified. Compact evidence masks network
  identifiers. The native reader rejects captures containing embedded decryption secrets.

- `bus-tools` 0.1.0, ecosystem `lab` (Arduino pack, group "Bus transactions (I2C, SPI, UART)", default on; activities
  `testing`, `debug`, `communication`), Windows x64 and Linux x64. Program `bus-tool` = `scripts/bus_tool.py` (PEP 723,
  `flatbuffers==25.12.19`, `pyserial==3.5`), timeout 120 s, env `BUS_REGISTRY=${workbench}/lab/resources.json`,
  `resources {option: --adapter, kinds: [bus-adapter], grace: 5, cleanup: [release], cleanupTimeout: 30}`. Risks:
  `devices`, `capabilities`, `report` safe; `identify` device-read; `configure-bus`, `read-register`, `transfer`,
  `capture` (120 s), `release` device-write; any call with `--power` irreversible. Backend `bus-pirate-bpio2` only:
  StatusResponse hardware major 5 or 6 and FlatBuffers major 2 (`adapter-unsupported`; a packet-level error too); a port
  that answers no valid COBS/BPIO2 status in 2 s is `not-bpio2`. Order per adapter call: registry (hash
  `registry-changed`, alias `adapter-unknown`), profile (`profile-invalid`: format 1, commonGround true, logicMv
  1200-5000, I2C 1 kHz-1 MHz, SPI 10 kHz-20 MHz, UART 300-1 000 000 baud, I2C addresses 0x08-0x77, registers <=4 bytes
  written and 1-64 read, limits <=512 bytes and <=10 s), request (`register-unknown`, `clears-flags`,
  `transfer-not-allowed`, `limit`, `power-not-allowed`, `capture-mode`), VERA's unknown marker (`state-unknown` except
  identify/release), both ports by identity (`port-missing`, `identity-mismatch`), then only the binary port is opened.
  Wire: COBS frames ending in 0x00; RequestPacket version 2, minimum minor 0; one status, one configuration (mode
  I2C/SPI/UART, ModeConfiguration fields, pull-ups, psu_enable with mV/mA only for `power.source: adapter` + `--power`
  within the registry's `power`, else psu_disable), one status read-back (`config-error`, `config-mismatch`), byte limits
  also from the adapter's mode_max_write/read (`limit`), one DataRequest (I2C: address<<1 first, start/stop; SPI:
  start/stop as chip select; UART unframed); async DataResponses are kept apart for capture. Data errors: text naming
  NACK `nack`, else `adapter-error`; `count-mismatch`; `unexpected-value` names SPI mode, wiring and logic voltage;
  `no-response` (incomplete); serial failure `disconnected` (nothing more sent, physical unknown). Nothing is repeated.
  Final state after configure-bus failures and every read-register, transfer and capture: `release` (HiZ, pull-ups and
  supply off) or `keep`, read back -> `final.physical` confirmed/unknown; configure-bus leaves `configured`. Stop file
  checked before configuration, data and during capture (`stopped`, release applied). Results
  `arduino-iot-results/<run-id>/` (`bus-tool-result`, `report.md`, capture.bin and capture.csv); exit 0/1/2/3.
  Evidence: the simulated adapter only; no real Bus Pirate yet (NACK text, UART async receive and per-mode limits
  unconfirmed).

## Invariants

- can capture never opens a physical adapter actively by default: listen-only kwargs (pcan
  `state=PASSIVE`, vector/slcan `listen_only`, kvaser `driver_mode=False`), software buses
  (virtual, udp_multicast, socketcan `vcan*`) or a SocketCAN link that `ip -json -details` reports LISTEN-ONLY;
  everything else needs `--active`. The scripts are not named can.py/cantools.py so they never shadow packages.

- tshark parsing follows TShark: case-sensitive letters with the measured value letters, grouped flags,
  attached or separate values, exact-or-unique long abbreviations (ambiguous is `<unknown>`), and the end of
  options at the first non-option or `--`. Arguments after that end are still read for raising roles
  (capture, write, execute, credentials), never for `<info>` or `<file>`, so filter text cannot lower risk. A
  command that writes an output file asks like a capture; `-w -` stays safe. Generic runs use the
  user's Wireshark profile and its extensions.

- The typed host isolates personal configuration and plugin/extension directories, disables name
  resolution, and restricts output to selected fields and Decode As to TCP/UDP port selectors.
  Filters use protocol presence or comparisons on offline fields with numeric addresses.
  Packet field values are untrusted. Agent masking preserves structured coverage and pagination.
- Typed operations snapshot ordinary confined files. Query cursors bind the exact file, tool
  version, profile, filter, fields and query bounds. Coverage describes the scan and the remaining
  matching range after the cursor. Limits are 64 MiB per capture, 50,000 scan frames, 50 rows per
  page and a 30-second deadline. Import requires full validation and verified same-directory
  staging, with 32 files and 256 MiB per workbench.
- Traffic cursors bind the selection, filter, window, dissection preferences, capture and page size.
  The host bounds aggregate groups, intervals, native field and follow text, and returned evidence.
  TShark follows the scanned prefix and VERA selects records by source frame. TCP loss and checksum
  markers are observations at saved capture points. Expert messages and stream payload stay local.
- Automotive Ethernet cursors bind the profile, declared selectors, native version/preferences,
  capture and page bounds. The parser retains numeric fields and native node references only.
  Unreported drop counts and timestamp synchronization remain unknown.

- bus-tool opens only the registry entry's binary port, sends each BPIO2 request once, never writes a bootloader, reset,
  self-test, pin-mask, LED or terminal-text field, never scans addresses and switches the adapter's supply on only with
  `--power` within the registry's limits.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| CAN commands, listen-only map, driver hints | `plugins/can-python/scripts/can_bus.py`, `plugin.yaml` | `can.test.ts` matrix, fake python-can script cases, gate; `VERA_CAN_UV` real udp_multicast acceptance |
| DBC decoding or cantools rules | `plugins/can-dbc/` | `can.test.ts`; fixtures `tests/fixtures/can/` |
| tshark roles, rules, find list or skills | `plugins/wireshark-tshark/`, `shared/src/tshark-options.ts` | `wireshark-tshark.test.ts` (matrix, fake find roots, real-TShark replay; skips without tshark) |
| Typed capture evidence and managed files | `shared/src/wireshark.ts`, `core/src/wireshark/` | Typed replay in `wireshark-tshark.test.ts`, storage boundary tests in `core/src/wireshark/storage.test.ts` |
| Traffic statistics, Expert Info and followed streams | `shared/src/wireshark-traffic.ts`, `core/src/wireshark/traffic-analysis.ts` | Native statistics and tap reconciliation in `wireshark-tshark.test.ts`, native output rejection in `traffic-native.test.ts` |
| Automotive Ethernet profiles | `shared/src/wireshark-automotive.ts`, `core/src/wireshark/automotive*.ts` | Windows or Linux offline replay in `wireshark-tshark.test.ts`, native output boundary in `automotive-native.test.ts` |
| General networking profiles | `shared/src/wireshark-networking.ts`, `core/src/wireshark/network-*.ts` | Networking replay in `wireshark-tshark.test.ts` and native diagnostics in `traffic-native.test.ts` |
| A new TShark release | re-measure option arity with `tshark -r <file> -<letter>`, then `tshark-options.ts` | "classifies parsed tshark option roles" |

## Key behaviors

- `REQ-FUNC-ed24ef4a` / `REQ-REL-07f029dd` — can list with driver hints; open failure exit 3 with the hint.
- `REQ-SEC-2eb33af8` / `REQ-SEC-9be4b959` — CAN and cantools risk rules.
- `REQ-FUNC-cd61ecee` / `REQ-REL-35df942b` / `REQ-FUNC-4adc847a` / `REQ-FUNC-835a17ea` — listen-only capture, --active refusal, send, replay.
- `REQ-REL-292d1dd5` / `REQ-REL-5edff0c2` — can usage errors exit 2 before any bus; unreadable can-decode inputs exit 2.
- `REQ-FUNC-7951af72` / `REQ-UX-c9e6cb02` / `REQ-TEST-c20cfbb9` — can-decode, three skills, opt-in multicast acceptance.
- `REQ-PLAT-e0466566` — real adapter and Linux vcan0 acceptance (pending hardware/host).

- `REQ-FUNC-3a49793a` / `REQ-REL-0cc3c9ba` — find-only TShark discovery with version, missing hint and no download.
- `REQ-SEC-3fa7a69c` / `REQ-SEC-4e0621b6` — tshark option-role risk; Lua scripts and -A credentials blocked.
- `REQ-UX-c68ec8b8` / `REQ-TEST-1fbadc3c` — analysis/capture skills; real-TShark replay of the sample capture.
- `REQ-PLAT-0b1587fd` — approved bounded live capture (opt-in loopback test; Windows run, Linux pending).
- `REQ-PLAT-c2323ad5` — capture-file analysis on Linux x64 (manual, pending a Linux host with tshark).
- `REQ-FUNC-610a4011`–`REQ-FUNC-610a4014`, `REQ-SEC-610a4015`, `REQ-DATA-610a4016` and
  `REQ-REL-610a4017`–`REQ-REL-610a4018` — typed capture evidence, managed storage and limits.
- `REQ-FUNC-610a4021`–`REQ-FUNC-610a4026`, `REQ-SEC-610a4027`, `REQ-REL-610a4028`–`REQ-REL-610a4029`
  cover traffic statistics, diagnostics, timing, follow, local payload and bounds.
- `REQ-FUNC-1610ba78`, `REQ-FUNC-56598fdc`, `REQ-REL-dd6f4b62`, `REQ-REL-1835b16c` —
  offline Automotive Ethernet profiles, PDU evidence, coverage and native diagnostics.
- `REQ-FUNC-3cdfc800`, `REQ-DATA-fe4b7a36`, `REQ-REL-fe778b38`, `REQ-REL-baf79e3d` and
  `REQ-SEC-22b9e089` govern the general networking profiles, framed evidence and native limits.

## Files

- `05_Software/plugins/can-python/` — manifest, README (drivers, listen-only), `scripts/can_bus.py`, skills can-capture and can-transmit.
- `05_Software/plugins/can-dbc/` — manifest, README, `scripts/can_decode.py`, skill can-decode.
- `05_Software/tests/plugins/can.test.ts`, `tests/fixtures/can/` — rules, stdlib fake python-can (`fake-python-can/can`, records Bus kwargs and frames), typed gate with a fake uv, fictional DBC and candump log, opt-in real acceptance.

- `05_Software/plugins/wireshark-tshark/` — manifest, README (risk table, capture setup, limits) and two skills.
- `05_Software/src/libraries/shared/src/tshark-options.ts` — tshark role projection for rules only.
- `05_Software/src/libraries/shared/src/wireshark.ts`, `wireshark-traffic.ts`, `wireshark-automotive.ts` —
  typed inputs, capture and frame evidence.
- `05_Software/src/libraries/core/src/wireshark/` — native dissection, reference verification,
  managed storage and model result masking.
- `05_Software/tests/plugins/wireshark-tshark.test.ts`, `tests/fixtures/wireshark-tshark/` — risk matrix,
  find/hint with a fake host, generated CoAP/Modbus, traffic/diagnostic and Automotive Ethernet
  captures and native TShark replay. The Automotive Ethernet fixture generator is under `tests/support/`.

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

## Installation

VERA uses the user's TShark and never downloads it. On Windows it searches
PATH, then `%ProgramFiles%\Wireshark\tshark.exe`, where the Wireshark
installer places it. On Linux it searches PATH, then `/usr/bin/tshark`
(`sudo apt install tshark` on Debian and Ubuntu). When none is found, the
Plugins page shows the program as missing with an install hint. The rules
were measured against the options of TShark 4.6.8.

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

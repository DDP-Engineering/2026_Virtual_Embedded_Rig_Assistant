# Wireshark (TShark)

Enable **Capture analysis** in the Wireshark pack. The plugin exposes
`tshark` through VERA's program tools with two skills: `wireshark-analyze`
for saved `.pcap`/`.pcapng` files and `wireshark-capture` for bounded live
captures.

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
| `-i`/`--source`, `-I`, `-L`, `--list-time-stamp-types`, or no `-r` at all (tshark then captures the first interface) | device-read |
| an option this plugin does not recognise | device-write |
| `-X lua_script…` (runs Lua code), `-A user:password` (RPCAP credentials) | blocked |

The plugin parses tshark's options the way tshark does: case-sensitive
letters (`-x` dumps bytes, `-X` sets extension options), grouped flags
(`-nr`), attached values (`-ifoo`), unique long-option abbreviations and the
end of options at the first filter word or `--`. A filter word never lowers
the risk of the options after it. Output files written by safe commands
(`-w`, `--export-objects`, `--log-file`) need no approval, like other
analysis outputs.

## Live capture

Live capture needs Npcap on Windows (offered by the Wireshark installer) or
dumpcap capture permissions on Linux: install `wireshark-common`, allow
non-root capture, add the user to the `wireshark` group and start a new login
session. VERA leaves both steps to the user.

## Limits

TShark loads the Lua and binary plugins of the user's own Wireshark profile
on every run, as Wireshark does; command-line rules cannot prevent that.
Extcap interfaces such as sshdump or `rpcap://` capture on other hosts and
are classified like any live capture. Only `-A` is refused as a credential:
extcap options passed with `-o extcap.<tool>.<option>:<value>` can also carry
passwords, so configure remote capture outside VERA.

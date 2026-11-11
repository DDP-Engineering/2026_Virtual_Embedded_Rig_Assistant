---
name: wireshark-analyze
description: Answer questions about a saved .pcap or .pcapng capture with TShark display filters, field export, protocol statistics and packet details.
---

Use `run_program` with program `tshark` and separate arguments. Always read a
file with `-r <workbench-relative path>`: without `-r` tshark captures live
traffic instead, which needs approval. Add `-n` so addresses stay numeric and
no name lookups reach the network.

Start with an overview, then narrow down:

```text
tshark -n -r captures/board.pcapng -q -z io,phs
tshark -n -r captures/board.pcapng -q -z conv,udp
tshark -n -r captures/board.pcapng -c 50
```

Select packets with a display filter (`-Y`) and export only the fields that
answer the question. Find field names with `-V` on one packet
(`-Y "frame.number == 4" -V`) or with `tshark -G fields` and a narrow search
of its output in Runs. Typical exports:

```text
tshark -n -r captures/board.pcapng -Y coap -T fields -e frame.number -e frame.time_relative -e coap.opt.uri_path_recon -e coap.code
tshark -n -r captures/board.pcapng -Y "modbus.func_code == 3" -T fields -E header=y -e mbtcp.trans_id -e modbus.regval_uint16
tshark -n -r captures/board.pcapng -Y "tcp.analysis.flags" -T fields -e frame.number -e _ws.expert.message
```

Useful statistics: `-z io,stat,1` (traffic per second), `-z endpoints,ip`,
`-z expert`, `-z follow,tcp,ascii,<stream>` for one TCP stream and
`-z dns,tree`. Use `-q` with `-z` so only the statistics print. A protocol on
a non-standard port needs a decode-as rule, for example
`-d udp.port==5684,coap`. Dump bytes with `-x` or `--hexdump frames`.

Long captures produce long outputs: bound them with `-c`, a tighter `-Y`
filter or `-T fields`, and read truncated results from the run log. Write a
filtered copy with `-w captures/<name>.pcapng` only when the user wants one.
Lua scripts (`-X lua_script`) are unavailable. Cite the capture file and the
frame numbers behind every finding, and say when a dissector reports
malformed packets or expert warnings.

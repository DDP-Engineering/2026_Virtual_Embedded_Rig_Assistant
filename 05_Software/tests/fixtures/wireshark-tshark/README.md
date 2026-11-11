# wireshark-tshark fixture

`sample.pcapng` is a fictional capture written by `build.py` (deterministic; run
`python build.py` in this folder to recreate it). Eight Ethernet frames between a
host (192.168.7.1) and a board (192.168.7.10):

| Frames | Content |
|---|---|
| 1-2 | ARP request and reply |
| 3-4 | CoAP GET `/sensors/temp`, MID 4660, answered 2.05 Content `23.5` |
| 5-6 | Modbus/TCP transaction 1, Read Holding Registers 0-1, values 235 and 258 |
| 7-8 | CoAP GET `/sensors/humidity`, MID 4661, answered 2.05 Content `41` |

IPv4, UDP and TCP checksums are valid; TShark 4.6.8 reports no expert warnings.
`tests/integration/wireshark-tshark.test.ts` asks a replay session about it.

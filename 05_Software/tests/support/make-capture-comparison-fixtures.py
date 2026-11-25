"""Create deterministic saved captures with known offline comparison outcomes."""

import struct
import sys
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "wireshark-tshark"
sys.path.insert(0, str(FIXTURES))

from build import BOARD_IP, HOST_IP, START_US, block, checksum, frames, tcp, to_board, to_host, udp


def capture(
    changed: bool = False, variant: int = 0, unmatched: bool = False,
    shared_context: str | None = None, reported_drops: bool = False,
) -> bytes:
    anchor = frames()[0]
    records = [(0, anchor)]

    def send(
        ms: int, seq: int, ack: int, flags: int, body: bytes = b"",
        reverse: bool = False, port: int = 49000,
    ) -> None:
        client = 40100 if port == 49000 else 40102
        if reverse:
            segment = tcp(BOARD_IP, HOST_IP, port, client, seq, ack, body, flags)
            packet = to_host(6, segment, len(records) + 1)
        else:
            segment = tcp(HOST_IP, BOARD_IP, client, port, seq, ack, body, flags)
            packet = to_board(6, segment, len(records) + 1)
        records.append((ms, packet))

    client_seq = 1000 + variant
    server_seq = 2000 + variant
    send(10, client_seq, 0, 2)
    send(20, server_seq, client_seq + 1, 18, reverse=True)
    send(30, client_seq + 1, server_seq + 1, 16)
    send(40, client_seq + 1, server_seq + 1, 24, b"test")
    if changed:
        send(60, client_seq + 1, server_seq + 1, 24, b"test")
    send(80, server_seq + 1, client_seq + 5, 16, reverse=True)

    question = b"\x07example\x04test\0\x00\x01\x00\x01"
    for request, reply, transaction in [(100, 110, 80), (160, 200 if changed else 180, 81)]:
        identifier = transaction + variant
        query = struct.pack("!6H", identifier, 0x0100, 1, 0, 0, 0) + question
        answer = struct.pack("!6H", identifier, 0x8180, 1, 0, 0, 0) + question
        records.append((request, to_board(17, udp(HOST_IP, BOARD_IP, 40101, 53, query), identifier)))
        records.append((reply, to_host(17, udp(BOARD_IP, HOST_IP, 53, 40101, answer), identifier)))

    if unmatched:
        fragment = bytearray(to_board(17, b"fragment", 99))
        fragment[20:22] = struct.pack("!H", 1)
        fragment[24:26] = b"\0\0"
        fragment[24:26] = struct.pack("!H", checksum(fragment[14:34]))
        records.append((230, bytes(fragment)))
    other_port = 49302 if changed else 49301
    records.append((250, to_board(17, udp(HOST_IP, BOARD_IP, other_port, 49300, b"pair"), 100)))

    request_data = b"GET /test HTTP/1.1\r\nHost: example.test\r\n\r\n"
    reply_data = b"HTTP/1.1 204 No Content\r\n\r\n"
    for index, request in enumerate((280, 380)):
        req_seq = client_seq + index * len(request_data)
        res_seq = server_seq + index * len(reply_data)
        send(request, req_seq, res_seq, 24, request_data, port=80)
        reply = request + (40 if changed else 10) + index * 10
        send(reply, res_seq, req_seq + len(request_data), 24, reply_data, reverse=True, port=80)

    records.append((500, anchor))
    section = block(0x0A0D0D0A, struct.pack("<IHHq", 0x1A2B3C4D, 1, 0, -1))
    interface = block(1, struct.pack("<HHI", 1, 0, 65535))
    located = [(ms, 0, packet) for ms, packet in records]
    if shared_context is not None:
        _, _, data_packet = located[4]
        if shared_context == "vlan":
            copy = data_packet[:12] + b"\x81\x00\x00\x2a" + data_packet[12:]
            located.insert(4, (35, 0, copy))
        else:
            located.insert(4, (35, 1, data_packet))
    packets = []
    for ms, point, packet in located:
        stamp = START_US + variant * 1_000_000 + ms * 1000
        body = struct.pack("<IIIII", point, stamp >> 32, stamp & 0xFFFFFFFF, len(packet), len(packet))
        packets.append(block(6, body + packet))
    if reported_drops:
        body = struct.pack("<III", 0, stamp >> 32, stamp & 0xFFFFFFFF)
        body += struct.pack("<HHQHHQHH", 5, 8, 9, 7, 8, 2, 0, 0)
        packets.append(block(5, body))
    return section + interface * (2 if shared_context == "interface" else 1) + b"".join(packets)


if __name__ == "__main__":
    for name, data in {
        "baseline": capture(),
        "changed": capture(changed=True, variant=5),
        "equivalent": capture(variant=7),
        "unmatched": capture(changed=True, variant=9, unmatched=True),
        "cross-interface": capture(shared_context="interface"),
        "cross-vlan": capture(shared_context="vlan"),
        "interface-drops": capture(reported_drops=True),
    }.items():
        (FIXTURES / f"comparison-{name}.pcapng").write_bytes(data)

"""Build the offline Automotive Ethernet test capture using Python's wire encoders."""

import struct
import sys
from importlib import import_module
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "wireshark-tshark"
sys.path.insert(0, str(FIXTURES))
wire = import_module("build")


def doip(kind: int, body: bytes) -> bytes:
    return struct.pack("!BBHI", 2, 0xFD, kind, len(body)) + body


def someip(service: int, method: int, session: int, kind: int, body: bytes) -> bytes:
    return struct.pack("!HHIHHBBBB", service, method, 8 + len(body), 9, session, 1, 2, kind, 0) + body


def sd_entry(kind: int, service: int, ttl: int, version: int) -> bytes:
    return struct.pack("!BBBBHHB", kind, 0, 0, 0, service, 2, 3) + ttl.to_bytes(3, "big") + struct.pack("!I", version)


def saved_traffic() -> bytes:
    records: list[tuple[int, bytes, int]] = []

    def add(protocol: int, payload: bytes, reverse: bool = False, point: int = 0,
            tags: tuple[int, ...] = (42,), missing: int = 0) -> None:
        src, dst = (wire.BOARD_IP, wire.HOST_IP) if reverse else (wire.HOST_IP, wire.BOARD_IP)
        src_mac, dst_mac = (wire.BOARD_MAC, wire.HOST_MAC) if reverse else (wire.HOST_MAC, wire.BOARD_MAC)
        network = wire.ipv4(src, dst, protocol, len(records) + 1, payload)
        ether_type = 0x0800
        for vlan in reversed(tags):
            network = struct.pack("!HH", vlan, ether_type) + network
            ether_type = 0x8100
        if len(tags) > 1:
            ether_type = 0x88A8
        frame = wire.ethernet(src_mac, dst_mac, ether_type, network)
        records.append((point, frame, len(frame) - missing))

    diagnostic = doip(0x8001, struct.pack("!HH", 0x0E00, 0x1001) + b"VERA_DOIP_LOCAL")
    ack = doip(0x8002, struct.pack("!HHB", 0x1001, 0x0E00, 0))
    nack = doip(0x8003, struct.pack("!HHB", 0x1001, 0x0E00, 3))
    add(6, wire.tcp(wire.HOST_IP, wire.BOARD_IP, 40000, 13400, 100, 200, diagnostic[:12]))
    add(6, wire.tcp(wire.HOST_IP, wire.BOARD_IP, 40000, 13400, 112, 200, diagnostic[12:] + doip(7, b"")))
    add(6, wire.tcp(wire.BOARD_IP, wire.HOST_IP, 13400, 40000, 200, 100 + len(diagnostic) + 8, ack + nack), True)
    add(17, wire.udp(wire.HOST_IP, wire.BOARD_IP, 41000, 13400, doip(1, b"")), point=1, tags=(7, 42))
    add(6, wire.tcp(wire.HOST_IP, wire.BOARD_IP, 40001, 13400, 300, 400, diagnostic[:12]))
    add(17, wire.udp(wire.HOST_IP, wire.BOARD_IP, 42000, 30501, someip(0x1234, 2, 5, 0x20, b"\0\0\0\1" + b"A" * 16)))
    add(17, wire.udp(wire.HOST_IP, wire.BOARD_IP, 42000, 30501, someip(0x1234, 2, 5, 0x20, b"\0\0\0\x10" + b"tail")))
    add(17, wire.udp(wire.HOST_IP, wire.BOARD_IP, 42000, 30501, someip(0x1234, 3, 6, 0x20, b"\0\0\0\1" + b"B" * 16)))
    entry_bytes = sd_entry(0, 0x1234, 5, 1) + sd_entry(1, 0x1235, 0, 2)
    sd = b"\x40\0\0\0" + struct.pack("!I", len(entry_bytes)) + entry_bytes + b"\0\0\0\0"
    add(17, wire.udp(wire.HOST_IP, wire.BOARD_IP, 30490, 30490, someip(0xFFFF, 0x8100, 7, 2, sd)), point=1)
    add(17, wire.udp(wire.HOST_IP, wire.BOARD_IP, 41000, 13400, doip(1, b"")), missing=4)

    main = wire.pcapng(records, 2)
    # Add packet observation direction and drop count to frame 1.
    headers = 68
    first_bytes = records[0][1]
    first_block_length = 32 + ((len(first_bytes) + 3) // 4) * 4
    flags = struct.pack("<HHI", 2, 4, 1)
    drops = struct.pack("<HHQ", 4, 8, 2)
    start = headers + 8
    end = headers + first_block_length - 4
    main = main[:headers] + wire.block(6, main[start:end] + flags + drops + b"\0" * 4) + main[end + 4:]

    raw_section = main[:28] + wire.block(1, struct.pack("<HHI", 101, 0, 65535))
    raw_packet = wire.ipv4(wire.HOST_IP, wire.BOARD_IP, 17, 1, wire.udp(wire.HOST_IP, wire.BOARD_IP, 41000, 13400, doip(1, b"")))
    return main + raw_section + wire.block(3, struct.pack("<I", len(raw_packet)) + raw_packet)


def coverage_traffic() -> bytes:
    diagnostic = doip(0x8001, struct.pack("!HH", 0x0E00, 0x1001) + b"coverage")
    payload = doip(7, b"") + diagnostic[:12]
    segment = wire.tcp(wire.HOST_IP, wire.BOARD_IP, 40000, 13400, 100, 200, payload)
    complete_with_suffix = wire.to_board(6, segment, 1)
    ip = wire.ipv4(wire.HOST_IP, wire.BOARD_IP, 17, 2, b"middle-fragment")
    header = ip[:6] + struct.pack("!H", 1) + ip[8:10] + b"\0\0" + ip[12:20]
    fragment_ip = header[:10] + struct.pack("!H", wire.checksum(header)) + ip[12:]
    fragment = wire.ethernet(wire.HOST_MAC, wire.BOARD_MAC, 0x0800, fragment_ip)
    return wire.pcapng([(0, frame, len(frame)) for frame in (complete_with_suffix, fragment)], 1)


def mixed_vlan_traffic() -> bytes:
    diagnostic = doip(0x8001, struct.pack("!HH", 0x0E00, 0x1001) + b"capture")
    records: list[tuple[int, bytes, int]] = []

    def add_frame(vlan: int, frame: bytes) -> None:
        tagged = frame[:12] + struct.pack("!HH", 0x8100, vlan) + frame[12:]
        records.append((0, tagged, len(tagged)))

    for vlan, seq, payload in ((42, 100, diagnostic[:12]), (43, 112, diagnostic[12:])):
        segment = wire.tcp(wire.HOST_IP, wire.BOARD_IP, 40000, 13400, seq, 200, payload)
        add_frame(vlan, wire.to_board(6, segment, len(records) + 1))
    for vlan, payload in ((42, b"\0\0\0\1" + b"A" * 16), (43, b"\0\0\0\x10" + b"tail")):
        message = someip(0x1234, 2, 5, 0x20, payload)
        datagram = wire.udp(wire.HOST_IP, wire.BOARD_IP, 42000, 30501, message)
        add_frame(vlan, wire.to_board(17, datagram, len(records) + 1))
    return wire.pcapng(records, 1)


if __name__ == "__main__":
    (FIXTURES / "automotive.pcapng").write_bytes(saved_traffic())
    (FIXTURES / "automotive-coverage.pcapng").write_bytes(coverage_traffic())
    (FIXTURES / "automotive-mixed-vlan.pcapng").write_bytes(mixed_vlan_traffic())

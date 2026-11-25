"""Writes sample.pcapng: a fictional board (192.168.7.10) answering CoAP and Modbus/TCP reads.

Run from this folder with any Python 3: python build.py. The output is deterministic.
"""

import struct
from ipaddress import IPv6Address

BOARD_MAC = bytes.fromhex("020000000010")
HOST_MAC = bytes.fromhex("020000000001")
BOARD_IP = bytes([192, 168, 7, 10])
HOST_IP = bytes([192, 168, 7, 1])
START_US = 1767225600 * 1_000_000  # 2026-01-01T00:00:00Z


def checksum(data: bytes) -> int:
    if len(data) % 2:
        data += b"\0"
    total = sum(struct.unpack(f"!{len(data) // 2}H", data))
    while total >> 16:
        total = (total & 0xFFFF) + (total >> 16)
    return ~total & 0xFFFF


def ethernet(src: bytes, dst: bytes, kind: int, payload: bytes) -> bytes:
    return dst + src + struct.pack("!H", kind) + payload


def ipv4(src: bytes, dst: bytes, protocol: int, ident: int, payload: bytes) -> bytes:
    header = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + len(payload), ident, 0x4000, 64, protocol, 0, src, dst)
    return header[:10] + struct.pack("!H", checksum(header)) + header[12:] + payload


def pseudo(src: bytes, dst: bytes, protocol: int, length: int) -> bytes:
    return src + dst + struct.pack("!BBH", 0, protocol, length)


def udp(src: bytes, dst: bytes, sport: int, dport: int, payload: bytes) -> bytes:
    header = struct.pack("!HHHH", sport, dport, 8 + len(payload), 0)
    value = checksum(pseudo(src, dst, 17, 8 + len(payload)) + header + payload) or 0xFFFF
    return header[:6] + struct.pack("!H", value) + payload


def tcp(src: bytes, dst: bytes, sport: int, dport: int, seq: int, ack: int,
        payload: bytes, flags: int = 0x18, partial_checksum: bool = False) -> bytes:
    header = struct.pack("!HHIIBBHHH", sport, dport, seq, ack, 5 << 4, flags, 64240, 0, 0)
    prefix = pseudo(src, dst, 6, 20 + len(payload))
    value = checksum(prefix) ^ 0xFFFF if partial_checksum else checksum(prefix + header + payload)
    return header[:16] + struct.pack("!H", value) + header[18:] + payload


def arp(op: int, sender_mac: bytes, sender_ip: bytes, target_mac: bytes, target_ip: bytes) -> bytes:
    return struct.pack("!HHBBH", 1, 0x0800, 6, 4, op) + sender_mac + sender_ip + target_mac + target_ip


def coap_get(message_id: int, token: int, path: list[str]) -> bytes:
    options = b""
    delta = 11  # Uri-Path
    for segment in path:
        options += bytes([(delta << 4) | len(segment)]) + segment.encode()
        delta = 0
    return bytes([0x41, 0x01]) + struct.pack("!H", message_id) + bytes([token]) + options


def coap_content(message_id: int, token: int, text: str) -> bytes:
    # ACK 2.05 Content, Content-Format text/plain (option 12, empty value), payload marker.
    return bytes([0x61, 0x45]) + struct.pack("!H", message_id) + bytes([token, 0xC0, 0xFF]) + text.encode()


def modbus(transaction: int, pdu: bytes) -> bytes:
    return struct.pack("!HHHB", transaction, 0, len(pdu) + 1, 1) + pdu


def to_board(protocol: int, segment: bytes, ident: int) -> bytes:
    return ethernet(HOST_MAC, BOARD_MAC, 0x0800, ipv4(HOST_IP, BOARD_IP, protocol, ident, segment))


def to_host(protocol: int, segment: bytes, ident: int) -> bytes:
    return ethernet(BOARD_MAC, HOST_MAC, 0x0800, ipv4(BOARD_IP, HOST_IP, protocol, ident, segment))


def frames() -> list[bytes]:
    read_request = modbus(1, struct.pack("!BHH", 3, 0, 2))
    read_reply = modbus(1, struct.pack("!BBHH", 3, 4, 235, 258))
    return [
        ethernet(HOST_MAC, b"\xff" * 6, 0x0806, arp(1, HOST_MAC, HOST_IP, b"\0" * 6, BOARD_IP)),
        ethernet(BOARD_MAC, HOST_MAC, 0x0806, arp(2, BOARD_MAC, BOARD_IP, HOST_MAC, HOST_IP)),
        to_board(17, udp(HOST_IP, BOARD_IP, 40000, 5683, coap_get(0x1234, 0x71, ["sensors", "temp"])), 1),
        to_host(17, udp(BOARD_IP, HOST_IP, 5683, 40000, coap_content(0x1234, 0x71, "23.5")), 1),
        to_board(6, tcp(HOST_IP, BOARD_IP, 50200, 502, 1000, 5000, read_request), 2),
        to_host(6, tcp(BOARD_IP, HOST_IP, 502, 50200, 5000, 1000 + len(read_request), read_reply), 2),
        to_board(17, udp(HOST_IP, BOARD_IP, 40000, 5683, coap_get(0x1235, 0x72, ["sensors", "humidity"])), 3),
        to_host(17, udp(BOARD_IP, HOST_IP, 5683, 40000, coap_content(0x1235, 0x72, "41")), 3),
    ]


def block(kind: int, body: bytes) -> bytes:
    body += b"\0" * (-len(body) % 4)
    length = 12 + len(body)
    return struct.pack("<II", kind, length) + body + struct.pack("<I", length)


def pcapng(records: list[tuple[int, bytes, int]], interfaces: int, start_us: int = START_US) -> bytes:
    section = block(0x0A0D0D0A, struct.pack("<IHHq", 0x1A2B3C4D, 1, 0, -1))
    interface = block(1, struct.pack("<HHI", 1, 0, 65535))
    packets = b""
    for index, (point, frame, captured_length) in enumerate(records):
        stamp = start_us + index * 100_000
        header = struct.pack("<IIIII", point, stamp >> 32, stamp & 0xFFFFFFFF, captured_length, len(frame))
        packets += block(6, header + frame[:captured_length])
    return section + interface * interfaces + packets


def traffic_frames() -> list[tuple[int, bytes, int]]:
    records: list[tuple[int, bytes, int]] = []

    def add(frame: bytes, point: int = 0, captured: int | None = None) -> None:
        records.append((point, frame, captured if captured is not None else len(frame)))

    def client(seq: int, ack: int, flags: int, data: bytes = b"", partial: bool = False) -> bytes:
        return to_board(6, tcp(HOST_IP, BOARD_IP, 40100, 49000, seq, ack, data, flags, partial), len(records) + 1)

    def server(seq: int, ack: int, flags: int, data: bytes = b"") -> bytes:
        return to_host(6, tcp(BOARD_IP, HOST_IP, 49000, 40100, seq, ack, data, flags), len(records) + 1)

    marker = b"VERA_LOCAL_SENTINEL"
    start = 1001
    after_marker = start + len(marker)
    after_gap = after_marker + 5
    add(client(1000, 0, 0x02))
    add(server(2000, start, 0x12))
    add(client(start, 2001, 0x10))
    add(client(start, 2001, 0x18, marker))
    add(client(start, 2001, 0x18, marker))
    add(server(2001, after_marker, 0x10))
    add(client(after_gap, 2001, 0x18, b"rest"))
    add(server(2001, after_gap + 4, 0x10))
    add(server(2001, after_gap + 4, 0x18, b"snap-truncated"), captured=56)
    add(client(after_gap + 4, 2001, 0x10, partial=True))

    question = b"\x07example\x04test\0\x00\x01\x00\x01"
    query = struct.pack("!HHHHHH", 80, 0x0100, 1, 0, 0, 0) + question
    answer = struct.pack("!HHHHHH", 80, 0x8180, 1, 1, 0, 0) + question
    answer += b"\xc0\x0c\x00\x01\x00\x01\x00\x00\x00\x3c\x00\x04\xc0\x00\x02\x01"
    add(to_board(17, udp(HOST_IP, BOARD_IP, 40101, 53, query), 11), point=1)
    add(to_host(17, udp(BOARD_IP, HOST_IP, 53, 40101, answer), 12), point=1)
    broken_udp = bytearray(udp(HOST_IP, BOARD_IP, 40101, 53, b"\x00\x51" + query[2:]))
    broken_udp[6] ^= 0x01
    add(to_board(17, bytes(broken_udp), 13), point=1)

    http_request = b"GET /test HTTP/1.1\r\nHost: example.test\r\n\r\n"
    http_response = b"HTTP/1.1 204 No Content\r\n\r\n"
    add(to_board(6, tcp(HOST_IP, BOARD_IP, 40102, 80, 1, 1, http_request), 14), point=1)
    add(to_host(6, tcp(BOARD_IP, HOST_IP, 80, 40102, 1, len(http_request) + 1, http_response), 15), point=1)

    v6_host = IPv6Address("2001:db8::1").packed
    v6_board = IPv6Address("2001:db8::2").packed
    for src, dst, mac_src, mac_dst, sport, dport in [
        (v6_host, v6_board, HOST_MAC, BOARD_MAC, 40200, 49001),
        (v6_board, v6_host, BOARD_MAC, HOST_MAC, 49001, 40200),
    ]:
        data = b"Lab"
        headers = struct.pack("!HHHH", sport, dport, 8 + len(data), 0)
        prefix = src + dst + struct.pack("!I3xB", len(headers) + len(data), 17)
        value = checksum(prefix + headers + data) or 0xFFFF
        segment = headers[:6] + struct.pack("!H", value) + data
        network = struct.pack("!IHBB", 6 << 28, len(segment), 17, 64) + src + dst
        add(ethernet(mac_src, mac_dst, 0x86DD, network + segment), point=1)
    return records


if __name__ == "__main__":
    with open("sample.pcapng", "wb") as output:
        output.write(pcapng([(0, frame, len(frame)) for frame in frames()], 1))
    with open("traffic.pcapng", "wb") as output:
        output.write(pcapng(traffic_frames(), 2))
    with open("untimed.pcapng", "wb") as output:
        a, b, c = frames()[:3]
        first = pcapng([(0, b, len(b))], 1, START_US + 100_000)
        headers = 48  # Section Header Block plus Interface Description Block.
        simple = block(3, struct.pack("<I", len(a)) + a)
        second = pcapng([(0, c, len(c))], 1, START_US + 200_000)
        output.write(first[:headers] + simple + first[headers:] + second)

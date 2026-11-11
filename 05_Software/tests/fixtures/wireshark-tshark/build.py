"""Writes sample.pcapng: a fictional board (192.168.7.10) answering CoAP and Modbus/TCP reads.

Run from this folder with any Python 3: python build.py. The output is deterministic.
"""

import struct

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


def tcp(src: bytes, dst: bytes, sport: int, dport: int, seq: int, ack: int, payload: bytes) -> bytes:
    header = struct.pack("!HHIIBBHHH", sport, dport, seq, ack, 5 << 4, 0x18, 64240, 0, 0)
    value = checksum(pseudo(src, dst, 6, 20 + len(payload)) + header + payload)
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


def pcapng() -> bytes:
    section = block(0x0A0D0D0A, struct.pack("<IHHq", 0x1A2B3C4D, 1, 0, -1))
    interface = block(1, struct.pack("<HHI", 1, 0, 65535))
    packets = b""
    for index, frame in enumerate(frames()):
        stamp = START_US + index * 100_000
        header = struct.pack("<IIIII", 0, stamp >> 32, stamp & 0xFFFFFFFF, len(frame), len(frame))
        packets += block(6, header + frame)
    return section + interface + packets


if __name__ == "__main__":
    with open("sample.pcapng", "wb") as output:
        output.write(pcapng())

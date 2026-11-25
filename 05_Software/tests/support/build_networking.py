"""Build independent synthetic wire fixtures for offline networking profiles."""

import struct
import sys
from importlib import import_module
from ipaddress import IPv6Address
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "wireshark-tshark"
sys.path.insert(0, str(FIXTURES))
wire = import_module("build")


def fixture() -> bytes:
    records: list[tuple[int, bytes, int]] = []
    client, server = wire.HOST_IP, wire.BOARD_IP
    client_mac, server_mac = wire.HOST_MAC, wire.BOARD_MAC
    broadcast = b"\xff" * 6
    client6 = IPv6Address("2001:db8::1").packed
    server6 = IPv6Address("2001:db8::2").packed
    group6 = IPv6Address("ff02::16").packed

    def link(src: bytes, dst: bytes, kind: int, payload: bytes, missing: int = 0, vlan: int = 42,
             point: int | None = None) -> None:
        frame = wire.ethernet(src, dst, 0x8100, struct.pack("!HH", vlan, kind) + payload)
        if point is None:
            point = int(len(records) in (2, 3, 8, 9, 11))
        records.append((point, frame, len(frame) - missing))

    def ip4(src: bytes, dst: bytes, protocol: int, payload: bytes, reverse: bool = False,
            dst_mac: bytes | None = None, missing: int = 0, vlan: int = 42) -> None:
        link(server_mac if reverse else client_mac, dst_mac or (client_mac if reverse else server_mac),
             0x0800, wire.ipv4(src, dst, protocol, len(records) + 1, payload), missing, vlan)

    def ip6(src: bytes, dst: bytes, protocol: int, payload: bytes, reverse: bool = False,
            dst_mac: bytes | None = None) -> None:
        prefix = src + dst + struct.pack("!I3xB", len(payload), protocol)
        offset = 6 if protocol == 17 else 2
        checksum = wire.checksum(prefix + payload) or 0xFFFF
        segment = payload[:offset] + struct.pack("!H", checksum) + payload[offset + 2:]
        network = struct.pack("!IHBB", 6 << 28, len(segment), protocol, 255) + src + dst + segment
        link(server_mac if reverse else client_mac, dst_mac or (client_mac if reverse else server_mac),
             0x86DD, network)

    def udp6(src: bytes, dst: bytes, sport: int, dport: int, data: bytes, reverse: bool = False) -> None:
        ip6(src, dst, 17, struct.pack("!HHHH", sport, dport, 8 + len(data), 0) + data, reverse)

    link(client_mac, broadcast, 0x0806, wire.arp(1, client_mac, client, b"\0" * 6, server))
    link(server_mac, client_mac, 0x0806, wire.arp(2, server_mac, server, client_mac, client))
    solicited = IPv6Address("ff02::1:ff00:2").packed
    ip6(client6, solicited, 58, b"\x87\0\0\0" + b"\0" * 4 + server6 + b"\1\1" + client_mac,
        dst_mac=bytes.fromhex("3333ff000002"))
    ip6(server6, client6, 58, b"\x88\0\0\0\x60\0\0\0" + server6 + b"\2\1" + server_mac, True)

    question = b"\x07private\x04test\0\0\1\0\1"
    answer = b"\xc0\x0c\0\1\0\1\0\0\0\x3c\0\4" + server
    dns_query = struct.pack("!HHHHHH", 0x4321, 0x0100, 1, 0, 0, 0) + question
    dns_answer = struct.pack("!HHHHHH", 0x4321, 0x8180, 1, 1, 0, 0) + question + answer
    ip4(client, server, 17, wire.udp(client, server, 52000, 53, dns_query))
    ip4(server, client, 17, wire.udp(server, client, 53, 52000, dns_answer), True)

    def dhcp(reply: bool) -> bytes:
        head = struct.pack("!BBBBIHH", 2 if reply else 1, 1, 6, 0, 0x12345678, 0, 0x8000)
        addresses = b"\0" * 4 + (client if reply else b"\0" * 4) + b"\0" * 8
        options = b"\x63\x82\x53\x63\x35\1" + (b"\2\x36\4" + server if reply else b"\1") + b"\xff"
        return head + addresses + client_mac.ljust(208, b"\0") + options

    any4, all4 = b"\0" * 4, b"\xff" * 4
    ip4(any4, all4, 17, wire.udp(any4, all4, 68, 67, dhcp(False)), dst_mac=broadcast)
    ip4(server, all4, 17, wire.udp(server, all4, 67, 68, dhcp(True)), True, broadcast)
    udp6(client6, server6, 546, 547, b"\x01\x12\x34\x56")
    udp6(server6, client6, 547, 546, b"\x02\x12\x34\x56", True)

    group4 = bytes([239, 1, 2, 3])
    mac4 = bytes.fromhex("01005e010203")
    igmp = b"\x16\0\0\0" + group4
    igmp = igmp[:2] + struct.pack("!H", wire.checksum(igmp)) + igmp[4:]
    ip4(client, group4, 2, igmp, dst_mac=mac4)
    mld = b"\x8f\0\0\0\0\0\0\1\x04\0\0\0" + group6
    ip6(client6, group6, 58, mld, dst_mac=bytes.fromhex("333300000016"))
    ip4(client, group4, 17, wire.udp(client, group4, 52001, 5000, b"LOCAL_MULTICAST"), dst_mac=mac4)

    def tls_record(kind: int, body: bytes) -> bytes:
        return struct.pack("!BHH", kind, 0x0303, len(body)) + body

    name = b"tls-private.test"
    sni = struct.pack("!HBH", 3 + len(name), 0, len(name)) + name
    extensions = struct.pack("!HH", 0, len(sni)) + sni
    hello = b"\x03\x03" + bytes(range(32)) + b"\0\0\2\x13\x01\x01\0"
    hello += struct.pack("!H", len(extensions)) + extensions
    hello_record = tls_record(22, b"\x01" + len(hello).to_bytes(3, "big") + hello)
    ip4(client, server, 6, wire.tcp(client, server, 52002, 443, 100, 500, hello_record))
    ip4(server, client, 6, wire.tcp(server, client, 443, 52002, 500, 100 + len(hello_record),
                                  tls_record(23, b"LOCAL_TLS_OPAQUE")), True)
    ip4(client, server, 17, wire.udp(client, server, 52000, 53, dns_query), missing=28)
    ip4(client, server, 17, wire.udp(client, server, 52003, 53, b"\x43\x22" + dns_query[2:]))
    ip4(server, client, 17, wire.udp(server, client, 53, 52003, b"\x43\x22" + dns_answer[2:]), True, vlan=43)
    incomplete_tls = b"\x16\x03\x03\x00\x40\x01\x00"
    ip4(client, server, 6, wire.tcp(client, server, 52004, 443, 100, 500, incomplete_tls))
    fragment = wire.ipv4(client, server, 17, 20, b"fragment")
    header = fragment[:6] + b"\x20\x00" + fragment[8:10] + b"\0\0" + fragment[12:20]
    fragment = header[:10] + struct.pack("!H", wire.checksum(header)) + header[12:] + fragment[20:]
    link(client_mac, server_mac, 0x0800, fragment)

    encapped = wire.to_board(6, wire.tcp(client, server, 52005, 49000, 100, 500, b"inner"), 21)
    vxlan = b"\x08\0\0\0\0\0\1\0" + encapped
    ip4(client, server, 17, wire.udp(client, server, 55000, 4789, vxlan))
    for port, vlan in ((52006, 43), (52007, 42)):
        ip4(client, server, 6, wire.tcp(client, server, port, 443, 100, 500, hello_record[:24]))
        ip4(client, server, 6, wire.tcp(client, server, port, 443, 124, 500, hello_record[24:]), vlan=vlan)

    query_pdu = struct.pack("!H", len(dns_query)) + b"\x44\x21" + dns_query[2:]
    answer_pdu = struct.pack("!H", len(dns_answer)) + b"\x44\x21" + dns_answer[2:]
    ip4(client, server, 6, wire.tcp(client, server, 52008, 53, 100, 500, query_pdu[:10]))
    ip4(client, server, 6, wire.tcp(client, server, 52008, 53, 110, 500, query_pdu[10:]), vlan=43)
    ip4(server, client, 6, wire.tcp(server, client, 53, 52008, 500, 100 + len(query_pdu), answer_pdu), True, vlan=43)

    offer = wire.udp(server, all4, 67, 68, dhcp(True))
    for offset, body, more, point in ((0, offer[:24], True, 0), (3, offer[24:], False, 1)):
        part = wire.ipv4(server, all4, 17, 29, body)
        flags = struct.pack("!H", (0x2000 if more else 0) | offset)
        prefix = part[:6] + flags + part[8:10] + b"\0\0" + part[12:20]
        part = prefix[:10] + struct.pack("!H", wire.checksum(prefix)) + prefix[12:] + body
        link(server_mac, broadcast, 0x0800, part, point=point)

    capture = wire.pcapng(records, 2)
    first = 68
    length = struct.unpack_from("<I", capture, first + 4)[0]
    drops = struct.pack("<HHQ", 4, 8, 3) + b"\0" * 4
    return capture[:first] + wire.block(6, capture[first + 8:first + length - 4] + drops) + capture[first + length:]


def cooked_vlan() -> bytes:
    client, server = wire.HOST_IP, wire.BOARD_IP
    datagram = wire.udp(client, server, 55001, 55002, b"cooked")
    ip = wire.ipv4(client, server, 17, 1, datagram)
    cooked = struct.pack("!HHIHBB8s", 0x8100, 0, 7, 1, 0, 6, wire.HOST_MAC.ljust(8, b"\0"))
    packet = cooked + struct.pack("!HH", 42, 0x0800) + ip
    pcap = struct.pack("<IHHIIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 276)
    return pcap + struct.pack("<IIII", wire.START_US // 1_000_000, 0, len(packet), len(packet)) + packet


if __name__ == "__main__":
    (FIXTURES / "networking.pcapng").write_bytes(fixture())
    (FIXTURES / "networking-cooked.pcap").write_bytes(cooked_vlan())

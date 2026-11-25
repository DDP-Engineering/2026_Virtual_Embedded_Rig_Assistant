"""Write independent synthetic Wireshark media fixtures and an optional benchmark trace."""

import argparse
import struct
import sys
from importlib import import_module
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "wireshark-tshark"
sys.path.insert(0, str(FIXTURES))
wire = import_module("build")


def capture(link_type: int, records: list[tuple[int, bytes, int]], extra: bytes = b"") -> bytes:
    section = wire.block(0x0A0D0D0A, struct.pack("<IHHq", 0x1A2B3C4D, 1, 0, -1))
    interface = wire.block(1, struct.pack("<HHI", link_type, 0, 65535))
    packets = []
    for offset, data, clipped in records:
        stamp = wire.START_US + offset
        captured = len(data) - clipped
        packets.append(wire.block(6, struct.pack("<IIIII", 0, stamp >> 32, stamp & 0xFFFFFFFF,
                                                 captured, len(data)) + data[:captured]))
    return section + interface + extra + b"".join(packets)


def wifi() -> bytes:
    radiotap = struct.pack("<BBHIHHb", 0, 0, 13, 0x28, 2412, 0x00A0, -42)
    header = b"\0\0" + b"\xff" * 6 + wire.BOARD_MAC * 2 + b"\x10\0"
    ssid = b"VERA_MEDIA_WIFI_LOCAL"
    beacon = radiotap + b"\x80\0" + header + struct.pack("<QHHBB", 0, 100, 1, 0, len(ssid)) + ssid
    protected = radiotap + b"\x08\x40" + header + b"\0" * 24
    return capture(127, [(0, beacon, 0), (1000, protected, 4)])


def ble() -> bytes:
    marker = b"VERA_MEDIA_BLE_LOCAL"
    data = bytes([len(marker) + 1, 0x09]) + marker
    advertisement = bytes.fromhex("d6be898e") + bytes([0, 6 + len(data)]) + wire.BOARD_MAC + data + b"\0" * 3
    return capture(251, [(0, advertisement, 0)])


def ble_hci() -> bytes:
    # H4 with direction pseudo-header, LE Connection Complete, then an ATT Read Request.
    connect = bytes.fromhex("00000001043e13010001000000") + wire.BOARD_MAC + bytes.fromhex("18000000c80000")
    att = bytes.fromhex("000000000201200700030004000a0300")
    return capture(201, [(0, connect, 0), (1000, att, 0)])


def usb() -> bytes:
    def usbpcap(info: int, data: bytes) -> bytes:
        return struct.pack("<HQIHBHHBBI", 27, 0x1234, 0, 9, info, 1, 2, 0x81, 3, len(data)) + data

    return capture(249, [(0, usbpcap(0, b""), 0), (1000, usbpcap(1, b"VERA_MEDIA_USB_LOCAL"), 0)])


def usbmon() -> bytes:
    def urb(event: bytes, data: bytes) -> bytes:
        return struct.pack("<QcBBBHccqiiII8siiII", 0x1234, event, 3, 0x81, 2, 1, b"-",
                           b"\0" if data else b"<", wire.START_US // 1000000, 0, 0, len(data),
                           len(data), b"\0" * 8, 0, 0, 0, 0) + data

    return capture(220, [(0, urb(b"S", b""), 0), (1000, urb(b"C", b"VERA_MEDIA_USBMON_LOCAL"), 0)])


def rtp(sequence: int, stamp: int, payload_type: int = 0, reverse: bool = False,
        payload: bytes = b"VERA_MEDIA_RTP_LOCAL", port: int = 5004) -> bytes:
    packet = struct.pack("!BBHII", 0x80, payload_type, sequence, stamp, 0x12345678) + payload
    if reverse:
        return wire.to_host(17, wire.udp(wire.BOARD_IP, wire.HOST_IP, port, 40000, packet), sequence)
    return wire.to_board(17, wire.udp(wire.HOST_IP, wire.BOARD_IP, 40000, port, packet), sequence)


def voip() -> list[tuple[int, bytes, int]]:
    sip = (b"SIP/2.0 200 OK\r\nVia: SIP/2.0/UDP 192.168.7.1;branch=z9hG4bK-synthetic\r\n"
           b"From: <sip:sender@example.invalid>;tag=a\r\nTo: <sip:receiver@example.invalid>;tag=b\r\n"
           b"Call-ID: VERA_MEDIA_SIP_LOCAL\r\nCSeq: 1 OPTIONS\r\nContent-Length: 0\r\n\r\n")
    return [
        (0, wire.to_host(17, wire.udp(wire.BOARD_IP, wire.HOST_IP, 5060, 4060, sip), 1), 0),
        (100000, rtp(65534, 0xFFFFFF60), 0),
        (120000, rtp(65535, 0), 0),
        (165000, rtp(1, 320), 0),
        (200000, rtp(10, 10, 96, reverse=True), 0),
        (222000, rtp(11, 170, 96, reverse=True), 0),
        (250000, wire.frames()[0], 0),
    ]


def clipped_voip() -> bytes:
    records = voip()
    offset, packet, _ = records[2]
    records[2] = (offset, packet, len(packet) - 42)
    return capture(1, records)


def signaled_voip() -> bytes:
    sdp = (b"v=0\r\no=- 1 1 IN IP4 192.168.7.10\r\ns=synthetic\r\nc=IN IP4 192.168.7.10\r\n"
           b"t=0 0\r\nm=audio 5006 RTP/AVP 0\r\na=rtpmap:0 L16/16000\r\n")
    sip = (b"SIP/2.0 200 OK\r\nVia: SIP/2.0/UDP 192.168.7.1;branch=z9hG4bK-synthetic\r\n"
           b"From: <sip:sender@example.invalid>;tag=a\r\nTo: <sip:receiver@example.invalid>;tag=b\r\n"
           b"Call-ID: VERA_MEDIA_SIGNAL_LOCAL\r\nCSeq: 1 INVITE\r\nContent-Type: application/sdp\r\n"
           + f"Content-Length: {len(sdp)}\r\n\r\n".encode() + sdp)
    signaling = wire.to_host(17, wire.udp(wire.BOARD_IP, wire.HOST_IP, 5060, 4060, sip), 1)
    return capture(1, [(0, signaling, 0), (20000, rtp(100, 320, port=5006), 0),
                       (40000, rtp(101, 640, port=5006), 0)])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--benchmark", type=Path)
    args = parser.parse_args()
    if args.benchmark:
        records = [(index * 20000, rtp(index, index * 160, payload=b"\x7f" * 512), 0)
                   for index in range(40000)]
        args.benchmark.write_bytes(capture(1, records))
        return
    traces = {"wifi": wifi(), "ble": ble(), "ble-hci": ble_hci(), "usb": usb(), "usbmon": usbmon(),
              "voip": capture(1, voip()), "voip-clipped": clipped_voip(), "voip-signaled": signaled_voip(),
              "secrets": capture(1, voip(), wire.block(10, struct.pack("<II", 0x544C534B, 4) + b"TEST"))}
    for name, data in traces.items():
        (FIXTURES / f"media-{name}.pcapng").write_bytes(data)


if __name__ == "__main__":
    main()

"""Consistent Overhead Byte Stuffing, the framing of BPIO2 packets: each frame ends with one 0x00 (spec section 5)."""

from __future__ import annotations


def encode(data: bytes) -> bytes:
    """The COBS encoding of `data`, without the trailing delimiter."""
    out, block = bytearray(), bytearray()
    for byte in data:
        if byte == 0:
            out.append(len(block) + 1)
            out += block
            block = bytearray()
            continue
        block.append(byte)
        if len(block) == 254:
            out.append(255)
            out += block
            block = bytearray()
    out.append(len(block) + 1)
    out += block
    return bytes(out)


def decode(data: bytes) -> bytes:
    """The bytes a COBS frame (without its delimiter) holds; ValueError when it is not valid COBS."""
    out, index = bytearray(), 0
    while index < len(data):
        code = data[index]
        block = data[index + 1 : index + code]
        if code == 0 or len(block) != code - 1 or 0 in block:
            raise ValueError("not a COBS frame")
        out += block
        index += code
        if code < 255 and index < len(data):
            out.append(0)
    return bytes(out)

"""BPIO2 packets: requests built and responses read with the official flatbuffers runtime (spec REQ-DATA-634d35da
section 5).

The slot numbers follow `bpio.fbs` of BusPirate5-firmware (main): a FlatBuffers field's vtable entry is at
4 + 2 * slot, and a union field takes two slots (type, then value). Only the fields of section 5 are ever written:
no bootloader, reset, self-test, pin mask, LED or terminal text field exists in this module (REQ-SEC-9350b6ae).
"""

from __future__ import annotations

from typing import Any

import flatbuffers
from flatbuffers import encode, number_types as N, packer
from flatbuffers.table import Table

PROTOCOL_MAJOR = 2
MINIMUM_MINOR = 0
# Union member numbers of RequestPacketContents and ResponsePacketContents (0 is NONE).
STATUS, CONFIGURATION, DATA = 1, 2, 3


# Requests ------------------------------------------------------------------------------------------------------------
def _request(builder: flatbuffers.Builder, kind: int, contents: int) -> bytes:
    builder.StartObject(4)  # RequestPacket: version_major, minimum_version_minor, contents_type, contents
    builder.PrependUint8Slot(0, PROTOCOL_MAJOR, 0)
    builder.PrependUint16Slot(1, MINIMUM_MINOR, 0)
    builder.PrependUint8Slot(2, kind, 0)
    builder.PrependUOffsetTRelativeSlot(3, contents, 0)
    builder.Finish(builder.EndObject())
    return bytes(builder.Output())


def _builder() -> flatbuffers.Builder:
    builder = flatbuffers.Builder(256)
    builder.ForceDefaults(True)  # every given field is written, whatever the schema default
    return builder


def status_request() -> bytes:
    """StatusRequest with an empty query list: the adapter answers every status query."""
    builder = _builder()
    builder.StartObject(1)
    return _request(builder, STATUS, builder.EndObject())


def configuration_request(mode: str, settings: dict[str, Any], pullups: bool, power: tuple[int, int] | None) -> bytes:
    """ConfigurationRequest for `mode` (I2C, SPI, UART or HiZ).

    `settings` holds ModeConfiguration fields by name (speed, data_bits, parity, stop_bits, clock_stretch,
    clock_polarity, clock_phase, chip_select_idle) and optionally `bitorder` (msb/lsb). `power` is (mV, mA) to switch
    the supply on, None to switch it off.
    """
    builder = _builder()
    name = builder.CreateString(mode)
    builder.StartObject(13)  # ModeConfiguration
    for slot, key, kind in (
        (0, "speed", "u32"),
        (1, "data_bits", "u8"),
        (2, "parity", "bool"),
        (3, "stop_bits", "u8"),
        (6, "clock_stretch", "bool"),
        (7, "clock_polarity", "bool"),
        (8, "clock_phase", "bool"),
        (9, "chip_select_idle", "bool"),
    ):
        if key not in settings:
            continue
        value = settings[key]
        if kind == "u32":
            builder.PrependUint32Slot(slot, int(value), 0)
        elif kind == "u8":
            builder.PrependUint8Slot(slot, int(value), 0)
        else:
            builder.PrependBoolSlot(slot, bool(value), False)
    configuration = builder.EndObject()
    builder.StartObject(20)  # ConfigurationRequest
    builder.PrependUOffsetTRelativeSlot(0, name, 0)
    builder.PrependUOffsetTRelativeSlot(1, configuration, 0)
    if settings.get("bitorder") == "msb":
        builder.PrependBoolSlot(2, True, False)
    elif settings.get("bitorder") == "lsb":
        builder.PrependBoolSlot(3, True, False)
    if power is None:
        builder.PrependBoolSlot(4, True, False)  # psu_disable
    else:
        builder.PrependBoolSlot(5, True, False)  # psu_enable
        builder.PrependUint32Slot(6, power[0], 0)
        builder.PrependUint16Slot(7, power[1], 0)
    builder.PrependBoolSlot(9 if pullups else 8, True, False)  # pullup_enable / pullup_disable
    return _request(builder, CONFIGURATION, builder.EndObject())


def release_request() -> bytes:
    """HiZ with pull-ups and supply off; a mode change needs a ModeConfiguration table, given empty."""
    return configuration_request("HiZ", {}, pullups=False, power=None)


def data_request(write: bytes, read: int, framed: bool) -> bytes:
    """DataRequest: `framed` adds start_main and stop_main (I2C start/stop, SPI chip select and deselect)."""
    builder = _builder()
    vector = builder.CreateByteVector(write) if write else None
    builder.StartObject(6)
    if framed:
        builder.PrependBoolSlot(0, True, False)
    if vector is not None:
        builder.PrependUOffsetTRelativeSlot(2, vector, 0)
    builder.PrependUint16Slot(3, read, 0)
    if framed:
        builder.PrependBoolSlot(4, True, False)
    return _request(builder, DATA, builder.EndObject())


# Responses -----------------------------------------------------------------------------------------------------------
def _offset(table: Table, slot: int) -> int:
    return table.Offset(4 + 2 * slot)


def _get(table: Table, slot: int, flags: Any, default: Any) -> Any:
    offset = _offset(table, slot)
    return table.Get(flags, table.Pos + offset) if offset else default


def _text(table: Table, slot: int) -> str | None:
    offset = _offset(table, slot)
    return table.String(table.Pos + offset).decode("utf-8", "replace") if offset else None


def _texts(table: Table, slot: int) -> list[str]:
    offset = _offset(table, slot)
    if not offset:
        return []
    start = table.Vector(offset)
    return [table.String(start + 4 * index).decode("utf-8", "replace") for index in range(table.VectorLen(offset))]


def _octets(table: Table, slot: int) -> bytes:
    offset = _offset(table, slot)
    if not offset:
        return b""
    start = table.Vector(offset)
    return bytes(table.Bytes[start : start + table.VectorLen(offset)])


def _status(table: Table) -> dict[str, Any]:
    return {
        "error": _text(table, 0),
        "protocol": [_get(table, 1, N.Uint8Flags, 0), _get(table, 2, N.Uint16Flags, 0)],
        "hardware": [_get(table, 3, N.Uint8Flags, 0), _get(table, 4, N.Uint8Flags, 0)],
        "firmware": [_get(table, 5, N.Uint8Flags, 0), _get(table, 6, N.Uint8Flags, 0)],
        "gitHash": _text(table, 7),
        "date": _text(table, 8),
        "modes": _texts(table, 9),
        "mode": _text(table, 10),
        "maxPacket": _get(table, 13, N.Uint32Flags, 0),
        "maxWrite": _get(table, 14, N.Uint32Flags, 0),
        "maxRead": _get(table, 15, N.Uint32Flags, 0),
        "psu": _get(table, 16, N.BoolFlags, False),
        "psuSetMv": _get(table, 17, N.Uint32Flags, 0),
        "psuSetMa": _get(table, 18, N.Uint32Flags, 0),
        "psuMeasuredMv": _get(table, 19, N.Uint32Flags, 0),
        "psuMeasuredMa": _get(table, 20, N.Uint32Flags, 0),
        "psuCurrentError": _get(table, 21, N.BoolFlags, False),
        "pullups": _get(table, 22, N.BoolFlags, False),
        "ioDirection": _get(table, 24, N.Uint8Flags, 0),
        "ioValue": _get(table, 25, N.Uint8Flags, 0),
    }


def parse_response(buffer: bytes) -> dict[str, Any]:
    """A ResponsePacket as `{type, packetError, ...}`; ValueError when the bytes are no such packet."""
    data = bytearray(buffer)
    try:
        if len(data) < 8:
            raise ValueError("too short")
        root = Table(data, encode.Get(packer.uoffset, data, 0))
        packet_error = _text(root, 0)
        kind = _get(root, 1, N.Uint8Flags, 0)
        offset = _offset(root, 2)
        response: dict[str, Any] = {"packetError": packet_error}
        if kind == 0 or not offset:
            if packet_error is None:
                raise ValueError("no contents")
            response["type"] = "error"
            return response
        contents = Table(bytearray(), 0)
        root.Union(contents, offset)
        if kind == STATUS:
            response.update(type="status", **_status(contents))
        elif kind == CONFIGURATION:
            response.update(type="configuration", error=_text(contents, 0))
        elif kind == DATA:
            response.update(type="data", error=_text(contents, 0), data=_octets(contents, 1), isAsync=_get(contents, 2, N.BoolFlags, False))
        else:
            raise ValueError(f"unknown contents type {kind}")
        return response
    except Exception as error:  # noqa: BLE001 - malformed bytes raise anything the runtime meets
        raise ValueError(f"not a BPIO2 response ({type(error).__name__})") from error

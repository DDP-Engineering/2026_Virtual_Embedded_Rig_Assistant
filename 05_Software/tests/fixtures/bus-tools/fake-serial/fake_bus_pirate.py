"""A simulated Bus Pirate 5 in BPIO2 binary mode behind a fake pyserial (bus-tools tests; offline evidence only).

$FAKE_BUS_BENCH (JSON) declares the serial ports (role binary, terminal or other), the adapter's reported versions and
limits, the targets on its buses and faults. The adapter's state (mode, pull-ups, supply, EEPROM contents) persists
in $FAKE_BUS_STATE across helper processes; every decoded request is appended to $FAKE_BUS_LOG as one JSON line.
Requests are parsed and answers built with the official flatbuffers runtime, by the slot numbers of bpio.fbs
(BusPirate5-firmware main), independently of the helper's own code.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import flatbuffers
from flatbuffers import encode, number_types as N, packer
from flatbuffers.table import Table

MODES = ["HiZ", "1WIRE", "UART", "HDUART", "I2C", "SPI", "2WIRE", "3WIRE", "DIO", "LED", "INFRARED", "JTAG"]
FORBIDDEN_CONFIG = {14: "led_resume", 15: "led_color", 16: "print_string", 17: "hardware_bootloader", 18: "hardware_reset", 19: "hardware_selftest", 10: "io_direction_mask", 11: "io_direction", 12: "io_value_mask", 13: "io_value"}


def bench() -> dict[str, Any]:
    return json.loads(Path(os.environ["FAKE_BUS_BENCH"]).read_text(encoding="utf-8"))


def ports() -> list[dict[str, Any]]:
    return bench().get("ports", [])


def same(left: str, right: str) -> bool:
    return (left.casefold() == right.casefold()) if os.name == "nt" else left == right


def log(entry: dict[str, Any]) -> None:
    path = os.environ.get("FAKE_BUS_LOG")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")


def load_state() -> dict[str, Any]:
    path = Path(os.environ["FAKE_BUS_STATE"])
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"mode": "HiZ", "pullups": False, "psu": False, "psuMv": 0, "psuMa": 0, "cpol": False, "cpha": False, "eeprom": {}, "configured": 0}


def save_state(state: dict[str, Any]) -> None:
    Path(os.environ["FAKE_BUS_STATE"]).write_text(json.dumps(state), encoding="utf-8")


# COBS, written for the fixture.
def cobs_encode(data: bytes) -> bytes:
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


def cobs_decode(data: bytes) -> bytes:
    out, index = bytearray(), 0
    while index < len(data):
        code = data[index]
        if code == 0:
            raise ValueError("bad COBS")
        block = data[index + 1 : index + code]
        if 0 in block or len(block) != code - 1:
            raise ValueError("bad COBS")
        out += block
        index += code
        if code < 255 and index < len(data):
            out.append(0)
    return bytes(out)


# FlatBuffers reading by slot.
def _slot(table: Table, slot: int) -> int:
    return table.Offset(4 + 2 * slot)


def _scalar(table: Table, slot: int, flags: Any, default: Any) -> Any:
    offset = _slot(table, slot)
    return table.Get(flags, offset + table.Pos) if offset else default


def _string(table: Table, slot: int) -> str | None:
    offset = _slot(table, slot)
    return table.String(offset + table.Pos).decode("utf-8") if offset else None


def _bytes(table: Table, slot: int) -> bytes:
    offset = _slot(table, slot)
    if not offset:
        return b""
    start = table.Vector(offset)
    return bytes(table.Bytes[start : start + table.VectorLen(offset)])


def _child(table: Table, slot: int) -> Table | None:
    offset = _slot(table, slot)
    return Table(table.Bytes, table.Indirect(offset + table.Pos)) if offset else None


def parse_request(buffer: bytes) -> dict[str, Any]:
    data = bytearray(buffer)
    root = Table(data, encode.Get(packer.uoffset, data, 0))
    request: dict[str, Any] = {
        "versionMajor": _scalar(root, 0, N.Uint8Flags, 0),
        "minimumMinor": _scalar(root, 1, N.Uint16Flags, 0),
    }
    kind = _scalar(root, 2, N.Uint8Flags, 0)
    offset = _slot(root, 3)
    contents = Table(bytearray(), 0)
    if offset:
        root.Union(contents, offset)
    if kind == 1:
        request["type"] = "status"
    elif kind == 2:
        request["type"] = "configuration"
        request["mode"] = _string(contents, 0)
        config = _child(contents, 1)
        if config is not None:
            request["modeConfiguration"] = {
                "speed": _scalar(config, 0, N.Uint32Flags, 20000),
                "dataBits": _scalar(config, 1, N.Uint8Flags, 8),
                "parity": _scalar(config, 2, N.BoolFlags, False),
                "stopBits": _scalar(config, 3, N.Uint8Flags, 1),
                "clockStretch": _scalar(config, 6, N.BoolFlags, False),
                "clockPolarity": _scalar(config, 7, N.BoolFlags, False),
                "clockPhase": _scalar(config, 8, N.BoolFlags, False),
                "chipSelectIdle": _scalar(config, 9, N.BoolFlags, True),
            }
        for slot, name in ((2, "bitorderMsb"), (3, "bitorderLsb"), (4, "psuDisable"), (5, "psuEnable"), (8, "pullupDisable"), (9, "pullupEnable")):
            request[name] = _scalar(contents, slot, N.BoolFlags, False)
        request["psuSetMv"] = _scalar(contents, 6, N.Uint32Flags, 0)
        request["psuSetMa"] = _scalar(contents, 7, N.Uint16Flags, 300)
        request["forbidden"] = [name for slot, name in FORBIDDEN_CONFIG.items() if _slot(contents, slot)]
    elif kind == 3:
        request["type"] = "data"
        request["startMain"] = _scalar(contents, 0, N.BoolFlags, False)
        request["startAlt"] = _scalar(contents, 1, N.BoolFlags, False)
        request["write"] = _bytes(contents, 2).hex()
        request["read"] = _scalar(contents, 3, N.Uint16Flags, 0)
        request["stopMain"] = _scalar(contents, 4, N.BoolFlags, False)
    else:
        request["type"] = f"unknown-{kind}"
    return request


# FlatBuffers answers.
def _strings(builder: flatbuffers.Builder, values: list[str]) -> int:
    offsets = [builder.CreateString(value) for value in values]
    builder.StartVector(4, len(offsets), 4)
    for offset in reversed(offsets):
        builder.PrependUOffsetTRelative(offset)
    return builder.EndVector()


def _packet(builder: flatbuffers.Builder, kind: int, contents: int, error: str | None = None) -> bytes:
    text = builder.CreateString(error) if error else None
    builder.StartObject(3)
    if text is not None:
        builder.PrependUOffsetTRelativeSlot(0, text, 0)
    builder.PrependUint8Slot(1, kind, 0)
    builder.PrependUOffsetTRelativeSlot(2, contents, 0)
    builder.Finish(builder.EndObject())
    return bytes(builder.Output())


def status_response(state: dict[str, Any], adapter: dict[str, Any]) -> bytes:
    builder = flatbuffers.Builder(512)
    builder.ForceDefaults(True)
    git = builder.CreateString(adapter.get("gitHash", "a1b2c3d"))
    date = builder.CreateString(adapter.get("date", "2026-10-01"))
    modes = _strings(builder, MODES)
    current = builder.CreateString(state["mode"])
    builder.StartObject(29)
    hardware, protocol, firmware = adapter.get("hardware", [5, 10]), adapter.get("protocol", [2, 0]), adapter.get("firmware", [0, 0])
    builder.PrependUint8Slot(1, protocol[0], 0)
    builder.PrependUint16Slot(2, protocol[1], 0)
    builder.PrependUint8Slot(3, hardware[0], 0)
    builder.PrependUint8Slot(4, hardware[1], 0)
    builder.PrependUint8Slot(5, firmware[0], 0)
    builder.PrependUint8Slot(6, firmware[1], 0)
    builder.PrependUOffsetTRelativeSlot(7, git, 0)
    builder.PrependUOffsetTRelativeSlot(8, date, 0)
    builder.PrependUOffsetTRelativeSlot(9, modes, 0)
    builder.PrependUOffsetTRelativeSlot(10, current, 0)
    builder.PrependBoolSlot(12, True, False)
    builder.PrependUint32Slot(13, 640, 0)
    builder.PrependUint32Slot(14, adapter.get("maxWrite", 512), 0)
    builder.PrependUint32Slot(15, adapter.get("maxRead", 512), 0)
    builder.PrependBoolSlot(16, bool(state["psu"]), False)
    builder.PrependUint32Slot(17, state["psuMv"] if state["psu"] else 0, 0)
    builder.PrependUint32Slot(18, state["psuMa"] if state["psu"] else 0, 0)
    builder.PrependUint32Slot(19, state["psuMv"] if state["psu"] else 0, 0)
    builder.PrependBoolSlot(22, bool(state["pullups"]), False)
    builder.PrependUint8Slot(24, 0 if state["mode"] == "HiZ" else 0x0F, 0)
    contents = builder.EndObject()
    return _packet(builder, 1, contents)


def simple_response(kind: int, error: str | None = None, data: bytes | None = None, is_async: bool = False) -> bytes:
    builder = flatbuffers.Builder(256)
    builder.ForceDefaults(True)
    text = builder.CreateString(error) if error else None
    vector = builder.CreateByteVector(data) if data is not None else None
    builder.StartObject(3 if kind == 3 else 1)
    if text is not None:
        builder.PrependUOffsetTRelativeSlot(0, text, 0)
    if vector is not None:
        builder.PrependUOffsetTRelativeSlot(1, vector, 0)
    if kind == 3 and is_async:
        builder.PrependBoolSlot(2, True, False)
    contents = builder.EndObject()
    return _packet(builder, kind, contents)


def packet_error(text: str) -> bytes:
    builder = flatbuffers.Builder(64)
    message = builder.CreateString(text)
    builder.StartObject(3)
    builder.PrependUOffsetTRelativeSlot(0, message, 0)
    builder.Finish(builder.EndObject())
    return bytes(builder.Output())


class Adapter:
    """One open binary port: frames in, answers out."""

    def __init__(self, entry: dict[str, Any]) -> None:
        self.entry = entry
        self.inbox = bytearray()
        self.outbox = bytearray()
        self.closed = False
        self.unplugged = False

    def feed(self, data: bytes) -> None:
        if self.unplugged:
            raise OSError(5, "The device does not recognize the command (unplugged)")
        self.inbox += data
        while 0 in self.inbox:
            end = self.inbox.index(0)
            frame, self.inbox = bytes(self.inbox[:end]), self.inbox[end + 1 :]
            if frame:
                self.handle(frame)

    def queue(self, packet: bytes) -> None:
        self.outbox += cobs_encode(packet) + b"\x00"

    def handle(self, frame: bytes) -> None:
        setup = bench()
        faults = setup.get("faults", {})
        adapter = setup.get("adapter", {})
        try:
            request = parse_request(cobs_decode(frame))
        except Exception as error:  # noqa: BLE001
            log({"event": "garbage", "error": str(error)})
            return
        log({"event": "request", **request})
        if faults.get("terminalText"):
            self.outbox += b"\r\nHiZ> "
            return
        if faults.get("silent"):
            return
        if faults.get("packetError"):
            self.queue(packet_error(faults["packetError"]))
            return
        state = load_state()
        kind = request["type"]
        if kind == "status":
            self.queue(status_response(state, adapter))
        elif kind == "configuration":
            self.configure(request, state, faults)
        elif kind == "data":
            self.data(request, state, faults, setup.get("targets", {}))
        save_state(state)

    def configure(self, request: dict[str, Any], state: dict[str, Any], faults: dict[str, Any]) -> None:
        release = (request.get("mode") or "").casefold() == "hiz"
        if (faults.get("silentRelease") and release) or (faults.get("silentConfig") and not release):
            return
        if faults.get("configError") and not release:
            self.queue(simple_response(2, faults["configError"]))
            return
        state["mode"] = request.get("mode") or state["mode"]
        config = request.get("modeConfiguration") or {}
        state["cpol"], state["cpha"] = bool(config.get("clockPolarity")), bool(config.get("clockPhase"))
        if request.get("pullupEnable") and not faults.get("ignorePullups"):
            state["pullups"] = True
        if request.get("pullupDisable"):
            state["pullups"] = False
        if request.get("psuEnable"):
            state["psu"], state["psuMv"], state["psuMa"] = True, request.get("psuSetMv", 0), request.get("psuSetMa", 0)
        if request.get("psuDisable") and not faults.get("keepPsu"):
            state["psu"] = False
        state["configured"] = state.get("configured", 0) + 1
        self.queue(simple_response(2))
        if faults.get("unplugAfterConfig") and not release:
            self.unplugged = True
        if faults.get("stream") and state["mode"].casefold() == "uart":
            for chunk in faults["stream"]:
                self.queue(simple_response(3, None, bytes.fromhex(chunk), is_async=True))

    def data(self, request: dict[str, Any], state: dict[str, Any], faults: dict[str, Any], targets: dict[str, Any]) -> None:
        if faults.get("dropData"):
            return
        written = bytes.fromhex(request["write"])
        count = request["read"]
        mode = state["mode"].casefold()
        reply = b""
        if mode == "i2c":
            if not written:
                self.queue(simple_response(3, "No I2C address"))
                return
            address = f"0x{written[0] >> 1:02x}"
            device = targets.get("i2c", {}).get(address)
            if device is None:
                self.queue(simple_response(3, faults.get("nackText", "I2C address NACK")))
                return
            payload = written[1:]
            if device.get("eeprom"):
                memory = state.setdefault("eeprom", {})
                if payload:
                    pointer = payload[0]
                    for offset, byte in enumerate(payload[1:]):
                        memory[str((pointer + offset) & 0xFF)] = byte
                    state["pointer"] = pointer
                start = state.get("pointer", 0)
                reply = bytes(memory.get(str((start + i) & 0xFF), 0xFF) for i in range(count))
            else:
                registers = {int(key, 16): bytes.fromhex(value) for key, value in device.get("registers", {}).items()}
                pointer = payload[0] if payload else 0
                flat = bytearray()
                while len(flat) < count:
                    flat += registers.get(pointer, b"\x00")
                    pointer = (pointer + max(1, len(registers.get(pointer, b"\x00")))) & 0xFF
                reply = bytes(flat[:count])
        elif mode == "spi":
            flash = targets.get("spi", {}).get("flash", {})
            wanted = flash.get("mode", [0, 0])
            command = written[:1].hex()
            answer = bytes.fromhex(flash.get("commands", {}).get(command, "")) or b"\xff" * count
            answer = (answer * (count // max(1, len(answer)) + 1))[:count]
            if [int(state["cpol"]), int(state["cpha"])] != wanted:
                answer = bytes(((byte << 1) & 0xFF) | 1 for byte in answer)
            reply = answer
        elif mode == "uart":
            peer = targets.get("uart", {})
            reply = (written * (count // max(1, len(written)) + 1))[:count] if peer.get("echo") else b""
        else:
            self.queue(simple_response(3, "Mode does not support data"))
            return
        if "shortRead" in faults:
            reply = reply[: faults["shortRead"]]
        self.queue(simple_response(3, None, reply))

    def take(self, size: int, timeout: float | None) -> bytes:
        deadline = time.monotonic() + (timeout or 0)
        while not self.outbox and time.monotonic() < deadline:
            time.sleep(0.01)
        if self.unplugged and not self.outbox:
            raise OSError(5, "The device does not recognize the command (unplugged)")
        data, self.outbox = bytes(self.outbox[:size]), self.outbox[size:]
        return data

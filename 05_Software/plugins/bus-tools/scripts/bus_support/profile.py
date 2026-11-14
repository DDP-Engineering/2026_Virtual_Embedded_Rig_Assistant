"""The bus profile (format 1, kind bus-tools-profile): wiring, supply, bus settings, limits, final state, devices and
registers (spec REQ-DATA-634d35da section 4).

Every field is checked before any port is opened (REQ-SEC-2ec2103d); a register is the only way read-register reaches
a device (REQ-SEC-b30461f8), and the helper's caps bound every limit a profile may declare.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import FORMAT, PROFILE_KIND
from .report import refused

PROFILE_BYTES = 64 * 1024
NAME = re.compile(r"[a-z][a-z0-9_-]{0,31}")
PRINTABLE = re.compile(r"[\x20-\x7e]{1,64}")
HEX = re.compile(r"(?:[0-9A-Fa-f]{2})*")
ADDRESS = re.compile(r"0x[0-9A-Fa-f]{2}")
CAPS = {"maxWriteBytes": 512, "maxReadBytes": 512, "timeoutMs": 10000}
SPEED = {"i2c": (1_000, 1_000_000), "spi": (10_000, 20_000_000)}
BAUD = (300, 1_000_000)
MODES = {"i2c": "I2C", "spi": "SPI", "uart": "UART"}


@dataclass(frozen=True)
class Register:
    name: str
    write: bytes
    read: int
    access: str
    expect: bytes | None


@dataclass(frozen=True)
class Device:
    name: str
    address: int | None
    raw_transfer: bool
    registers: dict[str, Register] = field(default_factory=dict)


@dataclass(frozen=True)
class Profile:
    path: str
    sha256: str
    name: str
    mode: str
    bus: dict[str, Any]
    pullups: bool
    logic_mv: int
    power: dict[str, Any]
    limits: dict[str, int]
    final: str
    devices: dict[str, Device]

    @property
    def wire_mode(self) -> str:
        return MODES[self.mode]

    def settings(self) -> dict[str, Any]:
        """The ModeConfiguration fields of the bus (spec section 5)."""
        bus = self.bus
        if self.mode == "i2c":
            return {"speed": bus["speedHz"], "clock_stretch": bus.get("clockStretch", False)}
        if self.mode == "spi":
            return {
                "speed": bus["speedHz"],
                "data_bits": 8,
                "clock_polarity": bus["cpol"] == 1,
                "clock_phase": bus["cpha"] == 1,
                "chip_select_idle": bus["csIdle"] == "high",
                "bitorder": bus["bitOrder"],
            }
        return {"speed": bus["baud"], "data_bits": bus["dataBits"], "parity": bus["parity"] == "even", "stop_bits": bus["stopBits"]}

    def summary(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "sha256": self.sha256,
            "name": self.name,
            "mode": self.mode,
            "bus": self.bus,
            "logicMv": self.logic_mv,
            "power": self.power,
            "limits": self.limits,
            "final": self.final,
            "devices": [
                {
                    "name": device.name,
                    "address": None if device.address is None else f"0x{device.address:02x}",
                    "rawTransfer": device.raw_transfer,
                    "registers": [
                        {"name": item.name, "write": item.write.hex(), "read": item.read, "access": item.access, "expect": None if item.expect is None else item.expect.hex()}
                        for item in device.registers.values()
                    ],
                }
                for device in self.devices.values()
            ],
        }


def _bad(where: str, rule: str) -> Exception:
    return refused("profile-invalid", f"The bus profile's {where} {rule}.")


def _keys(value: Any, where: str, required: set[str], optional: set[str] = frozenset()) -> dict[str, Any]:  # type: ignore[assignment]
    if not isinstance(value, dict):
        raise _bad(where, "must be an object")
    missing, unknown = required - set(value), set(value) - required - set(optional)
    if missing or unknown:
        raise _bad(where, f"has {'missing' if missing else 'unknown'} fields {', '.join(sorted(missing or unknown))}")
    return value


def _int(value: Any, where: str, low: int, high: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise _bad(where, f"must be an integer from {low} to {high}")
    return value


def _bool(value: Any, where: str) -> bool:
    if not isinstance(value, bool):
        raise _bad(where, "must be true or false")
    return value


def _choice(value: Any, where: str, choices: tuple[Any, ...]) -> Any:
    if value not in choices or isinstance(value, bool):
        raise _bad(where, f"must be one of {', '.join(map(str, choices))}")
    return value


def _hex(value: Any, where: str, low: int, high: int) -> bytes:
    if not isinstance(value, str) or not HEX.fullmatch(value) or not low <= len(value) // 2 <= high:
        raise _bad(where, f"must be {low} to {high} bytes of hex")
    return bytes.fromhex(value)


def _bus(raw: Any) -> tuple[str, dict[str, Any]]:
    mode = raw.get("mode") if isinstance(raw, dict) else None
    if mode == "i2c":
        bus = _keys(raw, "bus", {"mode", "speedHz", "pullups"}, {"clockStretch"})
        _int(bus["speedHz"], "bus.speedHz", *SPEED["i2c"])
        _bool(bus.get("clockStretch", False), "bus.clockStretch")
    elif mode == "spi":
        bus = _keys(raw, "bus", {"mode", "speedHz", "pullups", "cpol", "cpha", "csIdle", "bitOrder"})
        _int(bus["speedHz"], "bus.speedHz", *SPEED["spi"])
        _choice(bus["cpol"], "bus.cpol", (0, 1))
        _choice(bus["cpha"], "bus.cpha", (0, 1))
        _choice(bus["csIdle"], "bus.csIdle", ("high", "low"))
        _choice(bus["bitOrder"], "bus.bitOrder", ("msb", "lsb"))
    elif mode == "uart":
        bus = _keys(raw, "bus", {"mode", "baud", "dataBits", "parity", "stopBits", "pullups"})
        _int(bus["baud"], "bus.baud", *BAUD)
        _int(bus["dataBits"], "bus.dataBits", 5, 8)
        _choice(bus["parity"], "bus.parity", ("none", "even"))
        _choice(bus["stopBits"], "bus.stopBits", (1, 2))
    else:
        raise _bad("bus.mode", "must be i2c, spi or uart")
    _bool(bus["pullups"], "bus.pullups")
    return mode, dict(bus)


def _device(raw: Any, index: int, mode: str, max_read: int) -> Device:
    where = f"devices[{index}]"
    device = _keys(raw, where, {"name"}, {"address", "rawTransfer", "registers", "note"})
    if not isinstance(device["name"], str) or not NAME.fullmatch(device["name"]):
        raise _bad(f"{where}.name", "must match [a-z][a-z0-9_-]{0,31}")
    address = None
    if mode == "i2c":
        text = device.get("address")
        if not isinstance(text, str) or not ADDRESS.fullmatch(text) or not 0x08 <= int(text, 16) <= 0x77:
            raise _bad(f"{where}.address", "must be a 7-bit address from 0x08 to 0x77")
        address = int(text, 16)
    elif "address" in device:
        raise _bad(f"{where}.address", f"is used only on i2c, not {mode}")
    if "note" in device and (not isinstance(device["note"], str) or len(device["note"]) > 256):
        raise _bad(f"{where}.note", "must be text of at most 256 characters")
    raw_transfer = _bool(device.get("rawTransfer", False), f"{where}.rawTransfer")
    registers: dict[str, Register] = {}
    entries = device.get("registers", [])
    if mode == "uart" and entries:
        raise _bad(f"{where}.registers", "are not used on uart")
    if not isinstance(entries, list) or len(entries) > 64:
        raise _bad(f"{where}.registers", "must be a list of at most 64 registers")
    for number, item in enumerate(entries):
        at = f"{where}.registers[{number}]"
        register = _keys(item, at, {"name", "write", "read", "access"}, {"expect", "note"})
        if not isinstance(register["name"], str) or not NAME.fullmatch(register["name"]) or register["name"] in registers:
            raise _bad(f"{at}.name", "must be a unique name matching [a-z][a-z0-9_-]{0,31}")
        write = _hex(register["write"], f"{at}.write", 0, 4)
        read = _int(register["read"], f"{at}.read", 1, min(64, max_read))
        access = _choice(register["access"], f"{at}.access", ("read", "read-clears"))
        expect = None if "expect" not in register else _hex(register["expect"], f"{at}.expect", read, read)
        if "note" in register and (not isinstance(register["note"], str) or len(register["note"]) > 256):
            raise _bad(f"{at}.note", "must be text of at most 256 characters")
        registers[register["name"]] = Register(register["name"], write, read, access, expect)
    return Device(device["name"], address, raw_transfer, registers)


def parse(document: Any, path: str, sha256: str) -> Profile:
    top = _keys(document, "document", {"format", "kind", "name", "wiring", "power", "bus", "limits", "devices"}, {"final"})
    if top["format"] != FORMAT or top["kind"] != PROFILE_KIND:
        raise _bad("document", f"must be format 1, kind {PROFILE_KIND}")
    if not isinstance(top["name"], str) or not PRINTABLE.fullmatch(top["name"]):
        raise _bad("name", "must be 1-64 printable characters")
    wiring = _keys(top["wiring"], "wiring", {"commonGround", "logicMv"}, {"note"})
    if wiring["commonGround"] is not True:
        raise _bad("wiring.commonGround", "must be true: the adapter and the circuit share a ground")
    logic_mv = _int(wiring["logicMv"], "wiring.logicMv", 1200, 5000)
    if "note" in wiring and (not isinstance(wiring["note"], str) or len(wiring["note"]) > 256):
        raise _bad("wiring.note", "must be text of at most 256 characters")
    power_raw = top["power"]
    source = power_raw.get("source") if isinstance(power_raw, dict) else None
    if source == "external":
        power = dict(_keys(power_raw, "power", {"source"}))
    elif source == "adapter":
        power = dict(_keys(power_raw, "power", {"source", "mv", "ma"}))
        _int(power["mv"], "power.mv", 800, 5000)
        _int(power["ma"], "power.ma", 1, 500)
    else:
        raise _bad("power.source", "must be external or adapter")
    mode, bus = _bus(top["bus"])
    limits = dict(_keys(top["limits"], "limits", set(CAPS)))
    _int(limits["maxWriteBytes"], "limits.maxWriteBytes", 1, CAPS["maxWriteBytes"])
    _int(limits["maxReadBytes"], "limits.maxReadBytes", 1, CAPS["maxReadBytes"])
    _int(limits["timeoutMs"], "limits.timeoutMs", 100, CAPS["timeoutMs"])
    final = _choice(top.get("final", "release"), "final", ("release", "keep"))
    devices_raw = top["devices"]
    if not isinstance(devices_raw, list) or not 1 <= len(devices_raw) <= 16:
        raise _bad("devices", "must list 1 to 16 devices")
    devices: dict[str, Device] = {}
    for index, raw in enumerate(devices_raw):
        device = _device(raw, index, mode, limits["maxReadBytes"])
        if device.name in devices:
            raise _bad(f"devices[{index}].name", "is used twice")
        for item in device.registers.values():
            if len(item.write) + (1 if mode == "i2c" else 0) > limits["maxWriteBytes"]:
                raise _bad(f"devices[{index}].registers", "write more bytes than limits.maxWriteBytes")
        devices[device.name] = device
    return Profile(path, sha256, top["name"], mode, bus, bus["pullups"], logic_mv, power, limits, final, devices)


def load(file: Path, shown: str) -> Profile:
    try:
        data = file.read_bytes()
    except OSError as error:
        raise refused("profile-invalid", f"The bus profile {shown} cannot be read: {error.strerror or error}.") from error
    if len(data) > PROFILE_BYTES:
        raise refused("profile-invalid", "The bus profile is larger than 64 KiB.")
    try:
        document = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise refused("profile-invalid", "The bus profile is not valid UTF-8 JSON.") from error
    return parse(document, shown, hashlib.sha256(data).hexdigest())

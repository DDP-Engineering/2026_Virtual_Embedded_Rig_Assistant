"""Serial ports from pyserial, their identity keys and the port a device operation names (REQ-FUNC-884fed95).

Identity: `usb:<vid>:<pid>:<serial number>` when the port reports a USB serial number (stable across ports), else
`usb:<vid>:<pid>` or `serial:<address>`, both unstable - the keys of the arduino-cli plugin. A common USB-to-serial
bridge says nothing about the board behind it: such a port is marked with its bridge and no board is named.
"""

from __future__ import annotations

import os
import re
from typing import Any

from .report import Refused, problem

BRIDGES = {
    ("0403", "6001"): "FTDI FT232R",
    ("0403", "6010"): "FTDI FT2232",
    ("0403", "6011"): "FTDI FT4232",
    ("0403", "6014"): "FTDI FT232H",
    ("0403", "6015"): "FTDI FT-X",
    ("1a86", "7523"): "WCH CH340",
    ("1a86", "7522"): "WCH CH340",
    ("1a86", "55d4"): "WCH CH9102",
    ("1a86", "55d3"): "WCH CH343",
    ("10c4", "ea60"): "Silicon Labs CP210x",
    ("10c4", "ea70"): "Silicon Labs CP2105",
    ("067b", "2303"): "Prolific PL2303",
}
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _text(value: Any, limit: int = 128) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = _CONTROL.sub("", value).strip()
    return cleaned[:limit] or None


def _hex(value: Any) -> str | None:
    return f"{value:04x}" if isinstance(value, int) and 0 <= value <= 0xFFFF else None


def record(port: Any) -> dict[str, Any]:
    address = _text(getattr(port, "device", None), 256) or ""
    vid, pid = _hex(getattr(port, "vid", None)), _hex(getattr(port, "pid", None))
    serial = _text(getattr(port, "serial_number", None))
    if vid and pid and serial:
        identity, stable = f"usb:{vid}:{pid}:{serial}", True
    elif vid and pid:
        identity, stable = f"usb:{vid}:{pid}", False
    else:
        identity, stable = f"serial:{address}", False
    entry: dict[str, Any] = {
        "address": address,
        "identity": identity,
        "stable": stable,
        "vid": vid,
        "pid": pid,
        "serialNumber": serial,
        "description": _text(getattr(port, "description", None), 256),
        "manufacturer": _text(getattr(port, "manufacturer", None)),
    }
    bridge = BRIDGES.get((vid, pid)) if vid and pid else None
    if bridge:
        entry["bridge"] = bridge
    return entry


def listing() -> list[dict[str, Any]]:
    from serial.tools import list_ports

    return [record(port) for port in list_ports.comports()]


def _device(address: str) -> str:
    if os.name == "nt":
        return address.casefold()
    if address.startswith("/dev/"):
        try:
            return os.path.realpath(address)
        except OSError:
            return address
    return address


def same(left: str, right: str) -> bool:
    return _device(left) == _device(right)


def find(address: str, identity: str) -> dict[str, Any]:
    """The listed port `address`, refused when it is missing or shows another identity (REQ-SEC-dee0e930)."""
    if not address or len(address) > 256 or _CONTROL.search(address) or address.startswith("-"):
        raise Refused([problem("arguments", "--port takes a serial port name such as COM5 or /dev/ttyACM0.")])
    if not identity or len(identity) > 300 or _CONTROL.search(identity):
        raise Refused([problem("arguments", "--identity takes the identity key that the ports operation lists.")])
    for entry in listing():
        if same(entry["address"], address):
            if entry["identity"] != identity:
                raise Refused([problem("identity-mismatch", f"{address} shows the identity {entry['identity']}, not {identity}; list the ports again and choose the board.")])
            return entry
    raise Refused([problem("port-missing", f"{address} is not connected; list the ports again.")])


def with_identity(identity: str) -> dict[str, Any] | None:
    return next((entry for entry in listing() if entry["identity"] == identity), None)


def present(address: str) -> bool:
    try:
        return any(same(entry["address"], address) for entry in listing())
    except Exception:  # noqa: BLE001 - enumeration failure counts as absent
        return False

"""Serial ports from pyserial and their identity keys, as the micropython plugin keys them (REQ-FUNC-1bb6b2bb).

Identity: `usb:<vid>:<pid>:<serial number>` when the port reports a USB serial number (stable across ports), else
`usb:<vid>:<pid>` or `serial:<address>`, both unstable. A CircuitPython board's USB serial number is the UID its
boot_out.txt names, which binds its CIRCUITPY volume to the port (volumes.py).
"""

from __future__ import annotations

import os
import re
from typing import Any

from .report import Refused, problem

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
    return {
        "address": address,
        "identity": identity,
        "stable": stable,
        "vid": vid,
        "pid": pid,
        "serialNumber": serial,
        "description": _text(getattr(port, "description", None), 256),
        "manufacturer": _text(getattr(port, "manufacturer", None)),
    }


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


def check_address(address: str) -> None:
    if not address or len(address) > 256 or _CONTROL.search(address) or address.startswith("-"):
        raise Refused([problem("arguments", "--port takes a serial port name such as COM5 or /dev/ttyACM0.")])


def find(address: str, identity: str) -> dict[str, Any]:
    """The listed port `address`, refused when it is missing or shows another identity."""
    check_address(address)
    if not identity or len(identity) > 300 or _CONTROL.search(identity):
        raise Refused([problem("arguments", "--identity takes the identity key that the devices operation lists.")])
    for entry in listing():
        if same(entry["address"], address):
            if entry["identity"] != identity:
                raise Refused([problem("identity-mismatch", f"{address} shows the identity {entry['identity']}, not {identity}; list the devices again and choose the board.")])
            return entry
    raise Refused([problem("port-missing", f"{address} is not connected; list the devices again.")])

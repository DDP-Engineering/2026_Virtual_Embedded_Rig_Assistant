"""Serial ports from pyserial and their identity keys (REQ-FUNC-0163b91b, REQ-SEC-1c72e308).

Identity: `usb:<vid>:<pid>:<serial number>` when the port reports a USB serial number (stable), else `usb:<vid>:<pid>`
or `serial:<address>`, both unstable. Ports that share one stable identity are the interfaces of one USB device, as
the two serial ports of a Bus Pirate are; no adapter model is ever named from a VID:PID.
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
        "location": _text(getattr(port, "location", None)),
    }


def listing() -> list[dict[str, Any]]:
    from serial.tools import list_ports

    return [record(port) for port in list_ports.comports()]


def devices() -> dict[str, Any]:
    """The devices operation: every port, and the groups of ports that share one stable identity."""
    found = listing()
    groups: dict[str, list[str]] = {}
    for entry in found:
        if entry["stable"]:
            groups.setdefault(entry["identity"].lower(), []).append(entry["address"])
    return {
        "ports": found,
        "groups": [{"identity": identity, "ports": addresses} for identity, addresses in groups.items() if len(addresses) > 1],
    }


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


def check(resource: str, terminal: str, identity: str) -> dict[str, Any]:
    """Both ports of a bus adapter, listed with the declared identity; Refused before any port is opened."""
    found = listing()
    result: dict[str, Any] = {}
    for role, address in (("resource", resource), ("terminal", terminal)):
        entry = next((item for item in found if same(item["address"], address)), None)
        if entry is None:
            raise Refused([problem("port-missing", f"The adapter's {role} port {address} is not connected; list the devices again.")])
        if entry["identity"].lower() != identity.lower():
            raise Refused([problem("identity-mismatch", f"{address} shows the identity {entry['identity']}, not {identity}; check lab/resources.json against the devices list.")])
        result[role] = entry
    return result

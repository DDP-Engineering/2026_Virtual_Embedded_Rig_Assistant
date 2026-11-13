"""Serial ports from `arduino-cli board list`, their identity keys and what identifies a board.

Identity: `usb:<vid>:<pid>:<serial number>` when the port reports a USB serial number (stable across ports), else
`usb:<vid>:<pid>` or `serial:<address>`, both unstable. A common USB-to-serial bridge says nothing about the board
behind it, so its matches are only candidates and the port stays unidentified.
"""

from __future__ import annotations

import re
from typing import Any

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
_HEX = re.compile(r"(?:0x)?([0-9a-fA-F]{1,4})")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _hex(value: Any) -> str | None:
    match = _HEX.fullmatch(value.strip()) if isinstance(value, str) else None
    return match.group(1).lower().rjust(4, "0") if match else None


def _text(value: Any, limit: int = 128) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = _CONTROL.sub("", value).strip()
    return cleaned[:limit] or None


def base_fqbn(fqbn: str) -> str:
    return ":".join(fqbn.split(":")[:3])


def ports(document: Any) -> tuple[list[dict], int]:
    """The serial ports of a board list document and the number of other ports ignored."""
    entries = document.get("detected_ports") if isinstance(document, dict) else None
    found: list[dict] = []
    ignored = 0
    for entry in entries if isinstance(entries, list) else []:
        port = entry.get("port") if isinstance(entry, dict) else None
        if not isinstance(port, dict):
            continue
        address = _text(port.get("address"), 256)
        if port.get("protocol") != "serial" or not address:
            ignored += 1
            continue
        raw = port.get("properties")
        properties: dict[str, Any] = raw if isinstance(raw, dict) else {}
        vid, pid = _hex(properties.get("vid")), _hex(properties.get("pid"))
        serial = _text(properties.get("serialNumber"))
        if vid and pid and serial:
            identity, stable = f"usb:{vid}:{pid}:{serial}", True
        elif vid and pid:
            identity, stable = f"usb:{vid}:{pid}", False
        else:
            identity, stable = f"serial:{address}", False
        matches = []
        for board in entry.get("matching_boards") or []:
            if isinstance(board, dict) and isinstance(board.get("fqbn"), str):
                matches.append({"name": _text(board.get("name")) or board["fqbn"], "fqbn": board["fqbn"]})
        bridge = BRIDGES.get((vid, pid)) if vid and pid else None
        record: dict[str, Any] = {
            "address": address,
            "label": _text(port.get("label"), 256) or address,
            "identity": identity,
            "stable": stable,
            "vid": vid,
            "pid": pid,
            "serialNumber": serial,
            "identified": bool(matches) and bridge is None,
            "boards": matches if bridge is None else [],
        }
        if bridge:
            record["bridge"] = bridge
            record["candidates"] = matches
        found.append(record)
    return found, ignored


def same_address(left: str, right: str, windows: bool) -> bool:
    return left.casefold() == right.casefold() if windows else left == right

"""CIRCUITPY volumes: enumeration, boot_out.txt, identity, port binding and selection (spec REQ-DATA-8f309a53).

REQ-FUNC-1bb6b2bb (listing), REQ-FUNC-3f98ad97 (binding by UID), REQ-SEC-b561dad0 (missing / other identity),
REQ-SEC-8ddddfbb (ambiguous / insufficient identity for writes), REQ-REL-e00b3fb2 (firmware gate).

Test seam: $VERA_CIRCUITPYTHON_FAKE_BENCH names a JSON bench whose `volumes` [{path, label, serial, readOnly, free,
size, blockSize}] replace the enumeration and whose `faults` drive deploy failures (deploy.py). VERA's program runner
passes only an allowlist of host variables to a program, so a run started by VERA never sees it.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from typing import Any

from . import conventions, ports
from .report import Refused, problem

LABEL = "CIRCUITPY"
BOOT_OUT = "boot_out.txt"
BOOT_OUT_LIMIT = 4096
_DRIVE = re.compile(r"^([A-Za-z]):[\\/]?$")
_LINE = re.compile(
    r"^(?P<vendor>.*?)CircuitPython (?P<version>(?P<major>\d+)\.\d+\.\d+\S*) on (?P<date>[0-9-]+); (?P<board>.+?)(?: with (?P<mcu>.+))?$"
)
_UID = re.compile(r"^[0-9A-Fa-f]{4,64}$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def bench() -> dict[str, Any] | None:
    path = os.environ.get("VERA_CIRCUITPYTHON_FAKE_BENCH")
    if not path:
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def faults() -> dict[str, Any]:
    found = bench()
    return dict(found.get("faults") or {}) if found else {}


def _windows() -> list[dict[str, Any]]:
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.windll.kernel32  # type: ignore[attr-defined]
    found: list[dict[str, Any]] = []
    # SEM_FAILCRITICALERRORS: an empty card reader must not raise a "no disk" dialog.
    previous = kernel.SetErrorMode(1)
    try:
        mask = kernel.GetLogicalDrives()
        for index in range(26):
            if not mask & (1 << index):
                continue
            root = f"{chr(65 + index)}:\\"
            if kernel.GetDriveTypeW(root) not in (2, 3):  # removable or fixed; never network or optical
                continue
            name = ctypes.create_unicode_buffer(261)
            system = ctypes.create_unicode_buffer(261)
            serial, length, flags = wintypes.DWORD(), wintypes.DWORD(), wintypes.DWORD()
            if not kernel.GetVolumeInformationW(root, name, 261, ctypes.byref(serial), ctypes.byref(length), ctypes.byref(flags), system, 261):
                continue
            if name.value.upper() != LABEL:
                continue
            found.append({"path": root, "label": name.value, "serial": f"{serial.value:08X}", "readOnly": bool(flags.value & 0x80000)})
    finally:
        kernel.SetErrorMode(previous)
    return found


def _unescape(text: str) -> str:
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match.group(1), 8)), text)


def _links(folder: str) -> dict[str, str]:
    try:
        names = os.listdir(folder)
    except OSError:
        return {}
    return {os.path.realpath(os.path.join(folder, name)): _unescape(name.replace("\\x20", " ")) for name in names}


def _linux() -> list[dict[str, Any]]:
    labels = _links("/dev/disk/by-label")
    uuids = _links("/dev/disk/by-uuid")
    found: list[dict[str, Any]] = []
    try:
        with open("/proc/self/mounts", encoding="utf-8", errors="replace") as handle:
            lines = handle.read().splitlines()
    except OSError:
        return found
    for line in lines:
        fields = line.split()
        if len(fields) < 4:
            continue
        source, target, options = fields[0], _unescape(fields[1]), fields[3].split(",")
        device = os.path.realpath(source) if source.startswith("/dev/") else source
        label = labels.get(device)
        if label is None and re.fullmatch(r"CIRCUITPY\d*", os.path.basename(target)):
            label = LABEL
        if label is None or label.upper() != LABEL:
            continue
        uuid = uuids.get(device)
        found.append({"path": target, "label": label, "serial": uuid.replace("-", "").upper() if uuid else None, "readOnly": "ro" in options})
    return found


def mounted() -> list[dict[str, Any]]:
    """Mounted volumes labelled CIRCUITPY: {path, label, serial, readOnly} plus a bench's overrides."""
    found = bench()
    if found is not None:
        return [dict(item) for item in found.get("volumes", []) if str(item.get("label", "")).upper() == LABEL]
    return _windows() if os.name == "nt" else _linux()


def parse_boot_out(text: str) -> dict[str, Any] | None:
    """The firmware fields of a boot_out.txt; None when line 1 is not a CircuitPython banner."""
    lines = [line.strip() for line in text.replace("\r\n", "\n").split("\n")]
    found = _LINE.match(lines[0]) if lines else None
    if not found:
        return None
    firmware: dict[str, Any] = {
        "version": found.group("version")[:64],
        "major": int(found.group("major")),
        "date": found.group("date"),
        "board": _CONTROL.sub("", found.group("board"))[:128],
        "mcu": _CONTROL.sub("", found.group("mcu") or "")[:64] or None,
        "boardId": None,
        "uid": None,
    }
    for line in lines[1:6]:
        if line.startswith("Board ID:"):
            firmware["boardId"] = _CONTROL.sub("", line[9:].strip())[:128] or None
        elif line.startswith("UID:") and _UID.match(line[4:].strip()):
            firmware["uid"] = line[4:].strip().upper()
    return firmware


def read_firmware(root: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        path = root / BOOT_OUT
        if not path.is_file():
            return None, f"{BOOT_OUT} is missing"
        with open(path, "rb") as handle:
            data = handle.read(BOOT_OUT_LIMIT)
    except OSError as error:
        return None, f"{BOOT_OUT} cannot be read: {error.strerror or error}"
    firmware = parse_boot_out(data.decode("utf-8", "replace"))
    return (firmware, None) if firmware else (None, f"{BOOT_OUT} does not start with a CircuitPython banner")


def normalize(path: str) -> str:
    drive = _DRIVE.match(path)
    if drive:
        return f"{drive.group(1).upper()}:"
    try:
        resolved = os.path.realpath(path)
    except (OSError, ValueError):
        resolved = path
    resolved = resolved.rstrip("\\/") or resolved
    return resolved.casefold() if os.name == "nt" else resolved


def listing() -> dict[str, Any]:
    """`devices`: CIRCUITPY volumes with firmware and identity, and serial ports (REQ-FUNC-1bb6b2bb, -3f98ad97)."""
    try:
        serial_ports = ports.listing()
    except Exception:  # noqa: BLE001 - a volume listing must not fail on a serial enumeration error
        serial_ports = []
    volumes = []
    for raw in mounted():
        root = Path(raw["path"])
        firmware, trouble = read_firmware(root)
        entry: dict[str, Any] = {
            "path": raw["path"],
            "label": raw.get("label") or LABEL,
            "identity": None,
            "stable": False,
            "bound": False,
            "port": None,
            "readOnly": bool(raw.get("readOnly")),
            "firmware": firmware,
        }
        if trouble:
            entry["problem"] = trouble
        uid = firmware.get("uid") if firmware else None
        matches = [item for item in serial_ports if uid and (item.get("serialNumber") or "").upper() == uid]
        if uid and len(matches) == 1:
            entry.update({"identity": matches[0]["identity"], "stable": True, "bound": True, "port": matches[0]["address"]})
        elif uid:
            entry.update({"identity": f"circuitpy-uid:{uid.lower()}", "stable": True})
        elif raw.get("serial"):
            entry["identity"] = f"volume-serial:{str(raw['serial']).upper()}"
        volumes.append(entry)
    return {"volumes": volumes, "ports": serial_ports}


def select(volume: str, identity: str, write: bool) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The listed volume `--volume` with `--identity`, and all listed volumes; refusals before any file access."""
    if not volume or len(volume) > 1024 or _CONTROL.search(volume) or volume.startswith("-"):
        raise Refused([problem("arguments", "--volume takes the path of a mounted CIRCUITPY volume, such as E: or /media/user/CIRCUITPY.")])
    if not identity or len(identity) > 300 or _CONTROL.search(identity):
        raise Refused([problem("arguments", "--identity takes the identity key that the devices operation lists.")])
    found = listing()
    wanted = normalize(volume)
    entry = next((item for item in found["volumes"] if normalize(item["path"]) == wanted), None)
    if entry is None:
        raise Refused([problem("volume-missing", f"{volume} is not a mounted CIRCUITPY volume; list the devices again.")])
    if entry["identity"] is None:
        raise Refused([problem("identity-insufficient", f"{volume} has neither a UID nor a file-system serial; VERA cannot tell it from another board.")])
    if entry["identity"] != identity:
        raise Refused([problem("identity-mismatch", f"{volume} shows the identity {entry['identity']}, not {identity}; list the devices again and choose the board.")])
    if write:
        twins = [item for item in found["volumes"] if item is not entry and item["identity"] == entry["identity"]]
        if twins:
            raise Refused([problem("ambiguous", f"{len(twins) + 1} mounted volumes show the identity {identity}; unplug the others before writing.")])
    return entry, found["volumes"]


def require_firmware(entry: dict[str, Any]) -> dict[str, Any]:
    """The volume's firmware when its major is supported (REQ-REL-e00b3fb2), else Refused incompatible-firmware."""
    firmware = entry.get("firmware")
    majors = conventions.supported_majors()
    if not firmware:
        raise Refused([problem("incompatible-firmware", f"No CircuitPython firmware could be read: {entry.get('problem', 'boot_out.txt missing')}.")])
    if firmware["major"] not in majors:
        raise Refused([problem("incompatible-firmware", f"CircuitPython {firmware['version']} is not supported; circuitpython-tool needs CircuitPython {', '.join(map(str, majors))}.")])
    return firmware


def space(entry: dict[str, Any]) -> dict[str, int]:
    """Size, free bytes and allocation block of the volume (a bench may override them)."""
    raw = next((item for item in (bench() or {}).get("volumes", []) if normalize(item["path"]) == normalize(entry["path"])), {})
    usage = shutil.disk_usage(entry["path"])
    block = raw.get("blockSize")
    if block is None:
        block = _block_size(entry["path"])
    return {"size": int(raw.get("size", usage.total)), "free": int(raw.get("free", usage.free)), "blockSize": int(block)}


def _block_size(path: str) -> int:
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes

            sectors, size, free, total = wintypes.DWORD(), wintypes.DWORD(), wintypes.DWORD(), wintypes.DWORD()
            root = os.path.splitdrive(os.path.abspath(path))[0] + "\\"
            if ctypes.windll.kernel32.GetDiskFreeSpaceW(root, ctypes.byref(sectors), ctypes.byref(size), ctypes.byref(free), ctypes.byref(total)):  # type: ignore[attr-defined]
                return max(512, sectors.value * size.value)
            return 4096
        stat = os.statvfs(path)
        return max(512, stat.f_frsize or stat.f_bsize)
    except (OSError, AttributeError, ValueError):
        return 4096


def summary(entry: dict[str, Any]) -> dict[str, Any]:
    return {"path": entry["path"], "identity": entry["identity"], "stable": entry["stable"], "bound": entry["bound"], "port": entry["port"], "readOnly": entry["readOnly"]}

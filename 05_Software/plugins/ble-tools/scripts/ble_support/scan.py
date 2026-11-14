"""The bounded scan of ble-tool (spec REQ-DATA-e8502710 section 4): no connection, one entry per address, names that
several addresses advertise marked ambiguous, and registry or profile matches reported only as candidates
(REQ-FUNC-dd778299, REQ-SEC-98e5023f, REQ-PLAT-7938d880).
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from .backend import Backend
from .lifecycle import Lifecycle
from .profile import Profile, normalize_uuid
from .registry import Registry
from .report import Ended, refused

MANUFACTURER_BYTES = 31


def mode(args: Any, backend: Backend) -> str:
    if args.active:
        return "active"
    if backend.linux:
        raise refused(
            "passive-unsupported",
            "Passive scanning on Linux needs BlueZ advertisement-monitor patterns and bluetoothd's experimental mode, a global configuration ble-tool never changes; name --active (the adapter then sends scan requests).",
        )
    return "passive"


class Seen:
    def __init__(self, address: str) -> None:
        self.address = address
        self.names: list[str] = []
        self.rssi: list[int] = []
        self.services: list[str] = []
        self.manufacturers: dict[int, str] = {}
        self.tx_power: int | None = None
        self.count = 0
        self.first = time.monotonic()

    def add(self, ad: Any) -> None:
        self.count += 1
        if ad.local_name and ad.local_name not in self.names and len(self.names) < 4:
            self.names.append(str(ad.local_name)[:64])
        self.rssi.append(int(ad.rssi))
        for uuid in ad.service_uuids or []:
            normal = normalize_uuid(str(uuid)) or str(uuid)[:36]
            if normal not in self.services and len(self.services) < 16:
                self.services.append(normal)
        for company, data in (ad.manufacturer_data or {}).items():
            if len(self.manufacturers) < 8:
                self.manufacturers[int(company)] = bytes(data)[:MANUFACTURER_BYTES].hex()
        if ad.tx_power is not None:
            self.tx_power = int(ad.tx_power)


def _candidate(seen: Seen, profile: Profile | None, registry_alias: str | None) -> bool:
    if registry_alias:
        return True
    if profile is None or not profile.advertisement:
        return False
    hints = profile.advertisement
    if "serviceUuids" in hints and not set(hints["serviceUuids"]) <= set(seen.services):
        return False
    if "localName" in hints and hints["localName"] not in seen.names:
        return False
    if "manufacturerId" in hints and hints["manufacturerId"] not in seen.manufacturers:
        return False
    return True


async def _scan(backend: Backend, scanning: str, duration: int, limit: int, lifecycle: Lifecycle) -> tuple[dict[str, Seen], str]:
    seen: dict[str, Seen] = {}
    full = asyncio.Event()

    def detected(device: Any, ad: Any) -> None:
        address = str(device.address).upper()
        if address not in seen:
            if len(seen) >= limit:
                return
            seen[address] = Seen(address)
        seen[address].add(ad)
        if len(seen) >= limit:
            full.set()

    scanner = backend.bleak.BleakScanner(detected, scanning_mode=scanning)
    await scanner.start()
    ended = "duration"
    try:
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline:
            if full.is_set():
                ended = "max-devices"
                break
            if lifecycle.stop_requested():
                ended = "stopped"
                break
            await asyncio.sleep(0.1)
    finally:
        await scanner.stop()
    return seen, ended


def run(args: Any, document: dict[str, Any], backend: Backend, registry: Registry | None, profile: Profile | None, lifecycle: Lifecycle) -> None:
    scanning = mode(args, backend)
    limit = args.max_devices or 500
    document["scan"] = {"mode": scanning, "durationS": args.duration, "maxDevices": limit, "backend": backend.id}
    lifecycle.report("acting")
    try:
        seen, ended = asyncio.run(_scan(backend, scanning, args.duration, limit, lifecycle))
    except backend.exc.BleakError as error:
        raise backend.ended(error, "scanning") from error
    by_address = {device.address: alias for alias, device in (registry.devices.items() if registry else [])}
    names: dict[str, int] = {}
    for item in seen.values():
        for name in item.names:
            names[name] = names.get(name, 0) + 1
    advertisers = []
    for item in sorted(seen.values(), key=lambda value: value.address):
        alias = by_address.get(item.address)
        advertisers.append(
            {
                "address": item.address,
                "names": item.names,
                "rssiLast": item.rssi[-1] if item.rssi else None,
                "rssiMin": min(item.rssi) if item.rssi else None,
                "rssiMax": max(item.rssi) if item.rssi else None,
                "serviceUuids": item.services,
                "manufacturerIds": sorted(item.manufacturers),
                "manufacturerData": {str(key): value for key, value in sorted(item.manufacturers.items())},
                "txPower": item.tx_power,
                "count": item.count,
                "registryAlias": alias,
                "candidate": _candidate(item, profile, alias),
                "identity": "candidate" if _candidate(item, profile, alias) else None,
                "ambiguousName": any(names.get(name, 0) > 1 for name in item.names),
            }
        )
    document["scan"]["endedBy"] = ended
    document["scan"]["devices"] = len(advertisers)
    document["advertisers"] = advertisers
    ambiguous = sorted(name for name, count in names.items() if count > 1)
    if ambiguous:
        document["warnings"].append({"code": "ambiguous-name", "message": f"Several addresses advertise {', '.join(ambiguous)}; a name never identifies a device."})
    if ended == "stopped":
        raise Ended("incomplete", "stopped", "VERA asked the run to stop; the scan ended early.")

"""The device operations of ble-tool (spec REQ-DATA-e8502710 sections 4-8).

Order: registry, alias, profile and request checks (nothing on the radio), the backend, then one asyncio run: find,
connect, GATT check and identity, the operation, stop_notify and one disconnect (Link.close on every path).
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from typing import Any

from . import notify, registry, workspace, write
from . import profile as profiles
from .backend import Backend
from .device import Link
from .lifecycle import Lifecycle
from .report import Ended, Refused, refused

CONNECTED = ("identify", "discover-services", "read-characteristic", "subscribe-notifications", "write-characteristic")
OPERATIONS = (*CONNECTED, "release")
RELEASE_WAIT_S = 10.0


def load_profile(cwd: Path, spelled: Path, raw: str) -> profiles.Profile:
    try:
        file = workspace.regular_file(cwd, raw, "--profile", spelled)
    except workspace.PathRefused as error:
        raise refused("path", str(error)) from error
    return profiles.load(file, workspace.relative(cwd, file))


def _characteristic(args: Any, profile: profiles.Profile, operation: str) -> profiles.Characteristic:
    char = profile.characteristics.get(args.characteristic)
    if char is None:
        raise refused("operation-not-allowed", f"The profile declares no characteristic {args.characteristic}.")
    if operation not in char.operations:
        raise refused("operation-not-allowed", f"The profile does not allow {operation} on {char.name} (operations: {', '.join(char.operations)}).")
    if char.side_effects == "changes-state" and not args.side_effects:
        raise refused("side-effects-not-named", f"The profile declares that {operation} on {char.name} changes the device's state; name --side-effects to do it on purpose.")
    return char


def prepare(args: Any, cwd: Path, spelled: Path) -> tuple[registry.Device, profiles.Profile | None, Any]:
    """Every check that needs no radio (REQ-SEC-1c16a89f, REQ-SEC-ad7b56a7); returns entry, profile and request."""
    entry = registry.load().device(args.device)
    if entry.adapter is not None and sys.platform == "win32":
        raise refused("adapter-unsupported", f"lab/resources.json names the BlueZ adapter {entry.adapter} for {entry.alias}; Windows uses its one default adapter.")
    profile = load_profile(cwd, spelled, args.profile) if getattr(args, "profile", None) else None
    if profile is not None and profile.id != entry.profile:
        raise refused("profile-device", f"{entry.alias} follows profile {entry.profile} in lab/resources.json; {profile.path} is profile {profile.id}.")
    request: Any = None
    if args.operation == "read-characteristic":
        request = _characteristic(args, profile, "read")
    elif args.operation == "subscribe-notifications":
        request = _characteristic(args, profile, "notify")
    elif args.operation == "write-characteristic":
        request = write.plan(args, profile)
    return entry, profile, request


async def _connected(args: Any, document: dict[str, Any], link: Link, request: Any, folder: Path, cwd: Path) -> None:
    try:
        await link.open()
        if args.operation == "discover-services":
            document["services"] = link.gatt()
            if link.profile is not None:
                missing = link.mismatches()
                document["profileMismatches"] = missing
                if missing:
                    raise Ended("fail", "profile-mismatch", f"The device lacks what profile {link.profile.id} declares: {'; '.join(missing)}.", missing=missing)
            return
        await link.confirm()
        if args.operation in ("read-characteristic", "subscribe-notifications"):
            document["characteristic"] = request.name
            document["uuid"] = request.uuid
            document["schema"] = request.payload.summary()
        if args.operation == "read-characteristic":
            reads = document.setdefault("reads", [])
            for index in range(args.count):
                if index:
                    if await _pause(link, args.interval):
                        raise Ended("incomplete", "stopped", "VERA asked the run to stop; the remaining reads were not made.")
                link.lifecycle.report("acting")
                reads.append({"index": index + 1, **await link.read(request)})
        elif args.operation == "subscribe-notifications":
            await notify.capture(link, request, args, folder, cwd)
        elif args.operation == "write-characteristic":
            document["characteristic"] = request.char.name
            await write.send(link, request, document)
    finally:
        await link.close()


async def _pause(link: Link, seconds: float) -> bool:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if link.lifecycle.stop_requested():
            return True
        link.check_link()
        await asyncio.sleep(min(0.1, max(0.0, end - time.monotonic())))
    return link.lifecycle.stop_requested()


def run(args: Any, document: dict[str, Any], lifecycle: Lifecycle, entry: registry.Device, profile: profiles.Profile | None, request: Any, folder: Path, cwd: Path) -> None:
    backend = Backend()
    document["backend"] = backend.summary()
    if profile is not None:
        document["profile"] = {"path": profile.path, "id": profile.id, "pairing": profile.pairing}
    if args.operation == "release":
        release(document, lifecycle, entry, backend)
        return
    link = Link(backend, entry, profile, lifecycle, document)
    try:
        asyncio.run(_connected(args, document, link, request, folder, cwd))
    except backend.exc.BleakError as error:
        raise backend.ended(error, args.operation) from error


def release(document: dict[str, Any], lifecycle: Lifecycle, entry: registry.Device, backend: Backend) -> None:
    """VERA's cleanup: ends a connection this computer still holds to the device (REQ-REL-9b84dc0c)."""

    async def held() -> bool:
        extra = {"bluez": {"adapter": entry.adapter}} if entry.adapter and backend.linux else {}
        adapter = await backend.bleak.BleakAdapter.get(**extra)
        devices = await adapter.get_connected_devices()
        return any(str(device.address).upper() == entry.address for device in devices)

    async def disconnect() -> None:
        client = backend.bleak.BleakClient(entry.address, timeout=6.0, pair=False, **({"bluez": {"adapter": entry.adapter}} if entry.adapter else {}))
        await asyncio.wait_for(client.connect(), timeout=8.0)
        await asyncio.wait_for(client.disconnect(), timeout=5.0)

    async def run_release() -> str:
        end = time.monotonic() + RELEASE_WAIT_S
        tried = False
        while True:
            if not await held():
                return "released"
            if backend.linux and not tried:
                tried = True
                try:
                    await disconnect()
                except (asyncio.TimeoutError, backend.exc.BleakError):
                    pass
                continue
            if time.monotonic() >= end:
                return "held"
            await asyncio.sleep(0.25)

    document["device"] = {**entry.summary(), "identity": "unchecked"}
    lifecycle.report("cleaning")
    try:
        outcome = asyncio.run(run_release())
    except backend.exc.BleakError as error:
        lifecycle.physical = "unknown"
        raise backend.ended(error, "listing connected devices") from error
    document["release"] = {"held": outcome == "held"}
    if outcome == "released":
        lifecycle.physical = "confirmed"
        return
    lifecycle.physical = "unknown"
    raise Ended("incomplete", "held-by-system", f"The system still holds a connection to {entry.alias} after {RELEASE_WAIT_S:g} s (another application or the operating system); ble-tool cannot end it. Disconnect it in the Bluetooth settings if it must be free.")


__all__ = ["CONNECTED", "OPERATIONS", "Refused", "load_profile", "prepare", "run"]

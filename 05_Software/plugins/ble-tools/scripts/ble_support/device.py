"""One managed link to a registry device (spec REQ-DATA-e8502710 sections 4, 5 and 8): found by its address within the
profile's connect timeout, connected once with pairing off, its GATT database checked against the profile and its
identity confirmed before any profile characteristic is used. Nothing is retried and a lost link is never re-opened
(REQ-SEC-14b13f88, REQ-SEC-0a495d33, REQ-SEC-73fb6150, REQ-REL-74028483, REQ-SEC-ae588c69, REQ-REL-1b62b28c).
"""

from __future__ import annotations

import asyncio
from typing import Any

from . import payload as payloads
from .backend import Backend
from .lifecycle import Lifecycle
from .profile import Characteristic, Profile, normalize_uuid
from .registry import Device
from .report import Ended, stamp


class Link:
    def __init__(self, backend: Backend, entry: Device, profile: Profile | None, lifecycle: Lifecycle, document: dict[str, Any]) -> None:
        self.backend = backend
        self.entry = entry
        self.profile = profile
        self.lifecycle = lifecycle
        self.document = document
        self.client: Any = None
        self.chars: dict[str, Any] = {}
        self.lost = False
        self.subscribed: list[Any] = []
        self.subscription = "none"
        self.closed_cleanly = True
        document["device"] = {**entry.summary(), "identity": "unchecked"}
        document["link"] = {"connected": False, "disconnectedBy": None, "subscription": "none"}

    @property
    def timeout(self) -> float:
        return float(self.profile.limits["operationTimeoutS"]) if self.profile else 10.0

    def _lost(self, _client: Any) -> None:
        self.lost = True

    async def open(self) -> None:
        connect_timeout = float(self.profile.limits["connectTimeoutS"]) if self.profile else 20.0
        scanning = "active" if self.backend.linux else "passive"
        extra: dict[str, Any] = {"bluez": {"adapter": self.entry.adapter}} if self.entry.adapter else {}
        bleak = self.backend.bleak
        try:
            found = await bleak.BleakScanner.find_device_by_address(self.entry.address, timeout=connect_timeout, scanning_mode=scanning, **extra)
        except self.backend.exc.BleakError as error:
            raise self.backend.ended(error, "finding the device") from error
        if found is None:
            raise Ended("blocked", "not-found", f"{self.entry.alias} ({self.entry.address}) was not seen within {connect_timeout:g} s; nothing was connected. Check that it is powered, in range and advertising.")
        options: dict[str, Any] = {"timeout": connect_timeout, "pair": False}
        if self.backend.linux:
            options.update(extra)
        else:
            options["winrt"] = {"address_type": self.entry.address_type, "use_cached_services": False}
        self.client = bleak.BleakClient(found, disconnected_callback=self._lost, **options)
        self.lifecycle.report("start", "pending")
        try:
            await asyncio.wait_for(self.client.connect(), timeout=connect_timeout + 5)
        except asyncio.TimeoutError as error:
            raise Ended("blocked", "connect-timeout", f"Connecting to {self.entry.alias} took longer than {connect_timeout:g} s; it was attempted once.") from error
        except self.backend.exc.BleakError as error:
            ended = self.backend.ended(error, "connecting")
            if ended.problem["code"] == "gatt-error":
                ended = Ended("blocked", "connect-failed", f"Connecting to {self.entry.alias} failed once: {str(error)[:200]}")
            raise ended from error
        self.document["link"]["connected"] = True
        mtu = getattr(self.client, "mtu_size", None)
        self.document["device"]["mtu"] = mtu

    def gatt(self) -> list[dict[str, Any]]:
        """Every service, characteristic and descriptor the device exposes; no value is read (REQ-FUNC-aac8f787)."""
        services = []
        for service in self.client.services:
            chars = []
            for char in service.characteristics:
                chars.append(
                    {
                        "uuid": normalize_uuid(str(char.uuid)) or str(char.uuid),
                        "handle": int(char.handle),
                        "properties": sorted(str(prop) for prop in char.properties),
                        "descriptors": [{"uuid": normalize_uuid(str(d.uuid)) or str(d.uuid), "handle": int(d.handle)} for d in char.descriptors],
                    }
                )
            services.append({"uuid": normalize_uuid(str(service.uuid)) or str(service.uuid), "handle": int(service.handle), "characteristics": chars})
        return services

    def mismatches(self) -> list[str]:
        """What the profile declares and the device lacks; binds every profile characteristic to the device's."""
        assert self.profile is not None
        found: dict[tuple[str, str], Any] = {}
        services: set[str] = set()
        for service in self.client.services:
            suuid = normalize_uuid(str(service.uuid)) or str(service.uuid)
            services.add(suuid)
            for char in service.characteristics:
                found.setdefault((suuid, normalize_uuid(str(char.uuid)) or str(char.uuid)), char)
        missing = [f"service {uuid}" for uuid in self.profile.services if uuid not in services]
        for char in self.profile.characteristics.values():
            device = found.get((char.service, char.uuid))
            if device is None:
                if char.service in services:
                    missing.append(f"characteristic {char.name} ({char.uuid})")
                continue
            lacking = [prop for prop in char.properties if prop not in device.properties]
            if lacking:
                missing.append(f"{char.name} property {', '.join(lacking)}")
            else:
                self.chars[char.name] = device
        return missing

    async def confirm(self) -> None:
        """The identity check every read, subscription and write needs (REQ-SEC-14b13f88)."""
        missing = self.mismatches()
        if missing:
            self.document["device"]["identity"] = "mismatch"
            raise Ended("fail", "profile-mismatch", f"{self.entry.alias} does not match profile {self.profile.id}: missing {'; '.join(missing)}. Nothing was read or written.", missing=missing)
        self.lifecycle.report("identified")
        identity = self.profile.identity
        if identity is not None and self.entry.serial is not None:
            value = await self.read(identity)
            if not value["valid"] or value["value"] != self.entry.serial:
                self.document["device"]["identity"] = "mismatch"
                self.document["device"]["serial"] = value["value"]
                raise Ended("fail", "identity-mismatch", f"{self.entry.alias} reports {identity.name} {value['value']!r}, the registry expects {self.entry.serial!r}; this is another unit. Nothing else was read or written.")
            self.document["device"]["serial"] = value["value"]
        elif identity is not None or self.entry.serial is not None:
            self.document["warnings"].append({"code": "identity-unchecked", "message": "The profile declares no identity characteristic or the registry no serial; the unit is confirmed by its address and GATT database only."})
        self.document["device"]["identity"] = "confirmed"

    async def read(self, char: Characteristic) -> dict[str, Any]:
        self.check_link()
        try:
            data = await asyncio.wait_for(self.client.read_gatt_char(self.chars[char.name]), timeout=self.timeout)
        except asyncio.TimeoutError as error:
            raise Ended("incomplete", "timeout", f"Reading {char.name} took longer than {self.timeout:g} s; it was not repeated.") from error
        except self.backend.exc.BleakError as error:
            self.check_link()
            raise self.backend.ended(error, f"reading {char.name}") from error
        return {"characteristic": char.name, "uuid": char.uuid, "receivedAt": stamp(), **payloads.decode(char.payload, bytes(data))}

    def check_link(self) -> None:
        if self.lost:
            self.document["link"]["disconnectedBy"] = "device"
            raise Ended("incomplete", "disconnected", f"{self.entry.alias} disconnected; ble-tool does not reconnect or send anything again.")

    async def close(self) -> None:
        """Stops every subscription this run started, then disconnects once (REQ-REL-b1f75f03)."""
        if self.client is None:
            return
        self.lifecycle.report("cleaning")
        for char in self.subscribed:
            if self.lost:
                self.subscription = "unknown"
                break
            try:
                await asyncio.wait_for(self.client.stop_notify(char), timeout=self.timeout)
                self.subscription = "stopped"
            except Exception:  # noqa: BLE001 - any failure leaves the subscription's state unknown
                self.subscription = "unknown"
        self.document["link"]["subscription"] = self.subscription
        if not self.lost:
            try:
                await asyncio.wait_for(self.client.disconnect(), timeout=self.timeout)
                self.document["link"]["disconnectedBy"] = "helper"
            except Exception:  # noqa: BLE001 - any failure leaves the link's state unknown
                self.document["link"]["disconnectedBy"] = "unknown"
                self.closed_cleanly = False
        else:
            self.document["link"]["disconnectedBy"] = "device"
        self.document["link"]["connected"] = False
        clean = self.closed_cleanly and self.subscription != "unknown"
        self.lifecycle.physical = "confirmed" if clean else "unknown"

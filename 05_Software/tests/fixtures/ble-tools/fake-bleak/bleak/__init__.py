"""A fake Bleak 3.1.0 for the ble-tools tests: the API surface ble-tool uses, driven by a bench file.

FAKE_BLE_BENCH names a JSON bench (backend, adapter state, devices with advertisements, GATT tables, values,
notification streams and faults); every radio call is appended as one JSON line to FAKE_BLE_LOG; FAKE_BLE_STATE keeps
the connections the "system" holds and written values across processes. Offline evidence only, never proof of a radio.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, Callable

from .backends import BleakBackend, get_default_backend
from .exc import BleakBluetoothNotAvailableError, BleakBluetoothNotAvailableReason, BleakError, BleakGATTProtocolError

__all__ = ["BleakScanner", "BleakClient", "BleakAdapter", "BLEDevice", "AdvertisementData"]

BASE = "-0000-1000-8000-00805f9b34fb"


def _uuid(text: str) -> str:
    text = text.lower()
    if len(text) == 4:
        return f"0000{text}{BASE}"
    if len(text) == 8:
        return f"{text}{BASE}"
    return text


def bench() -> dict[str, Any]:
    with open(os.environ["FAKE_BLE_BENCH"], encoding="utf-8") as handle:
        return json.load(handle)


def log(event: str, **fields: Any) -> None:
    path = os.environ.get("FAKE_BLE_LOG")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"event": event, "t": round(time.time(), 3), **fields}) + "\n")


def _state() -> dict[str, Any]:
    path = os.environ.get("FAKE_BLE_STATE")
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    held = bench().get("connected", [])
    return {"connected": {address.upper(): time.time() + float(bench().get("dropAfter", 3600)) for address in held}, "values": {}}


def _save(state: dict[str, Any]) -> None:
    path = os.environ.get("FAKE_BLE_STATE")
    if path:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(state, handle)


def _adapter_check() -> None:
    state = bench().get("adapter", "on")
    reasons = {
        "missing": BleakBluetoothNotAvailableReason.NO_BLUETOOTH,
        "off": BleakBluetoothNotAvailableReason.POWERED_OFF,
        "denied": BleakBluetoothNotAvailableReason.DENIED_BY_USER,
    }
    if state in reasons:
        log("adapter-unavailable", state=state)
        raise BleakBluetoothNotAvailableError(f"Bluetooth {state}", reasons[state])


def _devices() -> list[dict[str, Any]]:
    return bench().get("devices", [])


class BLEDevice:
    def __init__(self, address: str, name: str | None, details: Any = None) -> None:
        self.address = address
        self.name = name
        self.details = details

    def __repr__(self) -> str:
        return f"BLEDevice({self.address}, {self.name})"


class AdvertisementData:
    def __init__(self, raw: dict[str, Any], rssi: int) -> None:
        self.local_name = raw.get("name")
        self.manufacturer_data = {int(key): bytes.fromhex(value) for key, value in (raw.get("manufacturer") or {}).items()}
        self.service_data: dict[str, bytes] = {}
        self.service_uuids = [_uuid(value) for value in raw.get("serviceUuids") or []]
        self.tx_power = raw.get("txPower")
        self.rssi = rssi
        self.platform_data = ()


class BleakScanner:
    def __init__(self, detection_callback: Callable | None = None, service_uuids: list[str] | None = None, scanning_mode: str = "active", *, bluez: dict | None = None, **kwargs: Any) -> None:
        self._callback = detection_callback
        self._mode = scanning_mode
        self._task: asyncio.Task | None = None
        self._bluez = bluez or {}

    async def _advertise(self) -> None:
        devices = [device for device in _devices() if device.get("advertise", True)]
        rounds = 0
        while True:
            for device in devices:
                rssi = device.get("rssi", [-60])
                ad = AdvertisementData(device, int(rssi[rounds % len(rssi)]))
                if self._callback:
                    self._callback(BLEDevice(device["address"], device.get("name")), ad)
            rounds += 1
            await asyncio.sleep(float(bench().get("advertiseInterval", 0.05)))

    async def start(self) -> None:
        if get_default_backend() == BleakBackend.BLUEZ_DBUS and self._mode == "passive":
            raise BleakError("passive scanning mode requires bluez or_patterns")
        _adapter_check()
        log("scanner-start", mode=self._mode, adapter=self._bluez.get("adapter"))
        self._task = asyncio.create_task(self._advertise())

    async def stop(self) -> None:
        log("scanner-stop")
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def __aenter__(self) -> "BleakScanner":
        await self.start()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.stop()

    @classmethod
    async def find_device_by_address(cls, device_identifier: str, timeout: float = 10.0, **kwargs: Any) -> BLEDevice | None:
        _adapter_check()
        log("find", address=device_identifier, timeout=timeout, mode=kwargs.get("scanning_mode", "active"))
        for device in _devices():
            if device["address"].lower() == device_identifier.lower() and device.get("advertise", True):
                await asyncio.sleep(0.01)
                return BLEDevice(device["address"], device.get("name"), {"fake": True})
        await asyncio.sleep(min(timeout, float(bench().get("findWait", timeout))))
        return None


class FakeDescriptor:
    def __init__(self, raw: dict[str, Any]) -> None:
        self.uuid = _uuid(raw["uuid"])
        self.handle = int(raw["handle"])


class FakeCharacteristic:
    def __init__(self, raw: dict[str, Any], service: "FakeService") -> None:
        self.raw = raw
        self.uuid = _uuid(raw["uuid"])
        self.handle = int(raw["handle"])
        self.properties = list(raw.get("properties", []))
        self.descriptors = [FakeDescriptor(item) for item in raw.get("descriptors", [])]
        self.service_uuid = service.uuid
        self.max_write_without_response_size = int(raw.get("maxWwr", 20))
        self.description = raw.get("description", "")


class FakeService:
    def __init__(self, raw: dict[str, Any]) -> None:
        self.uuid = _uuid(raw["uuid"])
        self.handle = int(raw.get("handle", 1))
        self.characteristics = [FakeCharacteristic(item, self) for item in raw.get("characteristics", [])]


class FakeServices:
    def __init__(self, services: list[FakeService]) -> None:
        self._services = services

    def __iter__(self):
        return iter(self._services)


class BleakClient:
    def __init__(self, address_or_ble_device: Any, disconnected_callback: Callable | None = None, services: Any = None, *, timeout: float = 30, pair: bool = False, bluez: dict | None = None, winrt: dict | None = None, **kwargs: Any) -> None:
        address = address_or_ble_device.address if isinstance(address_or_ble_device, BLEDevice) else str(address_or_ble_device)
        self.address = address
        self._device = next((device for device in _devices() if device["address"].lower() == address.lower()), None)
        self._callback = disconnected_callback
        self._timeout = timeout
        self._pair = pair
        self._winrt = winrt or {}
        self._bluez = bluez or {}
        self._connected = False
        self._notify: dict[int, asyncio.Task] = {}
        self._services = FakeServices([])
        self._faults = (self._device or {}).get("faults", {})

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def mtu_size(self) -> int:
        return int((self._device or {}).get("mtu", 23))

    @property
    def services(self) -> FakeServices:
        return self._services

    def _drop(self) -> None:
        if self._connected:
            self._connected = False
            log("device-disconnect", address=self.address)
            state = _state()
            state["connected"].pop(self.address.upper(), None)
            _save(state)
            for task in self._notify.values():
                task.cancel()
            if self._callback:
                self._callback(self)

    async def connect(self, **kwargs: Any) -> None:
        _adapter_check()
        log("connect", address=self.address, pair=self._pair, winrt=self._winrt, bluez=self._bluez, timeout=self._timeout)
        if self._device is None:
            raise BleakError(f"Device with address {self.address} was not found.")
        if self._faults.get("connectHang"):
            await asyncio.sleep(3600)
        if self._faults.get("connectFails"):
            raise BleakError("Could not connect: unreachable")
        self._connected = True
        self._services = FakeServices([FakeService(item) for item in self._device.get("services", [])])
        state = _state()
        # The "system" keeps the link for linkDropS after the process ends (VERA's release waits for it).
        state["connected"][self.address.upper()] = time.time() + float(bench().get("linkDropS", 3600))
        _save(state)
        loss = self._faults.get("disconnectAfterS")
        if loss is not None:
            asyncio.get_running_loop().call_later(float(loss), self._drop)

    async def disconnect(self) -> None:
        log("disconnect", address=self.address)
        self._connected = False
        for task in self._notify.values():
            task.cancel()
        state = _state()
        state["connected"].pop(self.address.upper(), None)
        _save(state)

    async def pair(self, *args: Any, **kwargs: Any) -> None:
        log("pair", address=self.address)

    async def unpair(self) -> None:
        log("unpair", address=self.address)

    def _value(self, char: FakeCharacteristic) -> bytes:
        state = _state()
        key = f"{self.address.upper()}/{char.uuid}"
        if key in state["values"]:
            return bytes.fromhex(state["values"][key])
        return bytes.fromhex(char.raw.get("value", ""))

    async def read_gatt_char(self, char_specifier: Any, **kwargs: Any) -> bytearray:
        char = char_specifier
        if not self._connected:
            raise BleakError("Not connected")
        log("read", address=self.address, uuid=char.uuid)
        if char.raw.get("readHang"):
            await asyncio.sleep(3600)
        if char.raw.get("readError") is not None:
            raise BleakGATTProtocolError(int(char.raw["readError"]))
        if char.raw.get("readDenied"):
            raise BleakError("Could not read characteristic handle 3: Access Denied")
        return bytearray(self._value(char))

    async def write_gatt_char(self, char_specifier: Any, data: bytes, response: bool | None = None) -> None:
        char = char_specifier
        if not self._connected:
            raise BleakError("Not connected")
        log("write", address=self.address, uuid=char.uuid, data=bytes(data).hex(), response=response)
        if char.raw.get("writeHang"):
            await asyncio.sleep(3600)
        if self._faults.get("disconnectOnWrite"):
            self._drop()
            raise BleakError("Not connected")
        if char.raw.get("writeUnreachable"):
            raise BleakError("Could not write value: Unreachable")
        if char.raw.get("writeError") is not None and response:
            raise BleakGATTProtocolError(int(char.raw["writeError"]))
        if not char.raw.get("ignoreWrite"):
            state = _state()
            state["values"][f"{self.address.upper()}/{char.uuid}"] = bytes(data).hex()
            _save(state)

    async def _stream(self, char: FakeCharacteristic, callback: Callable) -> None:
        stream = char.raw.get("notify", {})
        values = stream.get("values", [])
        interval = float(stream.get("interval", 0.05))
        repeat = bool(stream.get("repeat", False))
        index = 0
        while values and (repeat or index < len(values)):
            await asyncio.sleep(interval)
            callback(char, bytearray(bytes.fromhex(values[index % len(values)])))
            index += 1
            drop = self._faults.get("disconnectAfterNotifications")
            if drop is not None and index >= int(drop):
                self._drop()
                return

    async def start_notify(self, char_specifier: Any, callback: Callable, **kwargs: Any) -> None:
        char = char_specifier
        if not self._connected:
            raise BleakError("Not connected")
        log("start_notify", address=self.address, uuid=char.uuid)
        if char.raw.get("notifyError") is not None:
            raise BleakGATTProtocolError(int(char.raw["notifyError"]))
        self._notify[char.handle] = asyncio.create_task(self._stream(char, callback))

    async def stop_notify(self, char_specifier: Any) -> None:
        char = char_specifier
        log("stop_notify", address=self.address, uuid=char.uuid, connected=self._connected)
        task = self._notify.pop(char.handle, None)
        if task:
            task.cancel()
        if self._faults.get("stopNotifyFails"):
            raise BleakError("stop_notify failed")
        if not self._connected:
            raise BleakError("Not connected")


class BleakAdapter:
    def __init__(self, bluez: dict | None = None) -> None:
        self._bluez = bluez or {}

    @classmethod
    async def get(cls, *, bluez: dict | None = None, **kwargs: Any) -> "BleakAdapter":
        _adapter_check()
        return cls(bluez)

    async def get_connected_devices(self, service_uuids: list[str] = ["1801"]) -> list[BLEDevice]:
        state = _state()
        now = time.time()
        state["connected"] = {address: until for address, until in state["connected"].items() if until > now}
        _save(state)
        log("get_connected", count=len(state["connected"]))
        return [BLEDevice(address, None, {"held": True}) for address in state["connected"]]

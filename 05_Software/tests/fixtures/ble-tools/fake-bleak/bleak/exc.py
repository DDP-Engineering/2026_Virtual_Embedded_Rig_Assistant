"""Fake bleak.exc with the classes and codes of Bleak 3.1.0 that ble-tool uses."""

import enum
from typing import Any


class BleakError(Exception):
    pass


class BleakBluetoothNotAvailableReason(enum.Enum):
    NO_BLUETOOTH = enum.auto()
    NO_BLE_CENTRAL_ROLE = enum.auto()
    POWERED_OFF = enum.auto()
    DENIED_BY_USER = enum.auto()
    DENIED_BY_SYSTEM = enum.auto()
    DENIED_BY_UNKNOWN = enum.auto()
    UNKNOWN = enum.auto()


class BleakBluetoothNotAvailableError(BleakError):
    def __init__(self, msg: str, reason: BleakBluetoothNotAvailableReason) -> None:
        super().__init__(msg, reason)

    @property
    def reason(self) -> BleakBluetoothNotAvailableReason:
        return self.args[1]


class BleakDeviceNotFoundError(BleakError):
    def __init__(self, identifier: str, *args: object) -> None:
        super().__init__(*args)
        self.identifier = identifier


class BleakGATTProtocolErrorCode(enum.IntEnum):
    READ_NOT_PERMITTED = 0x02
    WRITE_NOT_PERMITTED = 0x03
    INSUFFICIENT_AUTHENTICATION = 0x05
    INSUFFICIENT_AUTHORIZATION = 0x08
    INSUFFICIENT_ENCRYPTION_KEY_SIZE = 0x0C
    INSUFFICIENT_ENCRYPTION = 0x0F
    VALUE_NOT_ALLOWED = 0x13

    @classmethod
    def _missing_(cls, value: Any):
        obj = int.__new__(cls, value)
        obj._value_ = value
        obj._name_ = f"{cls.__name__}[{value}]"
        return obj


class BleakGATTProtocolError(BleakError):
    def __init__(self, error_code: int) -> None:
        super().__init__(error_code, f"GATT Protocol Error: {error_code:#04x}")

    @property
    def code(self) -> BleakGATTProtocolErrorCode:
        return BleakGATTProtocolErrorCode(self.args[0])

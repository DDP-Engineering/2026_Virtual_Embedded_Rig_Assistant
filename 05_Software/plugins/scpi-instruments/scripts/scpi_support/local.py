"""Local enumeration for `discover-configured --list-local`: serial ports through pyserial and USBTMC devices through
pyusb, as VISA resource names. VISA's own resource listing is never used: pyvisa-py asks every transport for its
resources before filtering, and its TCPIP transport broadcasts on the network.
"""

from __future__ import annotations

import os
import re
from typing import Any

USBTMC_CLASS = 0xFE
USBTMC_SUBCLASS = 0x03


def serial_resources() -> list[str]:
    from serial.tools import list_ports  # noqa: PLC0415 - imported only for --list-local

    names = []
    for port in list_ports.comports():
        device = str(port.device)
        match = re.fullmatch(r"(?i)COM(\d+)", device)
        names.append(f"ASRL{match[1]}::INSTR" if match else f"ASRL{device}::INSTR")
    return sorted(names)


def _usbtmc(device: Any) -> bool:
    try:
        for configuration in device:
            for interface in configuration:
                if interface.bInterfaceClass == USBTMC_CLASS and interface.bInterfaceSubClass == USBTMC_SUBCLASS:
                    return True
    except Exception:  # noqa: BLE001 - a device whose descriptors cannot be read is not listed
        return False
    return False


def usb_resources() -> tuple[list[str], list[str]]:
    """USBTMC resources, and notes for devices whose serial number cannot be read (no access rights)."""
    import usb.core  # noqa: PLC0415

    names, notes = [], []
    for device in usb.core.find(find_all=True, custom_match=_usbtmc) or []:
        prefix = f"USB0::0x{device.idVendor:04X}::0x{device.idProduct:04X}"
        try:
            serial = device.serial_number
        except Exception as error:  # noqa: BLE001
            serial = None
            notes.append(f"{prefix}: the serial number cannot be read ({type(error).__name__}); check the device's access rights.")
        if serial:
            names.append(f"{prefix}::{serial}::INSTR")
    return sorted(names), notes


def platform_note() -> str | None:
    return "USBTMC on Windows needs a WinUSB/libusb driver bound to the device." if os.name == "nt" else None

"""The Bleak backend ble-tool uses (spec REQ-DATA-e8502710 section 1): the pinned Bleak, its WinRT backend on Windows 11
and BlueZ on Linux, and the mapping of Bleak's errors to result codes. Bleak is imported here, lazily, so the offline
operations need no Bluetooth stack.
"""

from __future__ import annotations

import sys
from importlib import metadata
from typing import Any

from . import BLEAK
from .report import Ended, refused

WINDOWS_MIN_BUILD = 22000
SUPPORTED = {"win_rt": "WinRT (Windows 11, build 22000 or newer)", "bluez_dbus": "BlueZ 5.55 or newer (D-Bus)"}
PAIRING = {0x05, 0x08, 0x0C, 0x0F}
NOT_PERMITTED = {0x02, 0x03}
REASONS = {
    "NO_BLUETOOTH": "no-bluetooth",
    "NO_BLE_CENTRAL_ROLE": "no-bluetooth",
    "POWERED_OFF": "powered-off",
    "DENIED_BY_USER": "denied",
    "DENIED_BY_SYSTEM": "denied",
    "DENIED_BY_UNKNOWN": "denied",
}


class Backend:
    """The imported Bleak and the backend it selected; created only after the request checks passed."""

    def __init__(self) -> None:
        try:
            installed = metadata.version("bleak")
        except metadata.PackageNotFoundError:
            installed = None
        if installed != BLEAK:
            raise refused("backend-version", f"ble-tool needs Bleak {BLEAK}; the installed Bleak is {installed or 'missing'}. Reinstall the plugin's program.")
        import bleak
        from bleak import backends, exc

        self.bleak = bleak
        self.exc = exc
        self.id = str(backends.get_default_backend().value)
        if self.id not in SUPPORTED:
            raise refused("os-unsupported", f"Bleak selected the {self.id} backend; ble-tool supports only {', '.join(SUPPORTED.values())}.")
        if self.id == "win_rt" and sys.platform == "win32" and sys.getwindowsversion().build < WINDOWS_MIN_BUILD:
            raise refused("os-unsupported", f"Windows build {sys.getwindowsversion().build} is older than Windows 11 (build {WINDOWS_MIN_BUILD}), which Bleak {BLEAK} requires.")

    @property
    def linux(self) -> bool:
        return self.id == "bluez_dbus"

    def summary(self) -> dict[str, Any]:
        return {"bleak": BLEAK, "backend": self.id, "description": SUPPORTED[self.id]}

    def ended(self, error: BaseException, during: str) -> Ended:
        """The result of a Bleak error raised while `during`; never retried by the caller."""
        exc = self.exc
        if isinstance(error, exc.BleakBluetoothNotAvailableError):
            reason = REASONS.get(getattr(error.reason, "name", ""), "unknown")
            return Ended("blocked", "adapter-unavailable", f"The Bluetooth adapter is not available ({reason}); ble-tool never switches the radio on or changes Bluetooth settings.", adapterReason=reason)
        if isinstance(error, exc.BleakGATTProtocolError):
            code = int(error.code)
            if code in PAIRING:
                return pairing(during, f"ATT error {code:#04x}")
            if code in NOT_PERMITTED:
                return Ended("fail", "not-permitted", f"The device does not permit {during} (ATT error {code:#04x}).", attError=code)
            return Ended("fail", "gatt-error", f"The device answered {during} with ATT error {code:#04x}.", attError=code)
        text = str(error)
        if "access denied" in text.lower() or "accessdenied" in text.lower():
            return pairing(during, "access denied")
        if "BlueZ" in text and ">=" in text:
            return Ended("blocked", "os-unsupported", f"{text[:200]}")
        return Ended("incomplete", "gatt-error", f"{during} failed: {type(error).__name__}: {text[:200]}")


def pairing(during: str, detail: str) -> Ended:
    return Ended(
        "blocked",
        "pairing-required",
        f"The device needs pairing or encryption for {during} ({detail}). Pair it in the operating system's Bluetooth settings (the device may show or ask for a PIN there), then run again; ble-tool never pairs, unpairs or enters a PIN.",
    )

"""Fake bleak.backends: the backend follows the bench's `backend` field (win_rt, bluez_dbus or another id)."""

import enum
import json
import os


class BleakBackend(str, enum.Enum):
    P4ANDROID = "p4android"
    ANDROID = "android"
    BLUEZ_DBUS = "bluez_dbus"
    PYTHONISTA_CB = "pythonista_cb"
    CORE_BLUETOOTH = "core_bluetooth"
    WIN_RT = "win_rt"


def get_default_backend() -> BleakBackend:
    with open(os.environ["FAKE_BLE_BENCH"], encoding="utf-8") as handle:
        return BleakBackend(json.load(handle).get("backend", "win_rt"))

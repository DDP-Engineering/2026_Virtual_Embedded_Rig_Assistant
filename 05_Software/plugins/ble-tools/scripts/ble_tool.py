# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "bleak==3.1.0",
#   "winrt-runtime==4.1.0; sys_platform == 'win32'",
#   "winrt-windows-devices-bluetooth==4!10.0.28000.2957; sys_platform == 'win32'",
#   "winrt-windows-devices-bluetooth-advertisement==4!10.0.28000.2957; sys_platform == 'win32'",
#   "winrt-windows-devices-bluetooth-genericattributeprofile==4!10.0.28000.2957; sys_platform == 'win32'",
#   "winrt-windows-devices-enumeration==4!10.0.28000.2957; sys_platform == 'win32'",
#   "winrt-windows-devices-radios==4!10.0.28000.2957; sys_platform == 'win32'",
#   "winrt-windows-foundation==4!10.0.28000.2957; sys_platform == 'win32'",
#   "winrt-windows-foundation-collections==4!10.0.28000.2957; sys_platform == 'win32'",
#   "winrt-windows-storage-streams==4!10.0.28000.2957; sys_platform == 'win32'",
#   "typing-extensions==4.16.0; sys_platform == 'win32'",
#   "dbus-fast==5.2.0; sys_platform == 'linux'",
# ]
# ///
"""Bounded BLE discovery and profile-bound GATT operations for VERA (program `ble-tool` of the ble-tools plugin).

Operations: capabilities, scan, identify, discover-services, read-characteristic, subscribe-notifications,
write-characteristic, release, report. The engine is Bleak 3.1.0 (WinRT on Windows 11, BlueZ on Linux) in the central
role only; a device is a `ble-device` entry of lab/resources.json ($BLE_REGISTRY) checked against a profile file. Exit
codes: 0 pass, 1 fail, 2 blocked, 3 incomplete or error.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ble_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

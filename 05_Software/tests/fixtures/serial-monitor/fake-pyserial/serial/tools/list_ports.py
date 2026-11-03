"""Fake serial.tools.list_ports: the scenario's "ports" entries, as pyserial's ListPortInfo fields."""

from serial import scenario


class ListPortInfo:
    def __init__(self, entry):
        self.device = entry["device"]
        self.vid = entry.get("vid")
        self.pid = entry.get("pid")
        self.serial_number = entry.get("serial_number")
        self.description = entry.get("description", "n/a")
        self.manufacturer = entry.get("manufacturer")
        self.product = entry.get("product")
        self.hwid = entry.get("hwid", "n/a")


def comports(include_links=False):
    return [ListPortInfo(entry) for entry in scenario().get("ports", [])]

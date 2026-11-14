"""Fake serial.tools.list_ports: the ports of the bus-tools bench."""

from types import SimpleNamespace

import fake_bus_pirate as fake


def comports(include_links=False):
    return [
        SimpleNamespace(
            device=entry["device"],
            vid=entry.get("vid"),
            pid=entry.get("pid"),
            serial_number=entry.get("serial_number"),
            description=entry.get("description", "n/a"),
            manufacturer=entry.get("manufacturer"),
            location=entry.get("location"),
        )
        for entry in fake.ports()
    ]

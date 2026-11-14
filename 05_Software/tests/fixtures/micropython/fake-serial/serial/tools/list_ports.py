"""Fake serial.tools.list_ports: the ports of the fake bench (after unplugs and hard resets)."""

from types import SimpleNamespace

import fake_mpy_board as fake


def comports(include_links=False):
    fake.log("list ports")
    found = []
    for entry in fake.ports():
        found.append(
            SimpleNamespace(
                device=entry["device"],
                vid=entry.get("vid"),
                pid=entry.get("pid"),
                serial_number=entry.get("serial_number"),
                description=entry.get("description", "n/a"),
                manufacturer=entry.get("manufacturer"),
                product=entry.get("product"),
                hwid=entry.get("hwid", "n/a"),
            )
        )
    return found


def grep(regexp, include_links=False):
    import re

    return [port for port in comports() if re.search(regexp, port.device, re.I)]

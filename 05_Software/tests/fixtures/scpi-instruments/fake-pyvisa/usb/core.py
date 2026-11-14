"""Fake usb.core: the devices of $FAKE_VISA_BENCH `local.usb` ({vid, pid, serial, class, subclass})."""

import json
import os
from types import SimpleNamespace


class NoBackendError(ValueError):
    pass


class _Device(SimpleNamespace):
    def __iter__(self):
        interface = SimpleNamespace(bInterfaceClass=self.cls, bInterfaceSubClass=self.subclass)
        return iter([[interface]])


def find(find_all=False, custom_match=None):
    with open(os.environ["FAKE_VISA_BENCH"], encoding="utf-8") as handle:
        bench = json.load(handle)
    with open(os.environ["FAKE_VISA_LOG"], "a", encoding="utf-8", newline="\n") as log:
        log.write("LOCAL usb\n")
    local = bench.get("local", {})
    if local.get("noLibusb"):
        raise NoBackendError("No backend available")
    devices = [
        _Device(idVendor=d["vid"], idProduct=d["pid"], serial_number=d.get("serial"), cls=d["class"], subclass=d["subclass"])
        for d in local.get("usb", [])
    ]
    return [d for d in devices if custom_match is None or custom_match(d)]

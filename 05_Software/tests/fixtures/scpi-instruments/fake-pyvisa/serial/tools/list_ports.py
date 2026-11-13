"""Fake serial.tools.list_ports: the ports of $FAKE_VISA_BENCH `local.serial`."""

import json
import os
from types import SimpleNamespace


def comports():
    with open(os.environ["FAKE_VISA_BENCH"], encoding="utf-8") as handle:
        bench = json.load(handle)
    with open(os.environ["FAKE_VISA_LOG"], "a", encoding="utf-8", newline="\n") as log:
        log.write("LOCAL serial\n")
    return [SimpleNamespace(device=name) for name in bench.get("local", {}).get("serial", [])]

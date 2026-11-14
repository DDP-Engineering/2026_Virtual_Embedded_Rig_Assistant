"""Fake pyserial 3.5 for the bus-tools tests: the ports and the Bus Pirate come from fake_bus_pirate ($FAKE_BUS_BENCH)."""

from __future__ import annotations

import fake_bus_pirate as fake

VERSION = "3.5"
__version__ = "3.5"


class SerialException(OSError):
    pass


class Serial:
    def __init__(self, port=None, baudrate=115200, timeout=None, write_timeout=None, **kwargs):
        self.port = port
        self.timeout = timeout
        entry = next((item for item in fake.ports() if fake.same(item["device"], port)), None)
        if entry is None:
            raise SerialException(2, f"could not open port '{port}': FileNotFoundError")
        fake.log({"event": "open", "port": port, "role": entry.get("role")})
        self.adapter = fake.Adapter(entry)
        self.role = entry.get("role")

    def write(self, data) -> int:
        if self.role != "binary":
            fake.log({"event": "write-other", "port": self.port, "bytes": len(data)})
            return len(data)
        try:
            self.adapter.feed(bytes(data))
        except OSError as error:
            raise SerialException(*error.args) from error
        return len(data)

    def read(self, size: int = 1) -> bytes:
        try:
            return self.adapter.take(size, self.timeout)
        except OSError as error:
            raise SerialException(*error.args) from error

    def reset_input_buffer(self) -> None:
        self.adapter.outbox.clear()

    def close(self) -> None:
        if not self.adapter.closed:
            self.adapter.closed = True
            fake.log({"event": "close", "port": self.port})

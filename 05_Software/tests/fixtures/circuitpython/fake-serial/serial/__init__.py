"""Fake pyserial 3.5 for the circuitpython tests: ports and consoles come from fake_cpy_board ($FAKE_CPY_BENCH)."""

from __future__ import annotations

import fake_cpy_board as fake

VERSION = "3.5"
__version__ = "3.5"


class SerialException(OSError):
    pass


class Serial:
    def __init__(self, port=None, baudrate=115200, timeout=None, **kwargs):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        entry = next((item for item in fake.ports() if fake.same(item["device"], port)), None)
        if entry is None or not entry.get("volume"):
            raise SerialException(2, f"could not open port '{port}': FileNotFoundError")
        fake.log(f"open {port}")
        self.board = fake.Board(entry)

    def write(self, data) -> int:
        self.board.feed(bytes(data))
        return len(data)

    def read(self, size: int = 1) -> bytes:
        return self.board.take(size, self.timeout)

    @property
    def in_waiting(self) -> int:
        return self.board.pending()

    def close(self) -> None:
        if not self.board.closed:
            self.board.closed = True
            fake.log(f"close {self.port}")

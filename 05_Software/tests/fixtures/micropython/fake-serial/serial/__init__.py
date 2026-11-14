"""Fake pyserial 3.5 for the micropython tests: ports and boards come from fake_mpy_board ($FAKE_MPY_BENCH)."""

from __future__ import annotations

import time

import fake_mpy_board as fake

VERSION = "3.5"
__version__ = "3.5"


class SerialException(OSError):
    pass


class SerialTimeoutException(SerialException):
    pass


def serial_for_url(url, *args, do_not_open=False, **kwargs):
    port = Serial(None, **kwargs)
    port.port = url
    if not do_not_open:
        port.open()
    return port


class Serial:
    def __init__(self, port=None, baudrate=115200, timeout=None, exclusive=None, interCharTimeout=None, **kwargs):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.dtr = True
        self.rts = True
        self.board: fake.Board | None = None
        if port is not None:
            self.open()

    def open(self) -> None:
        entry = next((item for item in fake.ports() if fake.same(item["device"], self.port)), None)
        if entry is None or not entry.get("board"):
            raise SerialException(2, f"could not open port '{self.port}': FileNotFoundError")
        if entry.get("busy"):
            raise SerialException(13, f"could not open port '{self.port}': PermissionError")
        fake.log(f"open {self.port}")
        self.board = fake.Board(self.port, entry["board"])

    def isOpen(self) -> bool:
        return self.board is not None and not self.board.closed

    @property
    def is_open(self) -> bool:
        return self.isOpen()

    def close(self) -> None:
        if self.board is not None and not self.board.closed:
            self.board.closed = True
            fake.log(f"close {self.port}")

    def _board(self) -> fake.Board:
        if self.board is None or self.board.closed:
            raise SerialException("Attempting to use a port that is not open")
        return self.board

    def write(self, data) -> int:
        try:
            self._board().feed(bytes(data))
        except fake.Lost as error:
            raise SerialException(5, "write failed: the device disconnected") from error
        return len(data)

    def read(self, size: int = 1) -> bytes:
        try:
            return self._board().take(size, self.timeout)
        except fake.Lost as error:
            raise SerialException("device reports readiness to read but returned no data (device disconnected?)") from error

    def inWaiting(self) -> int:
        try:
            return self._board().pending()
        except fake.Lost as error:
            raise SerialException(5, "ClearCommError failed: the device disconnected") from error

    @property
    def in_waiting(self) -> int:
        return self.inWaiting()

    def reset_input_buffer(self) -> None:
        while self.inWaiting():
            self.read(self.inWaiting())

    def flush(self) -> None:
        time.sleep(0)

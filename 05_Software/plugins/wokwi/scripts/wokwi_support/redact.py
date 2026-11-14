"""Removes the Wokwi token from every byte wokwi-tool writes from wokwi-cli's output (REQ-SEC-046ce69f)."""

from __future__ import annotations

from pathlib import Path

MARK = b"[redacted]"


class Redactor:
    """A streaming replacement: the last len(secret)-1 bytes wait for the next chunk, so a split token is caught."""

    def __init__(self, secret: str) -> None:
        self.secret = secret.encode("utf-8")
        self.tail = b""

    def feed(self, chunk: bytes) -> bytes:
        data = (self.tail + chunk).replace(self.secret, MARK)
        keep = len(self.secret) - 1
        if keep <= 0 or len(data) <= keep:
            self.tail = data if keep > 0 else b""
            return b"" if keep > 0 else data
        self.tail = data[-keep:]
        return data[:-keep]

    def flush(self) -> bytes:
        data, self.tail = self.tail.replace(self.secret, MARK), b""
        return data


def scrub_file(path: Path, secret: str) -> None:
    """Rewrites a file that wokwi-cli wrote itself (the serial log) when it holds the token."""
    try:
        data = path.read_bytes()
    except OSError:
        return
    token = secret.encode("utf-8")
    if token and token in data:
        path.write_bytes(data.replace(token, MARK))

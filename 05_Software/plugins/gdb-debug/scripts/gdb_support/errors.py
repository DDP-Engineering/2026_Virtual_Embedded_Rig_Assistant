"""Refusals and problems of the gdb-debug helpers (spec REQ-DATA-d7da2a71 section 6)."""

from __future__ import annotations


class Refused(Exception):
    """A request refused before any process starts or any folder is written: exit 2."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class Problem(Exception):
    """A failure after the run folder exists; `status` is the result status it sets."""

    def __init__(self, code: str, message: str, status: str = "error") -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status

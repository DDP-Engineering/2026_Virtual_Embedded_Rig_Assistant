"""Refusals and problems of the power-profiler helpers (spec REQ-DATA-dd3e4fe1 section 8)."""

from __future__ import annotations


class Refused(Exception):
    """A request refused before any device call or any folder: exit 2, nothing written."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class Problem(Exception):
    """A failure after the run started; `status` is the result status it sets."""

    def __init__(self, code: str, message: str, status: str = "error") -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status

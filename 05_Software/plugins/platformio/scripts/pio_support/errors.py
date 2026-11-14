"""Refusals of the platformio helpers (spec REQ-DATA-865c8fbd section 3)."""

from __future__ import annotations


class Refused(Exception):
    """A request refused before a run folder exists or any process starts (exit 2, nothing written)."""

    def __init__(self, code: str, message: str, detail: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}

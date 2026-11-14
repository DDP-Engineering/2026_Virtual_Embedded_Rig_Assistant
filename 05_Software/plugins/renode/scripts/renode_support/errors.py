"""Refusals and problems of renode-sim (spec REQ-DATA-8a943977 section 7)."""

from __future__ import annotations


class Refused(Exception):
    """A request refused before a run folder exists (exit 2), or, once a folder exists, a blocked run."""

    def __init__(self, code: str, message: str, detail: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}


class EngineError(Exception):
    """The engine could not start, ended unexpectedly or answered outside the protocol."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message

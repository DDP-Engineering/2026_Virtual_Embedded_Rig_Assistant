"""The one refusal of lab-validate: a request, path or source it will not compute with (exit 2, nothing written)."""

from __future__ import annotations


class Refused(Exception):
    """Codes: request, path, source, source-changed, domain, quantity, clock, limit."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message[:600]

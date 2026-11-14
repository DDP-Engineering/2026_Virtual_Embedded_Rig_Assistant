"""Errors of the fake PyVISA."""


class VisaIOError(Exception):
    def __init__(self, error_code: int) -> None:
        super().__init__(f"VI_ERROR {error_code}")
        self.error_code = error_code

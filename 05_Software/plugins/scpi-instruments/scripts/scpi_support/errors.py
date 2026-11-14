"""Problems of the scpi helper: each carries the result status, the exit code and a problem code."""

from __future__ import annotations


class Problem(Exception):
    """An operation that cannot go on. `status` and `exit` follow spec REQ-DATA-b3e2930f section 4."""

    status = "error"
    exit = 3

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class Refused(Problem):
    """The request is invalid; nothing was sent to any instrument."""

    status = "error"
    exit = 2


class Blocked(Problem):
    """A precondition is not met (identity, profile, state, driver, absent device); no effect was caused."""

    status = "blocked"
    exit = 2


class Failed(Problem):
    """The instrument did not do what was asked (a readback disagrees)."""

    status = "fail"
    exit = 1


class Incomplete(Problem):
    """I/O ended before the operation finished: timeout, truncated transfer, lost connection, stop request."""

    status = "incomplete"
    exit = 3

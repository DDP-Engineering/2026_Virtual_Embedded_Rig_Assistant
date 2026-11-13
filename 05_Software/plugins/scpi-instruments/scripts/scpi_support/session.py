"""One VISA session through PyVISA, with distinct diagnostics (spec REQ-DATA-b3e2930f section 4).

PyVISA is imported here only, when an operation opens an instrument, so `--version`, `capabilities` and `decode`
run without it. Every session and resource manager opened is closed on every path (`close`).
"""

from __future__ import annotations

from typing import Any

from .errors import Blocked, Incomplete, Problem
from .lifecycle import Lifecycle
from .profiles import Identity, Profile, matches, parse_identity
from .waveform import BlockError, parse_header

# VISA status codes (VISA specification, signed 32-bit).
TIMEOUT = -1073807339  # VI_ERROR_TMO
NOT_FOUND = -1073807343  # VI_ERROR_RSRC_NFOUND
CONNECTION_LOST = -1073807194  # VI_ERROR_CONN_LOST
IO_ERROR = -1073807298  # VI_ERROR_IO
LIBRARY_MISSING = -1073807202  # VI_ERROR_LIBRARY_NFOUND
DRIVER_HINTS = ("install", "not supported", "pyusb", "libusb", "no backend", "could not locate", "could not open visa")


def import_pyvisa() -> Any:
    try:
        import pyvisa  # noqa: PLC0415 - imported only when an instrument is used
    except ImportError as error:
        raise Blocked("driver-missing", f"PyVISA is not installed for this program ({error}); install the plugin's programs again.") from error
    return pyvisa


def versions() -> dict[str, str | None]:
    """The PyVISA and pyvisa-py versions, without importing their transports."""
    found: dict[str, str | None] = {"pyvisa": None, "pyvisaPy": None}
    try:
        from importlib.metadata import PackageNotFoundError, version  # noqa: PLC0415

        for name, key in (("PyVISA", "pyvisa"), ("PyVISA-py", "pyvisaPy")):
            try:
                found[key] = version(name)
            except PackageNotFoundError:
                pass
    except ImportError:
        pass
    if found["pyvisa"] is None:
        try:
            import pyvisa  # noqa: PLC0415

            found["pyvisa"] = getattr(pyvisa, "__version__", None)
        except ImportError:
            pass
    return found


def classify(error: BaseException, action: str) -> Problem:
    """A VISA or driver exception as a distinct problem."""
    code = getattr(error, "error_code", None)
    text = f"{type(error).__name__}: {error}"[:300]
    if code == TIMEOUT:
        return Incomplete("visa-timeout", f"The instrument did not answer in time while {action} ({text}).")
    if code == NOT_FOUND:
        return Blocked("instrument-absent", f"The instrument is not connected or not reachable ({text}).")
    if code in (CONNECTION_LOST, IO_ERROR):
        return Incomplete("connection-lost", f"The connection was lost while {action} ({text}).")
    if code == LIBRARY_MISSING or type(error).__name__ == "NoBackendError":
        return Blocked("driver-missing", f"A VISA library or transport driver is missing ({text}).")
    if isinstance(error, (ValueError, OSError, ImportError)) and any(hint in str(error).lower() for hint in DRIVER_HINTS):
        return Blocked("driver-missing", f"The transport driver for this resource is missing ({text}).")
    if isinstance(error, OSError) and code is None:
        return Blocked("instrument-absent", f"The instrument cannot be opened ({text}).")
    return Incomplete("connection-lost", f"VISA failed while {action} ({text}).")


class Session:
    """A PyVISA session to one declared resource, opened with the profile's terminators and timeout."""

    def __init__(self, resource: str, backend: str, profile: Profile, lifecycle: Lifecycle) -> None:
        self.resource = resource
        self.backend = backend
        self.profile = profile
        self.lifecycle = lifecycle
        self.manager: Any = None
        self.instrument: Any = None
        self.identity: Identity | None = None
        self.transcript: list[str] = []

    def open(self) -> None:
        pyvisa = import_pyvisa()
        try:
            self.manager = pyvisa.ResourceManager("@py" if self.backend == "py" else "@ivi")
        except Exception as error:  # noqa: BLE001 - every library failure is a diagnosis
            raise Blocked("driver-missing", f"The VISA backend cannot start ({type(error).__name__}: {error})"[:300]) from error
        transport = self.profile.transport
        try:
            self.instrument = self.manager.open_resource(
                self.resource,
                read_termination=transport["readTermination"],
                write_termination=transport["writeTermination"],
                timeout=transport["timeoutMs"],
                open_timeout=transport["timeoutMs"],
            )
        except Exception as error:  # noqa: BLE001
            raise classify(error, "opening the resource") from error

    def close(self) -> None:
        for target in (self.instrument, self.manager):
            if target is not None:
                try:
                    target.close()
                except Exception:  # noqa: BLE001, S110 - closing is best effort
                    pass
        self.instrument = None
        self.manager = None

    def write(self, command: str) -> None:
        self.transcript.append(command)
        try:
            self.instrument.write(command)
        except Exception as error:  # noqa: BLE001
            raise classify(error, f"sending {command!r}") from error

    def query(self, command: str) -> str:
        self.transcript.append(command)
        try:
            return str(self.instrument.query(command)).strip()
        except Exception as error:  # noqa: BLE001
            raise classify(error, f"querying {command!r}") from error

    def query_value(self, command: str) -> tuple[float, str]:
        """A numeric reply and its raw text; `unexpected-reply` when it is not a finite number."""
        reply = self.query(command)
        try:
            value = float(reply)
        except ValueError as error:
            raise Incomplete("unexpected-reply", f"{command!r} returned {reply[:60]!r}, not a number.") from error
        if value != value or value in (float("inf"), float("-inf")):
            raise Incomplete("unexpected-reply", f"{command!r} returned {reply[:60]!r}, not a finite number.")
        return value, reply

    def query_float(self, command: str) -> float:
        return self.query_value(command)[0]

    def block(self, command: str, limit: int) -> bytes:
        """Sends a query and reads its IEEE 488.2 definite-length block in chunks; a short block is truncated, a block
        announcing more than `limit` bytes is refused before its data is read."""
        self.write(command)
        try:
            head = bytes(self.instrument.read_bytes(2, break_on_termchar=False))
            digits = int(chr(head[1])) if len(head) == 2 and head[:1] == b"#" and chr(head[1]).isdigit() else 0
            rest = bytes(self.instrument.read_bytes(digits, break_on_termchar=False)) if digits else b""
            length = parse_header(head + rest)
        except BlockError as error:
            raise Incomplete("truncated-transfer", f"{command!r}: {error}") from error
        except Exception as error:  # noqa: BLE001
            raise classify(error, f"reading the block header of {command!r}") from error
        if length > limit:
            raise Incomplete("limit", f"{command!r} announces {length} bytes, more than the profile's {limit}.")
        data = bytearray()
        chunk = int(self.profile.transport.get("chunkBytes", 20480))
        while len(data) < length:
            if self.lifecycle.stop_requested():
                raise Incomplete("stopped", "A stop request ended the transfer.")
            try:
                data += bytes(self.instrument.read_bytes(min(chunk, length - len(data)), break_on_termchar=False))
            except Exception as error:  # noqa: BLE001
                problem = classify(error, f"reading {command!r}")
                if problem.code in ("visa-timeout", "connection-lost"):
                    raise Incomplete(
                        "truncated-transfer",
                        f"{command!r} announced {length} bytes, {len(data)} arrived ({problem.message})",
                    ) from error
                raise problem from error
        if self.profile.transport.get("blockTerminator"):
            try:
                self.instrument.read_bytes(len(self.profile.transport["readTermination"]), break_on_termchar=False)
            except Exception:  # noqa: BLE001, S110 - a missing terminator after a complete block is harmless
                pass
        return bytes(data)

    def identify(self, entry_serial: str | None) -> Identity:
        """`*IDN?` checked against the profile and the declared serial number; Blocked on any mismatch."""
        identity = parse_identity(self.query("*IDN?"))
        self.identity = identity
        reason = matches(self.profile, identity)
        if reason is None and entry_serial is not None and identity.serial.casefold() != entry_serial.casefold():
            reason = f"serial number {identity.serial!r} is not the declared {entry_serial!r}"
        if reason is not None:
            raise Blocked("identity-mismatch", f"The instrument does not match profile {self.profile.id}: {reason}.")
        return identity

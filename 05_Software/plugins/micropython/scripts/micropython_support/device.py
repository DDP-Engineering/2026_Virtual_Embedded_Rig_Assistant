"""One session with a MicroPython board through mpremote's serial transport (spec REQ-DATA-cb0ccbea).

The session opens the identified port, enters the raw REPL (Ctrl-C interrupts the running program; `soft_reset`
asks for a clean interpreter), refuses firmware other than MicroPython 1.22 or newer before anything else
(REQ-REL-2eaebfec), sends only the fixed snippets below, and on the way out leaves the raw REPL, restarts the program
when asked and closes the port, so no REPL session stays open. A lost connection becomes `disconnected`, `device-reset`
or `no-response` (REQ-REL-8d35cfbd).
"""

from __future__ import annotations

import ast
import contextlib
import io
import re
import time
from typing import Any

from . import ports
from .report import Ended, Refused, problem

MINIMUM = (1, 22, 0)
CHUNK_WRITE = 256
CHUNK_READ = 512
_ERRNO = {"ENOENT": 2, "EIO": 5, "EACCES": 13, "EEXIST": 17, "ENOTDIR": 20, "EISDIR": 21, "EINVAL": 22, "ENOSPC": 28, "ENOTEMPTY": 39}

FIRMWARE = "import sys\nprint(repr((sys.implementation.name,tuple(sys.implementation.version[:3]))))"
IDENTIFY = """import sys,os,gc
try:
 import machine
 u=''.join('%02x'%b for b in machine.unique_id())
except Exception:
 u=None
gc.collect()
try:
 s=os.statvfs('/')
 v=(s[1]*s[2],s[1]*s[4],s[0])
except Exception:
 v=None
try:
 n=os.uname()
 r=n[2]
except Exception:
 r=None
i=sys.implementation
print(repr((getattr(i,'_machine',None),sys.platform,r,u,gc.mem_free(),v,getattr(i,'_mpy',None))))"""
STAT = "import os\ns=os.stat(%r)\nprint(repr((s[0]&0x4000!=0,s[6])))"
STATVFS = "import os\ns=os.statvfs(%r)\nprint(repr((s[1]*s[2],s[1]*s[4],s[0])))"
HASH = """try:
 import hashlib
except ImportError:
 hashlib=None
if hashlib is None:
 print('None')
else:
 import binascii
 h=hashlib.sha256()
 b=bytearray(512)
 with open(%r,'rb') as f:
  while 1:
   n=f.readinto(b)
   if not n:
    break
   h.update(b[:n])
 print(repr(binascii.hexlify(h.digest()).decode()))"""
WALK = """import os
r=[]
o=0
def w(p,d):
 global o
 for e in os.ilistdir(p):
  f=(p if p!='/' else '')+'/'+e[0]
  t=e[1]&0x4000!=0
  if len(r)<%d:
   r.append((f,t,0 if t else (e[3] if len(e)>3 else 0)))
  else:
   o+=1
  if t and d<%d:
   w(f,d+1)
w(%r,1)
print(repr((r,o)))"""
REMOVE = "import os\nos.remove(%r)"
MKDIR = "import os\nos.mkdir(%r)"
RENAME = "import os\nos.rename(%r,%r)"
HARD_RESET = "import time, machine; time.sleep_ms(100); machine.reset()"


class BoardOSError(Exception):
    def __init__(self, errno: int, text: str) -> None:
        super().__init__(text)
        self.errno = errno


class BoardError(Exception):
    """The board raised an exception other than OSError while running a snippet."""


def _errno(text: str) -> int | None:
    if "OSError" not in text:
        return None
    match = re.search(r"OSError: \[Errno (\d+)\]", text) or re.search(r"OSError: (-?\d+)\s*$", text.strip())
    if match:
        return abs(int(match.group(1)))
    for name, value in _ERRNO.items():
        if name in text:
            return value
    return None


def version_text(version: tuple) -> str:
    return ".".join(str(part) for part in version)


class Recorder:
    """The transport's serial port, keeping the bytes read since the current exchange began (at most 4 KiB): a reboot
    banner that mpremote reads and drops while it waits for an end marker is still there when a failure is classified,
    and nothing read before the exchange is."""

    KEEP = 4096

    def __init__(self, port: Any) -> None:
        self._port = port
        self.recent = bytearray()

    def clear(self) -> None:
        """Starts a new exchange: only bytes read from now on can show a reboot."""
        self.recent.clear()

    def read(self, size: int = 1) -> bytes:
        data = self._port.read(size)
        self.recent.extend(data)
        del self.recent[: -self.KEEP]
        return data

    def __getattr__(self, name: str) -> Any:
        return getattr(self._port, name)

    def __setattr__(self, name: str, value: Any) -> None:
        if name in ("_port", "recent"):
            object.__setattr__(self, name, value)
        else:
            setattr(self._port, name, value)


class Session:
    def __init__(self, entry: dict[str, Any], baud: int, document: dict[str, Any]) -> None:
        self.entry = entry
        self.address = entry["address"]
        self.baud = baud
        self.document = document
        self.transport: Any = None
        self.raw = False
        self.incompatible = False
        self.broken = False
        document["port"] = {"address": self.address, "identity": entry["identity"], "stable": entry["stable"]}

    # -- connection ----------------------------------------------------------------------------------------
    def open(self, repl: bool = True, soft_reset: bool = False) -> None:
        from mpremote.transport_serial import SerialTransport

        try:
            with contextlib.redirect_stdout(io.StringIO()):
                # A read timeout bounds mpremote's blocking reads (the "OK" and raw-paste answers) on a silent board.
                self.transport = SerialTransport(self.address, baudrate=self.baud, timeout=10)
            self.transport.serial = Recorder(self.transport.serial)
        except Exception as error:  # noqa: BLE001 - TransportError, SerialException, OSError
            raise Refused([problem("port-open-failed", f"{self.address} cannot be opened: {str(error)[:200]}. Close other programs that use it.")]) from error
        if not repl:
            return
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                self.transport.enter_raw_repl(soft_reset=soft_reset)
        except Exception as error:  # noqa: BLE001
            raise self.lost(error, no_answer="no-repl") from error
        self.raw = True
        self.document["application"] = "interrupted"
        self.firmware()

    def firmware(self) -> None:
        name, version = self.value(FIRMWARE)
        version = tuple(int(part) for part in version)
        self.document["firmware"] = {"implementation": name, "version": version_text(version)}
        if name != "micropython" or version < MINIMUM:
            self.incompatible = True
            raise Refused(
                [problem("incompatible-firmware", f"The board runs {name} {version_text(version)}; micropython-tool needs MicroPython {version_text(MINIMUM)} or newer. Install compatible firmware with the right tool first.")],
                firmware=self.document["firmware"],
            )

    def finish(self, restart: bool = False) -> None:
        """Leaves the raw REPL, restarts the program when asked and closes the port; never raises."""
        transport, self.transport = self.transport, None
        if transport is None:
            return
        if self.broken:
            # The board stopped answering: try once to interrupt a snippet and leave the raw REPL.
            with contextlib.suppress(Exception):
                transport.serial.write(b"\r\x03\x03\x02")
            with contextlib.suppress(Exception):
                transport.close()
            return
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                if self.raw:
                    transport.exit_raw_repl()
                    self.raw = False
                if restart and not self.incompatible:
                    self.document["application"] = "restarted" if self._restart(transport) else "unknown"
        except Exception:  # noqa: BLE001
            self.document["application"] = "unknown"
        with contextlib.suppress(Exception):
            transport.close()

    @staticmethod
    def _restart(transport: Any) -> bool:
        transport.serial.write(b"\x04")
        return transport.read_until(1, b"soft reboot", timeout=5, timeout_overall=5).endswith(b"soft reboot")

    def restart_now(self) -> bool:
        """Leaves the raw REPL and soft-resets so boot.py and main.py run again (capture-output --restart)."""
        transport = self.transport
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                transport.exit_raw_repl()
            self.raw = False
            time.sleep(0.2)
            while transport.serial.inWaiting():
                transport.serial.read(transport.serial.inWaiting())
            return self._restart(transport)
        except Exception as error:  # noqa: BLE001
            raise self.lost(error) from error

    def lost(self, error: BaseException, no_answer: str = "no-response") -> Ended:
        """What a failed exchange means: the port left, the board restarted, or it stopped answering."""
        seen = str(error).encode("utf-8", "replace")
        with contextlib.suppress(Exception):
            seen += bytes(self.transport.serial.recent)
        with contextlib.suppress(Exception):
            end = time.monotonic() + 1.0
            while time.monotonic() < end:
                waiting = self.transport.serial.inWaiting()
                if waiting:
                    seen += self.transport.serial.read(waiting)
                else:
                    time.sleep(0.05)
        self.document["application"] = "unknown"
        self.raw = False
        self.broken = True
        if not ports.present(self.address):
            return Ended("error", "disconnected", f"{self.address} disappeared during the operation (unplugged or re-enumerated).")
        if b"soft reboot" in seen or b"MicroPython v" in seen:
            return Ended("error", "device-reset", "The board restarted during the operation.")
        if no_answer == "no-repl":
            return Ended("error", "no-repl", "The board did not answer with MicroPython's raw REPL.")
        return Ended("error", "no-response", f"The board stopped answering: {str(error)[:200]}")

    # -- snippets ------------------------------------------------------------------------------------------
    def run(self, code: str, timeout: float = 10) -> str:
        """Runs one snippet; BoardOSError/BoardError for an exception on the board, Ended when the link fails."""
        try:
            self.transport.serial.clear()
            with contextlib.redirect_stdout(io.StringIO()):
                out, err = self.transport.exec_raw(code, timeout=timeout)
        except Exception as error:  # noqa: BLE001 - serial and transport failures
            raise self.lost(error) from error
        if err:
            text = err.decode("utf-8", "replace")
            number = _errno(text)
            if number is not None:
                raise BoardOSError(number, text)
            raise BoardError(text)
        return out.decode("utf-8", "replace")

    def value(self, code: str, timeout: float = 10) -> Any:
        """The snippet's answer: its last output line that is a Python literal (a timer callback may print too)."""
        for line in reversed(self.run(code, timeout).strip().splitlines()):
            try:
                return ast.literal_eval(line.strip())
            except (ValueError, SyntaxError):
                continue
        raise BoardError("The board gave no answer to a micropython-tool snippet.")

    def send(self, code: str) -> None:
        """Starts code without waiting for its end (run-file, hard reset)."""
        try:
            self.transport.serial.clear()
            with contextlib.redirect_stdout(io.StringIO()):
                self.transport.exec_raw_no_follow(code)
        except Exception as error:  # noqa: BLE001
            raise self.lost(error) from error

    def stat(self, path: str) -> tuple[bool, int] | None:
        try:
            return tuple(self.value(STAT % path))  # type: ignore[return-value]
        except BoardOSError as error:
            if error.errno == 2:
                return None
            raise

    def statvfs(self, path: str) -> dict[str, int] | None:
        try:
            size, free, block = self.value(STATVFS % path)
        except (BoardOSError, BoardError):
            return None
        return {"size": size, "free": free, "blockSize": block}

    def sha256(self, path: str) -> str | None:
        """The board's SHA-256 of a file, or None when it has no hashlib."""
        return self.value(HASH % path, timeout=30)

    def read(self, path: str) -> bytes:
        self.run("f=open(%r,'rb')\nr=f.read" % path)
        data = bytearray()
        while True:
            chunk = self.value("print(repr(r(%d)))" % CHUNK_READ)
            if not chunk:
                break
            data.extend(chunk)
        self.run("f.close()")
        return bytes(data)

    def walk(self, path: str, depth: int, limit: int) -> tuple[list, int]:
        entries, omitted = self.value(WALK % (limit, depth, path), timeout=60)
        return entries, omitted

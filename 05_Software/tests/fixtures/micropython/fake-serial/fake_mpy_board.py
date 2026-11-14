"""A simulated MicroPython board behind the fake pyserial (offline evidence only, never proof of a real board).

$FAKE_MPY_BENCH names a JSON bench: `ports` [{device, vid?, pid?, serial_number?, description?, board?}] and `boards`
{name: {fs (host folder), fsSize, blockSize, firmware {name, version, machine, platform, release, mpy, uniqueId},
hashlib, renameOverExisting, rawPaste, app, faults}}. $FAKE_MPY_STATE (JSON, written here) overrides the port list after an
unplug or a hard reset; $FAKE_MPY_LOG receives one line per event (open, close, exec, soft-reset, restart, ...).

The board speaks the raw REPL as MicroPython 1.2x does: Ctrl-A enters it, Ctrl-D on an empty buffer soft-resets,
Ctrl-D after code answers "OK", runs the code and sends stdout, 0x04, the traceback, 0x04 and ">"; Ctrl-B leaves it;
raw-paste (0x05 'A' 0x01) is refused with "R\\x00", or with `rawPaste` accepted with a 128-byte window (flow
control 0x01, end 0x04 acknowledged with 0x04). Code runs in CPython with small fakes of os, sys, machine, gc,
hashlib and time over the host folder `fs`. Faults (`faults`): disconnectAfterChunks, resetAfterChunks, silentAfterChunks,
noSpaceAfterBytes, corruptWrites, renameErrno, concurrentWrite {path, afterChunks, content}, slowChunks (seconds), hardResetPort,
hardResetLost. A "chunk" is a code submission starting with `w(b` (the helper's write snippet).
"""

from __future__ import annotations

import binascii
import hashlib as _hashlib
import json
import os
import shutil
import struct
import threading
import time
import traceback

ERRNO = {2: "ENOENT", 5: "EIO", 13: "EACCES", 17: "EEXIST", 20: "ENOTDIR", 21: "EISDIR", 22: "EINVAL", 28: "ENOSPC", 39: "ENOTEMPTY"}
RAW_PROMPT = b"raw REPL; CTRL-B to exit\r\n>"
WINDOW = 128


def log(line: str) -> None:
    path = os.environ.get("FAKE_MPY_LOG")
    if path:
        with open(path, "a", encoding="utf-8", newline="\n") as handle:
            handle.write(line.replace("\n", "\\n")[:200] + "\n")


def bench() -> dict:
    with open(os.environ["FAKE_MPY_BENCH"], encoding="utf-8") as handle:
        return json.load(handle)


def ports() -> list[dict]:
    state = os.environ.get("FAKE_MPY_STATE")
    if state and os.path.exists(state):
        with open(state, encoding="utf-8") as handle:
            return json.load(handle)["ports"]
    return bench()["ports"]


def save_ports(entries: list[dict]) -> None:
    with open(os.environ["FAKE_MPY_STATE"], "w", encoding="utf-8", newline="\n") as handle:
        json.dump({"ports": entries}, handle)


def same(left: str, right: str) -> bool:
    return left.casefold() == right.casefold() if os.name == "nt" else left == right


class Lost(Exception):
    """The board went away (unplug or reboot) while code ran."""


class Interrupt(BaseException):
    pass


class Board:
    def __init__(self, port: str, name: str) -> None:
        self.port = port
        self.name = name
        self.config = bench()["boards"][name]
        self.faults = self.config.get("faults", {})
        self.root = os.path.abspath(self.config["fs"])
        self.lock = threading.Condition()
        self.out = bytearray()
        self.mode = "app" if self.config.get("app") else "friendly"
        self.buffer = bytearray()
        self.paste = False
        self.pasted = 0
        self.running: threading.Thread | None = None
        self.interrupted = False
        self.lost = False
        self.closed = False
        self.chunks = 0
        self.written = 0
        self.globals: dict = {}
        self.last_tick = time.monotonic()
        self.ticks = 0

    # -- serial side -------------------------------------------------------------------------------------------
    def emit(self, data: bytes) -> None:
        with self.lock:
            self.out.extend(data)
            self.lock.notify_all()

    def _app(self) -> None:
        if self.mode == "app" and not self.lost and time.monotonic() - self.last_tick >= 0.1:
            self.last_tick = time.monotonic()
            self.ticks += 1
            self.emit(f"{self.config['app']} {self.ticks}\r\n".encode())

    def pending(self) -> int:
        self._app()
        with self.lock:
            if self.lost and not self.out:
                raise Lost()
            return len(self.out)

    def take(self, count: int, timeout: float | None) -> bytes:
        end = time.monotonic() + (30 if timeout is None else timeout)
        with self.lock:
            while len(self.out) < count and time.monotonic() < end:
                if self.lost:
                    break
                self.lock.wait(0.01)
                self.lock.release()
                try:
                    self._app()
                finally:
                    self.lock.acquire()
            if self.lost and not self.out:
                raise Lost()
            data = bytes(self.out[:count])
            del self.out[:count]
            return data

    def feed(self, data: bytes) -> None:
        if self.lost:
            raise Lost()
        for value in data:
            self._byte(bytes([value]))

    def _byte(self, byte: bytes) -> None:
        if self.mode == "app":
            if byte == b"\x03":
                log("interrupt")
                self.mode = "friendly"
                self.emit(b"\r\nTraceback (most recent call last):\r\nKeyboardInterrupt: \r\n>>> ")
            return
        if self.mode == "friendly":
            if byte == b"\x01":
                self.mode = "raw"
                self.buffer.clear()
                self.emit(b"\r\n" + RAW_PROMPT)
            elif byte == b"\x04":
                self._soft_reset(run_main=True)
            elif byte == b"\x03":
                self.emit(b"\r\n>>> ")
            elif byte == b"\x02":
                self.emit(self._banner())
            return
        # raw REPL
        if self.running is not None and self.running.is_alive():
            if byte == b"\x03":
                self.interrupted = True
            return
        if self.paste:
            if byte == b"\x04":
                self.paste = False
                self.emit(b"\x04")
                code = bytes(self.buffer).decode("utf-8", "replace")
                self.buffer.clear()
                self._submit(code, paste=True)
            else:
                self.buffer.extend(byte)
                self.pasted += 1
                if self.pasted % WINDOW == 0:
                    self.emit(b"\x01")
            return
        if byte == b"\x01" and self.buffer == b"\x05A":
            self.buffer.clear()
            if self.config.get("rawPaste"):
                self.paste = True
                self.pasted = 0
                self.emit(b"R\x01" + struct.pack("<H", WINDOW))
            else:
                # Raw-paste refused: the client falls back to the plain raw REPL.
                self.emit(b"R\x00")
        elif byte == b"\x01":
            self.buffer.clear()
            self.emit(b"\r\n" + RAW_PROMPT)
        elif byte == b"\x02":
            log("raw-exit")
            self.mode = "friendly"
            self.emit(self._banner())
        elif byte == b"\x03":
            self.buffer.clear()
        elif byte == b"\x04":
            if not self.buffer:
                self._soft_reset(run_main=False)
                self.emit(RAW_PROMPT)
            else:
                code = bytes(self.buffer).decode("utf-8", "replace")
                self.buffer.clear()
                self._submit(code)
        else:
            self.buffer.extend(byte)

    def _banner(self) -> bytes:
        firmware = self.config["firmware"]
        return f"\r\nMicroPython v{firmware.get('release', '1.24.1')} on 2024-11-29; {firmware['machine']}\r\nType \"help()\" for more information.\r\n>>> ".encode()

    def _soft_reset(self, run_main: bool) -> None:
        self.globals = {}
        if run_main:
            log("restart")
            self.emit(b"MPY: soft reboot\r\n")
            self.mode = "app" if self.config.get("app") else "friendly"
            if self.mode == "friendly":
                self.emit(self._banner())
        else:
            log("soft-reset")
            self.emit(b"OK\r\nMPY: soft reboot\r\n")

    def _submit(self, code: str, paste: bool = False) -> None:
        first = code.strip().splitlines()[0] if code.strip() else ""
        if code.startswith("w(b"):
            self.chunks += 1
            if self.faults.get("slowChunks"):
                time.sleep(self.faults["slowChunks"])
            if self.chunks > self.faults.get("disconnectAfterChunks", 1 << 30):
                log("unplugged")
                save_ports([entry for entry in ports() if not same(entry["device"], self.port)])
                self.lost = True
                return
            if self.chunks > self.faults.get("silentAfterChunks", 1 << 30):
                # The board stops answering while its port stays listed.
                log("silent")
                return
            if self.chunks > self.faults.get("resetAfterChunks", 1 << 30):
                # A brown-out while the chunk runs: the board accepted the code, then reboots without end markers.
                log("rebooted")
                if not paste:
                    self.emit(b"OK")
                self.mode = "friendly"
                self.globals = {}
                self.emit(b"\r\n" + self._banner().lstrip(b"\r\n"))
                return
        else:
            log(f"exec {first}")
        if not paste:
            self.emit(b"OK")
        self.interrupted = False
        self.running = threading.Thread(target=self._execute, args=(code,), daemon=True)
        self.running.start()

    def _execute(self, code: str) -> None:
        error = ""
        try:
            namespace = self.globals
            namespace.setdefault("__builtins__", self._builtins())
            exec(compile(code, "<stdin>", "exec"), namespace)
        except Lost:
            return
        except _Reset:
            return
        except Interrupt:
            error = "Traceback (most recent call last):\r\n  File \"<stdin>\", line 1, in <module>\r\nKeyboardInterrupt: \r\n"
        except BaseException as exc:  # noqa: BLE001 - the board reports every exception as a traceback
            error = self._traceback(exc)
        if code.startswith("w(b"):
            fault = self.faults.get("concurrentWrite")
            if fault and self.chunks == fault.get("afterChunks", 1):
                with open(self._host(fault["path"]), "w", encoding="utf-8", newline="\n") as handle:
                    handle.write(fault["content"])
        self.emit(b"\x04" + error.encode() + b"\x04>")

    def _traceback(self, exc: BaseException) -> str:
        line = 1
        for frame in traceback.extract_tb(exc.__traceback__):
            if frame.filename == "<stdin>":
                line = frame.lineno or 1
        if isinstance(exc, OSError) and exc.args and isinstance(exc.args[0], int):
            text = f"OSError: [Errno {exc.args[0]}] {ERRNO.get(exc.args[0], '')}"
        else:
            text = f"{type(exc).__name__}: {exc}"
        return f"Traceback (most recent call last):\r\n  File \"<stdin>\", line {line}, in <module>\r\n{text}\r\n"

    # -- MicroPython side --------------------------------------------------------------------------------------
    def _host(self, path: str) -> str:
        path = path or "/"
        if not path.startswith("/"):
            path = "/" + path
        full = os.path.abspath(os.path.join(self.root, path.lstrip("/")))
        if full != self.root and not full.startswith(self.root + os.sep):
            raise OSError(22)
        return full

    def _used(self) -> int:
        block = self.config.get("blockSize", 4096)
        total = 0
        for folder, _, names in os.walk(self.root):
            for name in names:
                total += -(-os.path.getsize(os.path.join(folder, name)) // block) * block
        return total

    def _builtins(self) -> dict:
        import builtins

        board = self
        allowed = dict(vars(builtins))

        def board_print(*values, sep=" ", end="\n"):
            board.emit((sep.join(str(value) for value in values) + end).replace("\n", "\r\n").encode())

        def board_open(path, mode="r"):
            if board.lost:
                raise Lost()
            host = board._host(path)
            if os.path.isdir(host):
                raise OSError(21)
            if "r" in mode and not os.path.exists(host):
                raise OSError(2)
            if not os.path.isdir(os.path.dirname(host)):
                raise OSError(2)
            handle = open(host, mode) if "b" in mode else open(host, mode, encoding="utf-8", newline="")
            if "w" in mode or "a" in mode:
                original = handle.write

                def write(data):
                    if board.lost:
                        raise Lost()
                    size = len(data)
                    limit = board.faults.get("noSpaceAfterBytes")
                    if limit is not None and board.written + size > limit:
                        raise OSError(28)
                    if board._used() + size > board.config.get("fsSize", 1 << 30):
                        raise OSError(28)
                    board.written += size
                    if board.faults.get("corruptWrites") and isinstance(data, (bytes, bytearray)) and data:
                        data = bytes([data[0] ^ 0xFF]) + bytes(data[1:])
                    return original(data)

                handle.write = write  # type: ignore[method-assign]
            return handle

        def board_import(name, globals=None, locals=None, fromlist=(), level=0):
            module = board._module(name)
            if module is None:
                raise ImportError(f"no module named '{name}'")
            return module

        allowed.update({"print": board_print, "open": board_open, "__import__": board_import})
        return allowed

    def _module(self, name: str):
        from types import SimpleNamespace

        board = self
        firmware = self.config["firmware"]
        if name in ("os", "uos"):
            block = self.config.get("blockSize", 4096)

            def ilistdir(path=""):
                host = board._host(path or "/")
                if not os.path.isdir(host):
                    raise OSError(2)
                for entry in sorted(os.listdir(host)):
                    full = os.path.join(host, entry)
                    yield (entry, 0x4000 if os.path.isdir(full) else 0x8000, 0, 0 if os.path.isdir(full) else os.path.getsize(full))

            def stat(path):
                host = board._host(path)
                if not os.path.exists(host):
                    raise OSError(2)
                directory = os.path.isdir(host)
                return (0x4000 if directory else 0x8000, 0, 0, 0, 0, 0, 0 if directory else os.path.getsize(host), 0, 0, 0)

            def statvfs(path):
                if not os.path.exists(board._host(path)):
                    raise OSError(2)
                blocks = board.config.get("fsSize", 1 << 20) // block
                free = max(0, blocks - board._used() // block)
                return (block, block, blocks, free, free, 0, 0, 0, 0, 255)

            def remove(path):
                host = board._host(path)
                if not os.path.isfile(host):
                    raise OSError(2)
                os.remove(host)

            def rename(old, new):
                source, target = board._host(old), board._host(new)
                if not os.path.exists(source):
                    raise OSError(2)
                if board.faults.get("renameErrno"):
                    raise OSError(board.faults["renameErrno"])
                if os.path.exists(target) and not board.config.get("renameOverExisting", True):
                    raise OSError(17)
                os.replace(source, target)

            def mkdir(path):
                host = board._host(path)
                if os.path.exists(host):
                    raise OSError(17)
                if not os.path.isdir(os.path.dirname(host)):
                    raise OSError(2)
                os.mkdir(host)

            def uname():
                return (firmware.get("platform", "rp2"), firmware.get("platform", "rp2"), firmware.get("release", "1.24.1"), f"v{firmware.get('release', '1.24.1')}", firmware["machine"])

            return SimpleNamespace(ilistdir=ilistdir, stat=stat, statvfs=statvfs, remove=remove, rename=rename, mkdir=mkdir, rmdir=lambda path: shutil.rmtree(board._host(path)), uname=uname)
        if name in ("sys", "usys"):
            version = tuple(firmware["version"])
            return SimpleNamespace(
                implementation=SimpleNamespace(name=firmware["name"], version=version + (("",) if len(version) == 3 else ()), _machine=firmware["machine"], _mpy=firmware.get("mpy", 6)),
                platform=firmware.get("platform", "rp2"),
            )
        if name == "gc":
            return SimpleNamespace(collect=lambda: None, mem_free=lambda: firmware.get("memFree", 187264))
        if name == "machine":

            def reset():
                log("hard-reset")
                entries = ports()
                if self.faults.get("hardResetLost"):
                    entries = [entry for entry in entries if not same(entry["device"], board.port)]
                elif self.faults.get("hardResetPort"):
                    for entry in entries:
                        if same(entry["device"], board.port):
                            entry["device"] = self.faults["hardResetPort"]
                save_ports(entries)
                board.lost = True
                raise _Reset()

            return SimpleNamespace(unique_id=lambda: bytes.fromhex(firmware.get("uniqueId", "e6614c311b7e1234")), reset=reset)
        if name in ("hashlib", "uhashlib"):
            return SimpleNamespace(sha256=_hashlib.sha256) if self.config.get("hashlib", True) else None
        if name in ("binascii", "ubinascii"):
            return binascii
        if name in ("time", "utime"):

            def sleep(seconds):
                end = time.monotonic() + seconds
                while time.monotonic() < end:
                    if board.interrupted:
                        raise Interrupt()
                    time.sleep(0.01)

            return SimpleNamespace(sleep=sleep, sleep_ms=lambda ms: sleep(ms / 1000), ticks_ms=lambda: int(time.monotonic() * 1000))
        return None


class _Reset(BaseException):
    pass


Interrupt.__name__ = "KeyboardInterrupt"

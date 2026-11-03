"""A fake pyserial for the serial-monitor tests; no serial port is touched.

FAKE_SERIAL_SCENARIO names a JSON file: {"ports": [...], "open_error": {"errno"?, "message"}, "chunks": [...]}.
Each read returns the next chunk's UTF-8 bytes; a chunk {"error": message} makes that read raise SerialException
and {"os_error": message} makes `in_waiting` raise OSError (EIO), as pyserial does on Linux for an unplugged
device. Once the chunks are used up a read waits for its timeout and returns nothing. Port operations are appended
as JSON lines to FAKE_SERIAL_RECORD.
"""

import errno
import json
import os
import time

VERSION = "3.5"


class SerialException(IOError):
    pass


def scenario():
    path = os.environ.get("FAKE_SERIAL_SCENARIO")
    if not path:
        return {}
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def record(event):
    path = os.environ.get("FAKE_SERIAL_RECORD")
    if path:
        with open(path, "a", encoding="utf-8") as file:
            file.write(json.dumps(event) + "\n")


class Serial:
    def __init__(self):
        self.port = None
        self.baudrate = 9600
        self.timeout = None
        self.exclusive = None
        self.is_open = False
        self._dtr = True
        self._rts = True
        self._scenario = scenario()
        self._chunks = [
            chunk.encode("utf-8") if isinstance(chunk, str) else chunk for chunk in self._scenario.get("chunks", [])
        ]

    @property
    def dtr(self):
        return self._dtr

    @dtr.setter
    def dtr(self, value):
        self._dtr = value
        if self.is_open:
            record({"op": "dtr", "value": value})

    @property
    def rts(self):
        return self._rts

    @rts.setter
    def rts(self, value):
        self._rts = value
        if self.is_open:
            record({"op": "rts", "value": value})

    def open(self):
        error = self._scenario.get("open_error")
        if error:
            if "errno" in error:
                raise SerialException(error["errno"], error["message"])
            raise SerialException(error["message"])
        self.is_open = True
        record(
            {
                "op": "open",
                "port": self.port,
                "baudrate": self.baudrate,
                "dtr": self._dtr,
                "rts": self._rts,
                "exclusive": self.exclusive,
            }
        )

    @property
    def in_waiting(self):
        chunk = self._chunks[0] if self._chunks else b""
        if isinstance(chunk, dict):
            if "os_error" in chunk:
                raise OSError(errno.EIO, chunk["os_error"])
            return 0
        return len(chunk)

    def read(self, size=1):
        if not self._chunks:
            time.sleep(self.timeout or 0)
            return b""
        chunk = self._chunks[0]
        if isinstance(chunk, dict):
            raise SerialException(chunk["error"])
        if len(chunk) > size:
            self._chunks[0] = chunk[size:]
            return chunk[:size]
        self._chunks.pop(0)
        return chunk

    def reset_input_buffer(self):
        record({"op": "reset_input_buffer"})

    def write(self, data):
        record({"op": "write", "data": data.decode("utf-8")})
        return len(data)

    def flush(self):
        pass

    def close(self):
        if self.is_open:
            record({"op": "close"})
        self.is_open = False

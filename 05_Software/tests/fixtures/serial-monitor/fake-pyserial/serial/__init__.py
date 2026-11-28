"""A fake pyserial for the serial-monitor tests; no serial port is touched.

FAKE_SERIAL_SCENARIO names a JSON file: {"ports": [...], "open_error": {"errno"?, "message"}, "chunks": [...],
"no_lines": true for a port without DTR/RTS (a simulator's pseudo-terminal), "chunks_by_baud": {"74880": [...],
"other": [...]} for a device that reads differently at each rate; the list starts over when the rate changes}.
A chunk {"hex": "0103"} is raw bytes. "replies": {"help\\r\\n": "Commands\\r\\n"} is what the device
prints after it was written that text.
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
        self._baudrate = 9600
        self.timeout = None
        self.exclusive = None
        self.is_open = False
        self._scenario = scenario()
        self._dtr = True
        self._rts = True
        self.bytesize = 8
        self.parity = "N"
        self.stopbits = 1
        self._chunks = self._decoded(self._scenario.get("chunks", []))

    @staticmethod
    def _decoded(chunks):
        return [
            chunk.encode("utf-8") if isinstance(chunk, str) else bytes.fromhex(chunk["hex"]) if "hex" in chunk else chunk
            for chunk in chunks
        ]

    @property
    def baudrate(self):
        return self._baudrate

    @baudrate.setter
    def baudrate(self, value):
        self._baudrate = value
        rates = self._scenario.get("chunks_by_baud")
        if rates is not None:
            self._chunks = self._decoded(rates.get(str(value), rates.get("other", [])))
        if self.is_open:
            record({"op": "baudrate", "value": value})

    @property
    def dtr(self):
        return self._dtr

    @dtr.setter
    def dtr(self, value):
        if self.is_open and self._scenario.get("no_lines"):
            raise OSError(errno.ENOTTY, "Inappropriate ioctl for device")
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
                # Only a frame other than 8N1 is recorded, so records of ordinary runs stay as they were.
                **(
                    {"frame": f"{self.bytesize}{self.parity}{self.stopbits:g}"}
                    if (self.bytesize, self.parity, self.stopbits) != (8, "N", 1)
                    else {}
                ),
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
        try:
            record({"op": "write", "data": data.decode("utf-8")})
            reply = self._scenario.get("replies", {}).get(data.decode("utf-8"))
            if reply is not None:
                self._chunks.append(reply.encode("utf-8"))
        except UnicodeDecodeError:
            record({"op": "write", "hex": data.hex()})
        return len(data)

    def flush(self):
        pass

    def close(self):
        if self.is_open:
            record({"op": "close"})
        self.is_open = False


def serial_for_url(url, *args, do_not_open=False, **kwargs):
    """pyserial's factory: a device name or a URL such as socket://host:port gives a port object."""
    connection = Serial()
    connection.port = url
    if not do_not_open:
        connection.open()
    return connection

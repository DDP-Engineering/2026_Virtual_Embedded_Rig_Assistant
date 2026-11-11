"""A stand-in for python-can, enough for can_bus.py: it records every Bus and frame and never touches hardware.

FAKE_CAN_RECORD names a JSON-lines file that receives {"bus": kwargs}, {"send": "ID#DATA"} and {"shutdown": true}.
FAKE_CAN_FRAMES holds a JSON list of "ID#DATA" frames that recv returns in order. FAKE_CAN_OPEN_ERROR makes the
Bus constructor raise CanError with its text.
"""

import enum
import json
import os
import time


class BusState(enum.Enum):
    ACTIVE = "active"
    PASSIVE = "passive"
    ERROR = "error"


class CanError(Exception):
    pass


def _record(entry):
    path = os.environ.get("FAKE_CAN_RECORD")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")


class Message:
    def __init__(self, arbitration_id=0, data=b"", is_extended_id=False, is_fd=False, bitrate_switch=False,
                 check=False, timestamp=0.0, channel=None):
        self.arbitration_id = arbitration_id
        self.data = bytearray(data)
        self.is_extended_id = is_extended_id
        self.is_fd = is_fd
        self.bitrate_switch = bitrate_switch
        self.error_state_indicator = False
        self.is_remote_frame = False
        self.is_error_frame = False
        self.timestamp = timestamp
        self.channel = channel

    def text(self):
        return f"{self.arbitration_id:X}#{self.data.hex().upper()}"


def _parse(text, timestamp=0.0):
    identifier, data = text.strip().split("#", 1)
    return Message(arbitration_id=int(identifier, 16), data=bytes.fromhex(data), is_extended_id=len(identifier) > 3,
                   timestamp=timestamp)


class Bus:
    def __init__(self, **kwargs):
        if kwargs.get("interface") == "gs_usb" and isinstance(kwargs.get("channel"), str):
            # GsUsbBus compares the channel with a device count, as the real backend does.
            raise TypeError("'<=' not supported between instances of 'int' and 'str'")
        if os.environ.get("FAKE_CAN_OPEN_ERROR"):
            raise CanError(os.environ["FAKE_CAN_OPEN_ERROR"])
        _record({"bus": {key: value.value if isinstance(value, enum.Enum) else value for key, value in kwargs.items()}})
        self._frames = json.loads(os.environ.get("FAKE_CAN_FRAMES", "[]"))

    def recv(self, timeout=None):
        if self._frames:
            return _parse(self._frames.pop(0), time.time())
        time.sleep(timeout or 0)
        return None

    def send(self, message, timeout=None):
        _record({"send": message.text()})

    def shutdown(self):
        _record({"shutdown": True})


class Logger:
    def __init__(self, path):
        self.file = open(path, "w", encoding="utf-8", newline="\n")

    def on_message_received(self, message):
        self.file.write(message.text() + "\n")

    def stop(self):
        self.file.close()


def LogReader(path):
    with open(path, encoding="utf-8") as handle:
        return [_parse(line) for line in handle if line.strip()]


def MessageSync(messages, timestamps=True, gap=0.0001):
    yield from messages


def detect_available_configs(interfaces=None):
    return []

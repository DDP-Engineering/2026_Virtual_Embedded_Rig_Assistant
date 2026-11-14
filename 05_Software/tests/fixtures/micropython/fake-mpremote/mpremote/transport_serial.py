"""A minimal raw-REPL client with the interface of mpremote 1.29.0's SerialTransport (offline tests only).

It follows the same byte protocol as mpremote (Ctrl-C, Ctrl-A, optional soft reset, raw-paste request, code + Ctrl-D,
"OK", output, 0x04, traceback, 0x04), so the default suite drives the fake board the way the real package does; the
opt-in suite runs the real mpremote against the same board. Only what micropython-tool uses is here.
"""

import time

import serial

from .transport import TransportError, TransportExecError


class SerialTransport:
    def __init__(self, device, baudrate=115200, wait=0, exclusive=True, timeout=None):
        self.in_raw_repl = False
        self.use_raw_paste = True
        self.device_name = device
        try:
            self.serial = serial.serial_for_url(device, do_not_open=True, baudrate=baudrate, timeout=timeout, interCharTimeout=1, exclusive=exclusive)
            self.serial.open()
        except OSError as error:
            raise TransportError("failed to access " + device) from error
        self.is_pty = False

    def close(self):
        self.serial.rts = False
        self.serial.dtr = False
        self.serial.close()

    def read_until(self, min_num_bytes, ending, timeout=10, data_consumer=None, timeout_overall=None):
        data = b""
        begin_overall = begin_char = time.monotonic()
        while True:
            if data.endswith(ending):
                break
            new = self.serial.read(1) if self.serial.inWaiting() > 0 else None
            if new:
                if data_consumer:
                    data_consumer(new)
                    data = new
                else:
                    data += new
                begin_char = time.monotonic()
            else:
                if timeout is not None and time.monotonic() >= begin_char + timeout:
                    break
                if timeout_overall is not None and time.monotonic() >= begin_overall + timeout_overall:
                    break
                time.sleep(0.01)
        return data

    def enter_raw_repl(self, soft_reset=True, timeout_overall=10):
        self.serial.write(b"\r\x03")
        n = self.serial.inWaiting()
        while n > 0:
            self.serial.read(n)
            n = self.serial.inWaiting()
        self.serial.write(b"\r\x01")
        if soft_reset:
            data = self.read_until(1, b"raw REPL; CTRL-B to exit\r\n>", timeout_overall=timeout_overall)
            if not data.endswith(b"raw REPL; CTRL-B to exit\r\n>"):
                raise TransportError("could not enter raw repl")
            self.serial.write(b"\x04")
            data = self.read_until(1, b"soft reboot\r\n", timeout_overall=timeout_overall)
            if not data.endswith(b"soft reboot\r\n"):
                raise TransportError("could not enter raw repl")
        data = self.read_until(1, b"raw REPL; CTRL-B to exit\r\n", timeout_overall=timeout_overall)
        if not data.endswith(b"raw REPL; CTRL-B to exit\r\n"):
            raise TransportError("could not enter raw repl")
        self.in_raw_repl = True

    def exit_raw_repl(self):
        self.serial.write(b"\r\x02")
        self.in_raw_repl = False

    def follow(self, timeout, data_consumer=None):
        data = self.read_until(1, b"\x04", timeout=timeout, data_consumer=data_consumer)
        if not data.endswith(b"\x04"):
            raise TransportError("timeout waiting for first EOF reception")
        data = data[:-1]
        data_err = self.read_until(1, b"\x04", timeout=timeout)
        if not data_err.endswith(b"\x04"):
            raise TransportError("timeout waiting for second EOF reception")
        return data, data_err[:-1]

    def exec_raw_no_follow(self, command):
        command_bytes = command if isinstance(command, bytes) else bytes(command, encoding="utf8")
        data = self.read_until(1, b">")
        if not data.endswith(b">"):
            raise TransportError("could not enter raw repl")
        if self.use_raw_paste:
            self.serial.write(b"\x05A\x01")
            data = self.serial.read(2)
            if data == b"R\x01":
                return self.raw_paste_write(command_bytes)
            if data != b"R\x00":
                raise TransportError("unexpected raw-paste answer {!r}".format(data))
            self.use_raw_paste = False
        for i in range(0, len(command_bytes), 256):
            self.serial.write(command_bytes[i : i + 256])
        self.serial.write(b"\x04")
        data = self.serial.read(2)
        if data != b"OK":
            raise TransportError("could not exec command (response: %r)" % data)

    def raw_paste_write(self, command_bytes):
        import struct

        window = struct.unpack("<H", self.serial.read(2))[0]
        remain = window
        i = 0
        while i < len(command_bytes):
            while remain == 0 or self.serial.inWaiting():
                data = self.serial.read(1)
                if data == b"\x01":
                    remain += window
                elif data == b"\x04":
                    self.serial.write(b"\x04")
                    return
                else:
                    raise TransportError("unexpected read during raw paste: {}".format(data))
            chunk = command_bytes[i : min(i + remain, len(command_bytes))]
            self.serial.write(chunk)
            remain -= len(chunk)
            i += len(chunk)
        self.serial.write(b"\x04")
        data = self.read_until(1, b"\x04")
        if not data.endswith(b"\x04"):
            raise TransportError("could not complete raw paste: {}".format(data))

    def exec_raw(self, command, timeout=10, data_consumer=None):
        self.exec_raw_no_follow(command)
        return self.follow(timeout, data_consumer)

    def eval(self, expression, parse=True):
        import ast

        ret = self.exec("print(repr({}))".format(expression)).strip()
        return ast.literal_eval(ret.decode()) if parse else ret

    def exec(self, command, data_consumer=None):
        ret, ret_err = self.exec_raw(command, data_consumer=data_consumer)
        if ret_err:
            raise TransportExecError(ret, ret_err.decode())
        return ret

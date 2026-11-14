"""A minimal SSH agent for the raspberry-pi-linux tests: holds one generated key and signs with it.

Serves the agent protocol (identities and sign requests only) on a Windows named pipe or a Unix socket given as
--path, prints {"ready": true} when listening and logs every request as one JSON line to --log, so a test can show that
the client authenticated through an agent and offered which key. It holds no key from the user's own agent.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import struct
import sys

import asyncssh

REQUEST_IDENTITIES, IDENTITIES_ANSWER, SIGN_REQUEST, SIGN_RESPONSE, FAILURE = 11, 12, 13, 14, 5


def _string(data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + data


class Agent(asyncio.Protocol):
    def __init__(self, keys: list[asyncssh.SSHKey], log: str) -> None:
        self.keys = keys
        self.log = log
        self.buffer = b""
        self.transport: asyncio.Transport | None = None

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self.transport = transport  # type: ignore[assignment]

    def _record(self, event: dict) -> None:
        with open(self.log, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event) + "\n")

    def data_received(self, data: bytes) -> None:
        self.buffer += data
        while len(self.buffer) >= 4:
            (length,) = struct.unpack(">I", self.buffer[:4])
            if len(self.buffer) < 4 + length:
                return
            message, self.buffer = self.buffer[4 : 4 + length], self.buffer[4 + length :]
            reply = self.answer(message)
            assert self.transport is not None
            self.transport.write(struct.pack(">I", len(reply)) + reply)

    def answer(self, message: bytes) -> bytes:
        kind = message[0] if message else 0
        if kind == REQUEST_IDENTITIES:
            self._record({"request": "identities"})
            body = struct.pack(">I", len(self.keys))
            for key in self.keys:
                body += _string(key.public_data) + _string(b"vera-test")
            return bytes([IDENTITIES_ANSWER]) + body
        if kind == SIGN_REQUEST:
            offset = 1
            (size,) = struct.unpack(">I", message[offset : offset + 4])
            blob = message[offset + 4 : offset + 4 + size]
            offset += 4 + size
            (size,) = struct.unpack(">I", message[offset : offset + 4])
            data = message[offset + 4 : offset + 4 + size]
            for key in self.keys:
                if key.public_data == blob:
                    self._record({"request": "sign", "fingerprint": key.get_fingerprint("sha256")})
                    signature = key.sign(data, key.sig_algorithms[0])
                    return bytes([SIGN_RESPONSE]) + _string(signature)
            self._record({"request": "sign", "fingerprint": None})
            return bytes([FAILURE])
        self._record({"request": f"type-{kind}"})
        return bytes([FAILURE])


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--key", action="append", required=True)
    parser.add_argument("--path", required=True)
    parser.add_argument("--log", required=True)
    args = parser.parse_args()
    keys = [asyncssh.read_private_key(path) for path in args.key]
    loop = asyncio.get_running_loop()
    if sys.platform == "win32":
        await loop.start_serving_pipe(lambda: Agent(keys, args.log), args.path)  # type: ignore[attr-defined]
    else:
        await loop.create_unix_server(lambda: Agent(keys, args.log), args.path)
    print(json.dumps({"ready": True}), flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())

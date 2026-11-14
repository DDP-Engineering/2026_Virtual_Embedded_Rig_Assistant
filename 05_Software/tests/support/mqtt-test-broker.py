"""A small MQTT 3.1.1 and 5 broker for the mqtt-tools tests, standard library only.

It listens on 127.0.0.1 only: one plaintext port and one TLS port per `--tls CERT:KEY`, and prints
`READY {"port": P, "tlsPorts": [..]}` on stdout. Clients authenticate against the users in the control file
(`--control`, JSON, re-read every 50 ms); its switches inject the faults the tests need:

  users              {"name": "password"}; anonymous connections are refused when users is non-empty
  denySubscribe      filters whose SUBSCRIBE gets a failure reason code
  denyPublish        topics whose PUBLISH (MQTT 5) gets PUBACK 0x87
  dropOnPublish      topics: the broker closes the publisher's connection on such a PUBLISH, without PUBACK
  duplicate          true: every QoS 1 delivery is sent twice, the second with the DUP flag
  drop               {"nonce": N, "prefix": P}: once per nonce, close every connection whose client id starts with P
  silent             true: accept TCP but never answer CONNECT

Every packet event is appended to `--log` as one JSON line (client ids, topics, flags, sizes; never a password).
QoS 2 is not supported. Not a product broker: test evidence only.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import ssl
import sys
import time
from pathlib import Path

CONTROL: dict = {}
SEEN_NONCES: set[str] = set()
RETAINED: dict[str, tuple[bytes, int, bytes]] = {}
CLIENTS: set["Client"] = set()
LOG_PATH: Path | None = None


def log(event: str, **fields) -> None:
    if LOG_PATH is None:
        return
    with LOG_PATH.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"t": time.time(), "event": event, **fields}) + "\n")


def matches(filter_: str, topic: str) -> bool:
    f, t = filter_.split("/"), topic.split("/")
    if topic.startswith("$") and f[0] in ("#", "+"):
        return False
    for index, level in enumerate(f):
        if level == "#":
            return True
        if index >= len(t):
            return False
        if level != "+" and level != t[index]:
            return False
    return len(f) == len(t)


def varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value % 128
        value //= 128
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def read_varint(data: bytes, offset: int) -> tuple[int, int]:
    value, shift = 0, 0
    while True:
        byte = data[offset]
        offset += 1
        value += (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return value, offset


def string(data: bytes, offset: int) -> tuple[bytes, int]:
    length = int.from_bytes(data[offset : offset + 2], "big")
    return data[offset + 2 : offset + 2 + length], offset + 2 + length


def encoded(value: bytes) -> bytes:
    return len(value).to_bytes(2, "big") + value


def packet(kind: int, body: bytes, flags: int = 0) -> bytes:
    return bytes([(kind << 4) | flags]) + varint(len(body)) + body


class Client:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, tls: bool) -> None:
        self.reader, self.writer, self.tls = reader, writer, tls
        self.client_id = ""
        self.version = 4
        self.subscriptions: dict[str, int] = {}
        self.will: tuple[str, bytes, int, bool, bytes] | None = None
        self.graceful = False
        self.closed = False
        self.next_id = 1

    def send(self, data: bytes) -> None:
        if not self.closed:
            self.writer.write(data)

    def close(self) -> None:
        if not self.closed:
            self.closed = True
            try:
                self.writer.close()
            except Exception:
                pass

    def packet_id(self) -> int:
        value = self.next_id
        self.next_id = self.next_id % 65535 + 1
        return value

    def deliver(self, topic: str, payload: bytes, qos: int, retain: bool, props: bytes, dup: bool = False, pid: int | None = None) -> int:
        body = encoded(topic.encode())
        if qos:
            pid = pid or self.packet_id()
            body += pid.to_bytes(2, "big")
        if self.version == 5:
            body += varint(len(props)) + props
        body += payload
        flags = (0x08 if dup else 0) | (qos << 1) | (0x01 if retain else 0)
        self.send(packet(3, body, flags))
        return pid or 0

    async def run(self) -> None:
        CLIENTS.add(self)
        try:
            await self.serve()
        except (asyncio.IncompleteReadError, ConnectionError, ssl.SSLError, OSError):
            pass
        finally:
            CLIENTS.discard(self)
            if self.client_id:
                log("closed", clientId=self.client_id, graceful=self.graceful)
            if self.will and not self.graceful and self.client_id:
                topic, payload, qos, retain, props = self.will
                log("will-published", clientId=self.client_id, topic=topic, retain=retain)
                publish(topic, payload, qos, retain, props, None)
            self.close()

    async def read_packet(self) -> tuple[int, int, bytes]:
        header = await self.reader.readexactly(1)
        length, shift = 0, 0
        while True:
            byte = (await self.reader.readexactly(1))[0]
            length += (byte & 0x7F) << shift
            shift += 7
            if not byte & 0x80:
                break
        body = await self.reader.readexactly(length) if length else b""
        return header[0] >> 4, header[0] & 0x0F, body

    async def serve(self) -> None:
        kind, _flags, body = await self.read_packet()
        if kind != 1:
            return
        if CONTROL.get("silent"):
            log("silent-connect")
            await asyncio.sleep(3600)
            return
        name, offset = string(body, 0)
        self.version = body[offset]
        connect_flags = body[offset + 1]
        keepalive = int.from_bytes(body[offset + 2 : offset + 4], "big")
        offset += 4
        if self.version == 5:
            length, offset = read_varint(body, offset)
            offset += length
        cid, offset = string(body, offset)
        self.client_id = cid.decode()
        will = None
        if connect_flags & 0x04:
            will_props = b""
            if self.version == 5:
                length, start = read_varint(body, offset)
                will_props = body[start : start + length]
                offset = start + length
            topic, offset = string(body, offset)
            payload, offset = string(body, offset)
            will = (topic.decode(), payload, (connect_flags >> 3) & 0x03, bool(connect_flags & 0x20), will_props)
        username = password = None
        if connect_flags & 0x80:
            raw, offset = string(body, offset)
            username = raw.decode()
        if connect_flags & 0x40:
            raw, offset = string(body, offset)
            password = raw.decode()
        users = CONTROL.get("users") or {}
        ok = (not users) or (username in users and users[username] == password)
        log(
            "connect",
            clientId=self.client_id,
            protocol=self.version,
            clean=bool(connect_flags & 0x02),
            username=username,
            hasPassword=password is not None,
            keepalive=keepalive,
            tls=self.tls,
            will={"topic": will[0], "qos": will[2], "retain": will[3]} if will else None,
        )
        if not ok:
            log("connack", clientId=self.client_id, accepted=False)
            self.send(packet(2, bytes([0, 0x86 if self.version == 5 else 4]) + (b"\x00" if self.version == 5 else b"")))
            await self.writer.drain()
            return
        self.will = will
        self.send(packet(2, bytes([0, 0]) + (b"\x00" if self.version == 5 else b"")))
        log("connack", clientId=self.client_id, accepted=True)
        while not self.closed:
            await self.writer.drain()
            kind, flags, body = await self.read_packet()
            if kind == 3:
                self.on_publish(flags, body)
            elif kind == 4:
                pass  # PUBACK from a subscriber
            elif kind == 8:
                self.on_subscribe(body)
            elif kind == 10:
                self.on_unsubscribe(body)
            elif kind == 12:
                self.send(packet(13, b""))
            elif kind == 14:
                reason = body[0] if self.version == 5 and body else 0
                self.graceful = reason == 0
                log("disconnect", clientId=self.client_id, reason=reason)
                return

    def on_publish(self, flags: int, body: bytes) -> None:
        qos, retain = (flags >> 1) & 0x03, bool(flags & 0x01)
        topic_raw, offset = string(body, 0)
        topic = topic_raw.decode()
        pid = 0
        if qos:
            pid = int.from_bytes(body[offset : offset + 2], "big")
            offset += 2
        props = b""
        if self.version == 5:
            length, start = read_varint(body, offset)
            props = body[start : start + length]
            offset = start + length
        payload = body[offset:]
        log("publish", clientId=self.client_id, topic=topic, qos=qos, retain=retain, size=len(payload), dup=bool(flags & 0x08))
        if topic in (CONTROL.get("dropOnPublish") or []):
            log("dropped-on-publish", clientId=self.client_id, topic=topic)
            self.close()
            return
        if self.version == 5 and topic in (CONTROL.get("denyPublish") or []):
            self.send(packet(4, pid.to_bytes(2, "big") + b"\x87"))
            return
        publish(topic, payload, qos, retain, props if self.version == 5 else b"", self)
        if qos == 1:
            self.send(packet(4, pid.to_bytes(2, "big")))

    def on_subscribe(self, body: bytes) -> None:
        pid = body[0:2]
        offset = 2
        if self.version == 5:
            length, offset = read_varint(body, offset)
            offset += length
        codes = bytearray()
        granted: list[tuple[str, int]] = []
        while offset < len(body):
            raw, offset = string(body, offset)
            options = body[offset]
            offset += 1
            filter_ = raw.decode()
            if any(matches(deny, filter_) or deny == filter_ for deny in (CONTROL.get("denySubscribe") or [])):
                codes.append(0x87 if self.version == 5 else 0x80)
                continue
            qos = min(options & 0x03, 1)
            self.subscriptions[filter_] = qos
            granted.append((filter_, qos))
            codes.append(qos)
        log("subscribe", clientId=self.client_id, filters=[f for f, _ in granted], codes=list(codes))
        self.send(packet(9, pid + (b"\x00" if self.version == 5 else b"") + bytes(codes)))
        for filter_, qos in granted:
            for topic, (payload, rqos, props) in RETAINED.items():
                if matches(filter_, topic):
                    self.deliver(topic, payload, min(qos, rqos), True, props if self.version == 5 else b"")

    def on_unsubscribe(self, body: bytes) -> None:
        pid = body[0:2]
        offset = 2
        if self.version == 5:
            length, offset = read_varint(body, offset)
            offset += length
        filters = []
        while offset < len(body):
            raw, offset = string(body, offset)
            filters.append(raw.decode())
            self.subscriptions.pop(raw.decode(), None)
        log("unsubscribe", clientId=self.client_id, filters=filters)
        reasons = (b"\x00" + bytes(len(filters))) if self.version == 5 else b""
        self.send(packet(11, pid + reasons))


def publish(topic: str, payload: bytes, qos: int, retain: bool, props: bytes, source: Client | None) -> None:
    if retain:
        if payload:
            RETAINED[topic] = (payload, qos, props)
        else:
            RETAINED.pop(topic, None)
    for client in list(CLIENTS):
        granted = [q for f, q in client.subscriptions.items() if matches(f, topic)]
        if not granted:
            continue
        delivery_qos = min(qos, max(granted))
        shown = props if client.version == 5 else b""
        pid = client.deliver(topic, payload, delivery_qos, False, shown)
        if delivery_qos == 1 and CONTROL.get("duplicate"):
            client.deliver(topic, payload, 1, False, shown, dup=True, pid=pid)


async def watch_control(path: Path) -> None:
    global CONTROL
    while True:
        try:
            CONTROL = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        drop = CONTROL.get("drop")
        if isinstance(drop, dict) and drop.get("nonce") not in SEEN_NONCES:
            SEEN_NONCES.add(drop.get("nonce"))
            for client in list(CLIENTS):
                if client.client_id.startswith(drop.get("prefix", "\0")):
                    log("dropped", clientId=client.client_id)
                    client.close()
        await asyncio.sleep(0.05)


async def main() -> None:
    global LOG_PATH
    parser = argparse.ArgumentParser()
    parser.add_argument("--control", required=True)
    parser.add_argument("--log", required=True)
    parser.add_argument("--tls", action="append", default=[])
    args = parser.parse_args()
    LOG_PATH = Path(args.log)
    control = Path(args.control)
    global CONTROL
    CONTROL = json.loads(control.read_text(encoding="utf-8"))

    def handler(tls: bool):
        async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await Client(reader, writer, tls).run()

        return handle

    plain = await asyncio.start_server(handler(False), "127.0.0.1", 0)
    tls_ports = []
    for pair in args.tls:
        cert, key = pair.rsplit("|", 1)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        server = await asyncio.start_server(handler(True), "127.0.0.1", 0, ssl=context)
        tls_ports.append(server.sockets[0].getsockname()[1])
    asyncio.get_running_loop().create_task(watch_control(control))
    print("READY " + json.dumps({"port": plain.sockets[0].getsockname()[1], "tlsPorts": tls_ports}), flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)

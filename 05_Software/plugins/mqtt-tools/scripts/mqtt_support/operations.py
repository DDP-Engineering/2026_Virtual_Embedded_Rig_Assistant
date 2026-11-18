"""connect-test, subscribe, publish and request of mqtt-tool (spec REQ-DATA-96d18686 section 4).

Everything the profile and arguments can refuse is refused before the first packet. Subscribe is bounded by time,
messages and bytes and appends every message as it arrives; publish and request send their PUBLISH once and never
reconnect; a delivery once recorded is never rewritten as cancelled.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from pathlib import Path
from typing import Any

import paho.mqtt.client as mqtt
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties

from . import credential as credentials
from . import report, schema, topics, workspace
from .connection import STOP, Connection
from .profile import Profile
from .report import Ended, refused, stamp

MAX_FILTERS = 8
MAX_UNCORRELATED = 20


class Run:
    """One network operation: profile, credential, connection and the result document kept current on disk."""

    def __init__(self, args: Any, document: dict[str, Any], profile: Profile, cwd: Path, spelled: Path) -> None:
        self.args, self.document, self.profile, self.cwd, self.spelled = args, document, profile, cwd, spelled
        self.folder: Path | None = None
        self.credential: credentials.Credential | None = None
        self.connection: Connection | None = None

    # ---- checks before any packet -------------------------------------------------------------------------------

    def check_credential(self) -> None:
        wanted, given = self.profile.credential, self.args.credential
        if wanted and given != wanted:
            raise refused("credential-mismatch" if given else "credential-missing", f"The profile uses credential {wanted}; pass --credential {wanted} so VERA hands it to this run.")
        if given and not wanted:
            raise refused("credential-mismatch", "The profile names no credential; --credential is refused.")

    def read_credential(self) -> None:
        if self.profile.credential:
            self.credential = credentials.read(self.profile.credential)

    def payload(self, entry: dict[str, Any]) -> bytes:
        limit = self.profile.limits["maxPayloadBytes"]
        if (self.args.payload is None) == (self.args.payload_file is None):
            raise refused("usage", "Give exactly one of --payload or --payload-file.")
        if self.args.payload is not None:
            data = self.args.payload.encode("utf-8")
        else:
            try:
                file = workspace.regular_file(self.cwd, self.args.payload_file, "--payload-file", self.spelled)
            except workspace.PathRefused as error:
                raise refused("path", str(error)) from error
            if file.stat().st_size > limit:
                raise refused("payload-invalid", f"The payload file is larger than limits.maxPayloadBytes ({limit}).")
            data = file.read_bytes()
        if len(data) > limit:
            raise refused("payload-invalid", f"The payload is larger than limits.maxPayloadBytes ({limit}).")
        declared = self.profile.data["schemas"].get(entry["schema"]) if entry.get("schema") else None
        valid, reason, _ = schema.check(declared, data)
        if valid is False:
            raise refused("payload-invalid", f"The payload does not satisfy schema {entry['schema']}: {reason}.")
        return data

    def publish_entry(self) -> dict[str, Any]:
        topic = self.args.topic
        entry = self.profile.publish_entry(topic) if topics.literal_topic(topic) else None
        if entry is None:
            raise refused("topic-denied", f"{topic[:200]} is not a publish topic of the profile; mqtt-tool publishes only to declared topics.")
        return entry

    # ---- results ------------------------------------------------------------------------------------------------

    def describe(self) -> None:
        tls = self.profile.data["tls"]
        self.document.update(
            {
                "profile": self.profile.summary(),
                "broker": {
                    "host": self.profile.data["broker"]["host"],
                    "port": self.profile.data["broker"]["port"],
                    "tls": {"enabled": tls["enabled"], "verified": False, "caSha256": self.profile.ca_sha256, "trust": "system" if tls.get("system") else ("ca" if tls["enabled"] else None)},
                },
                "credential": {"ref": self.profile.credential, "supplied": self.credential is not None} if self.profile.credential else None,
                "will": {key: self.profile.data["will"][key] for key in ("topic", "qos", "retain")} if self.profile.data.get("will") else None,
            }
        )

    def save(self) -> None:
        """The document as it stands while the run goes on: incomplete until the final write (spec section 5)."""
        if self.folder is not None:
            status = self.document["status"]
            report.write_json(self.folder / "result.json", {**self.document, "status": "incomplete" if status == "pass" else status, "finishedAt": None})

    def connect(self) -> Connection:
        connection = Connection(self.profile, self.credential)
        self.connection = connection
        self.document["client"] = {"id": connection.client_id, "protocol": self.profile.protocol, "cleanSession": True}
        self.document["status"] = "incomplete"
        if self.credential is not None:
            # The profile, a workbench file, picks the broker; the approved command line shows only the reference.
            broker = self.document["broker"]
            self.document["warnings"].append(
                report.problem("credential-sent", f"The stored credential {self.credential.ref} goes to {broker['host']}:{broker['port']}, the broker the profile names.")
            )
        self.save()
        connection.open()
        self.document["status"] = "pass"
        self.document["broker"]["tls"]["verified"] = bool(self.profile.data["tls"]["enabled"])
        self.document["client"]["sessionPresent"] = connection.session_present
        return connection


def capabilities(document: dict[str, Any]) -> None:
    import paho  # noqa: PLC0415 - the installed version, reported as is

    document["backend"] = {
        "client": f"paho-mqtt {getattr(paho, '__version__', 'unknown')}",
        "protocols": ["5", "3.1.1"],
        "qos": [0, 1],
        "transports": ["tcp", "tls"],
        "operations": ["check-profile", "connect-test", "subscribe", "publish", "request"],
        "session": "clean only",
        "verified": "local test broker only",
    }


# ---- subscribe --------------------------------------------------------------------------------------------------


def _bound(value: int | None, default: int, cap: int, option: str) -> int:
    if value is None:
        return min(default, cap)
    if not 1 <= value <= cap:
        raise refused("usage", f"{option} takes 1 to {cap} (the profile's limit).")
    return value


def subscribe_plan(run: Run) -> tuple[list[tuple[str, int]], int, int, int]:
    requested = run.args.topic or []
    if not 1 <= len(requested) <= MAX_FILTERS:
        raise refused("usage", f"Give 1 to {MAX_FILTERS} --topic filters.")
    filters = []
    for filter_ in requested:
        entry = run.profile.subscribe_entry(filter_) if topics.valid_filter(filter_) else None
        if entry is None:
            raise refused("topic-denied", f"{filter_[:200]} reaches topics outside the profile's subscribe filters.")
        filters.append((filter_, entry["qos"]))
    limits = run.profile.limits
    duration = _bound(run.args.duration, 10, limits["maxDurationS"], "--duration")
    messages = _bound(run.args.max_messages, limits["maxMessages"], limits["maxMessages"], "--max-messages")
    size = _bound(run.args.max_bytes, limits["maxBytes"], limits["maxBytes"], "--max-bytes")
    return filters, duration, messages, size


def _properties(message: mqtt.MQTTMessage) -> dict[str, Any] | None:
    props = getattr(message, "properties", None)
    if props is None:
        return None
    shown: dict[str, Any] = {}
    for name, key in (("ContentType", "contentType"), ("ResponseTopic", "responseTopic"), ("MessageExpiryInterval", "messageExpiry")):
        if hasattr(props, name):
            shown[key] = getattr(props, name)
    if hasattr(props, "CorrelationData"):
        shown["correlationData"] = bytes(props.CorrelationData).hex()
    if hasattr(props, "UserProperty"):
        shown["userProperties"] = [list(pair) for pair in props.UserProperty][:32]
    return shown or None


class Classifier:
    """retained / duplicate / stale / new, per topic, from the flags and the schema's sequence field."""

    def __init__(self, profile: Profile) -> None:
        self.profile = profile
        self.last: dict[str, int] = {}
        self.previous: dict[str, str] = {}

    def record(self, seq: int, message: mqtt.MQTTMessage) -> dict[str, Any]:
        payload = bytes(message.payload)
        digest = hashlib.sha256(payload).hexdigest()
        line: dict[str, Any] = {
            "seq": seq,
            "receivedAt": stamp(),
            "topic": message.topic,
            "qos": message.qos,
            "retain": bool(message.retain),
            "dup": bool(message.dup),
            "size": len(payload),
            "sha256": digest,
        }
        declared = self.profile.schema_for_topic(message.topic)
        if len(payload) > self.profile.limits["maxPayloadBytes"]:
            line.update({"oversize": True, "valid": False, "invalid": "payload exceeds limits.maxPayloadBytes"})
            value = None
        else:
            line["payloadBase64"] = base64.b64encode(payload).decode("ascii")
            try:
                line["text"] = payload.decode("utf-8")
            except UnicodeDecodeError:
                pass
            valid, reason, value = schema.check(declared, payload)
            line["valid"] = valid
            if reason:
                line["invalid"] = reason
        properties = _properties(message)
        if properties:
            line["properties"] = properties
        sequence_field = declared.get("sequence") if declared else None
        sequence = value.get(sequence_field) if isinstance(value, dict) and sequence_field else None
        if not isinstance(sequence, int) or isinstance(sequence, bool):
            sequence = None
        last = self.last.get(message.topic)
        if message.retain:
            event = "retained"
        elif message.dup or (sequence is not None and last is not None and sequence == last):
            event = "duplicate"
        elif sequence is not None and last is not None and sequence < last:
            event = "stale"
        else:
            event = "new"
            if sequence is None and self.previous.get(message.topic) == digest:
                line["repeat"] = True
        if sequence is not None and (last is None or sequence > last):
            self.last[message.topic] = sequence
        self.previous[message.topic] = digest
        line["event"] = event
        return line


def subscribe(run: Run) -> None:
    filters, duration, max_messages, max_bytes = subscribe_plan(run)
    run.describe()
    assert run.folder is not None
    stream_path = run.folder / "messages.jsonl"
    capture: dict[str, Any] = {"messages": 0, "bytes": 0, "endReason": "running", "events": {"new": 0, "retained": 0, "duplicate": 0, "stale": 0}, "file": workspace.relative(run.cwd, stream_path), "invalid": 0, "oversize": 0}
    run.document.update({"subscription": {"filters": [f for f, _ in filters], "qos": [q for _, q in filters]}, "capture": capture, "gaps": []})
    connection = run.connect()
    connection.subscribe(filters)
    run.save()
    classifier = Classifier(run.profile)
    reconnect = run.profile.data["reconnect"]
    attempts_left = reconnect["attempts"]
    deadline = time.monotonic() + duration
    with stream_path.open("a", encoding="utf-8", newline="\n") as stream:
        while True:
            while connection.messages and capture["endReason"] == "running":
                message = connection.messages.popleft()
                line = classifier.record(capture["messages"] + 1, message)
                stream.write(json.dumps(line, ensure_ascii=False) + "\n")
                stream.flush()
                capture["messages"] += 1
                capture["bytes"] += line["size"]
                capture["events"][line["event"]] += 1
                capture["invalid"] += 1 if line.get("valid") is False else 0
                capture["oversize"] += 1 if line.get("oversize") else 0
                if capture["messages"] >= max_messages:
                    capture["endReason"] = "messages"
                elif capture["bytes"] >= max_bytes:
                    capture["endReason"] = "bytes"
            if capture["endReason"] != "running":
                break
            if STOP.requested:
                capture["endReason"] = "stopped"
                break
            if time.monotonic() >= deadline:
                capture["endReason"] = "duration"
                break
            if connection.pump(min(0.1, max(0.0, deadline - time.monotonic()))):
                continue
            if connection.messages:
                continue
            gap = {"lostAt": stamp(), "reconnectedAt": None, "reason": connection.lost or "connection lost"}
            run.document["gaps"].append(gap)
            run.save()
            if attempts_left <= 0:
                capture["endReason"] = "disconnected"
                break
            resumed = False
            while attempts_left > 0 and not STOP.requested and time.monotonic() < deadline:
                attempts_left -= 1
                time.sleep(reconnect["delayMs"] / 1000)
                try:
                    connection.open(revoked_code="auth-revoked")
                    connection.subscribe(filters)
                except Ended as end:
                    if end.problem["code"] == "auth-revoked":
                        capture["endReason"] = "auth-revoked"
                        break
                    gap["reason"] = f"{gap['reason']}; reconnect: {end.problem['code']}"
                    connection.drop()
                    continue
                gap["reconnectedAt"] = stamp()
                resumed = True
                break
            run.save()
            if capture["endReason"] != "running":
                break
            if not resumed:
                capture["endReason"] = "stopped" if STOP.requested else ("duration" if time.monotonic() >= deadline else "disconnected")
                break
    capture["unsubscribed"] = False
    if connection.connected:
        capture["unsubscribed"] = connection.unsubscribe([f for f, _ in filters])
        connection.close()
    reason = capture["endReason"]
    if reason == "stopped":
        raise Ended("incomplete", "stopped", "VERA ended the capture (SIGTERM); capture.unsubscribed says whether the broker confirmed the UNSUBSCRIBE, and the client disconnected.")
    if reason == "auth-revoked":
        raise Ended("incomplete", "auth-revoked", "The broker refused the credential when the capture reconnected; messages before the gap are kept.")
    if reason == "disconnected":
        raise Ended("incomplete", "disconnected", "The connection was lost and the reconnect policy is used up; messages before the gap are kept.")


# ---- publish and request ----------------------------------------------------------------------------------------


def _send(run: Run, connection: Connection, entry: dict[str, Any], data: bytes, retain: bool, properties: Properties | None) -> tuple[str, int]:
    """Sends the PUBLISH once and waits for its outcome; the delivery is saved before the function returns."""
    published = run.document["publish"]
    info = connection.client.publish(entry["topic"], data, entry["qos"], retain, properties=properties)
    if info.rc != mqtt.MQTT_ERR_SUCCESS:
        published["delivery"] = "not-sent"
        run.save()
        raise Ended("incomplete", "disconnected", "The PUBLISH could not be sent; nothing was published.")
    published["delivery"] = "unknown"
    published["mid"] = info.mid
    timeout = run.profile.data["connect"]["timeoutMs"] / 1000
    connection.wait(lambda: info.mid in connection.published, timeout)
    code = connection.published.get(info.mid)
    if code is None:
        run.save()
        if STOP.requested:
            raise Ended("incomplete", "stopped", "VERA ended the run (SIGTERM) after the PUBLISH was sent and before it was acknowledged; it may have been delivered.")
        raise Ended("incomplete", "delivery-unknown", "The connection was lost or the broker did not acknowledge the PUBLISH; it may have been delivered and is not sent again.")
    if getattr(code, "is_failure", False):
        published["delivery"] = "refused"
        run.save()
        raise Ended("error", "not-authorized", f"The broker refused the PUBLISH: {code}.")
    published["delivery"] = "acknowledged" if entry["qos"] == 1 else "sent"
    run.save()
    return published["delivery"], info.mid


def _publish_document(run: Run, entry: dict[str, Any], data: bytes, retain: bool) -> None:
    run.document["publish"] = {
        "topic": entry["topic"],
        "kind": entry["kind"],
        "qos": entry["qos"],
        "retain": retain,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "delivery": "not-sent",
        "retried": False,
        "physical": "unknown" if entry["kind"] == "command" else None,
    }


def publish(run: Run) -> None:
    entry = run.publish_entry()
    retain = bool(run.args.retain)
    if retain and (entry["kind"] == "command" or not entry["retain"]):
        raise refused("retain-refused", "A retained command is never published; --retain applies only to data or status topics whose profile entry allows retain.")
    data = run.payload(entry)
    run.describe()
    _publish_document(run, entry, data, retain)
    connection = run.connect()
    _send(run, connection, entry, data, retain, None)
    connection.close()


def request(run: Run) -> None:
    entry = run.publish_entry()
    response = entry.get("response")
    if not response:
        raise refused("usage", f"{entry['topic']} declares no response topic; use publish.")
    if run.args.timeout is not None and not 100 <= run.args.timeout <= 60000:
        raise refused("usage", "--timeout takes 100 to 60000 ms.")
    data = run.payload(entry)
    correlation = secrets.token_hex(8)
    properties: Properties | None = None
    if run.profile.protocol == "5":
        properties = Properties(PacketTypes.PUBLISH)
        properties.ResponseTopic = response["topic"]
        properties.CorrelationData = correlation.encode("ascii")
    else:
        value = json.loads(data.decode("utf-8"))
        value[response["correlationField"]] = correlation
        data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(data) > run.profile.limits["maxPayloadBytes"]:
            raise refused("payload-invalid", "The payload with its correlation field exceeds limits.maxPayloadBytes.")
    run.describe()
    _publish_document(run, entry, data, False)
    uncorrelated: list[dict[str, Any]] = []
    run.document["request"] = {"correlation": correlation, "responseTopic": response["topic"], "response": None, "uncorrelated": uncorrelated}
    connection = run.connect()
    connection.subscribe([(response["topic"], 1)])
    _send(run, connection, entry, data, False, properties)
    timeout = (run.args.timeout or response["timeoutMs"]) / 1000
    deadline = time.monotonic() + timeout
    classifier = Classifier(run.profile)
    answer = None
    received = 0
    while answer is None:
        while connection.messages and answer is None:
            message = connection.messages.popleft()
            received += 1
            line = classifier.record(received, message)
            if message.retain:
                line["ignored"] = "retained"
                if len(uncorrelated) < MAX_UNCORRELATED:
                    uncorrelated.append(line)
                continue
            if run.profile.protocol == "5":
                got = getattr(message.properties, "CorrelationData", None) if message.properties else None
                matched = got is not None and bytes(got) == correlation.encode("ascii")
            else:
                try:
                    value = json.loads(bytes(message.payload).decode("utf-8"))
                except (UnicodeDecodeError, ValueError):
                    value = None
                matched = isinstance(value, dict) and value.get(response["correlationField"]) == correlation
            if matched:
                answer = line
            elif len(uncorrelated) < MAX_UNCORRELATED:
                uncorrelated.append(line)
        if answer is not None or STOP.requested or time.monotonic() >= deadline:
            break
        if not connection.pump(min(0.1, max(0.0, deadline - time.monotonic()))) and not connection.messages:
            break
    if answer is not None:
        run.document["request"]["response"] = answer
        if entry["kind"] == "command":
            run.document["publish"]["physical"] = "reported"
    run.save()
    if connection.connected:
        connection.unsubscribe([response["topic"]])
        connection.close()
    if answer is not None:
        return
    if STOP.requested:
        raise Ended("incomplete", "stopped", "VERA ended the run (SIGTERM) while waiting for the response; the request was delivered as recorded and is not revoked.")
    if not connection.connected and time.monotonic() < deadline:
        raise Ended("incomplete", "disconnected", "The connection was lost before a correlated response arrived; the request was delivered as recorded.")
    raise Ended("fail", "response-timeout", f"No response with correlation {correlation} arrived within {int(timeout * 1000)} ms; the command may have acted and is not sent again.")


def connect_test(run: Run) -> None:
    run.describe()
    connection = run.connect()
    connection.close()


OPERATIONS = {"connect-test": connect_test, "subscribe": subscribe, "publish": publish, "request": request}


def prepare(run: Run) -> None:
    """Every check that needs no packet, so a refusal comes before the run folder and the connection."""
    run.check_credential()
    if run.args.operation == "subscribe":
        subscribe_plan(run)
    elif run.args.operation in ("publish", "request"):
        entry = run.publish_entry()
        if run.args.operation == "publish" and run.args.retain and (entry["kind"] == "command" or not entry["retain"]):
            raise refused("retain-refused", "A retained command is never published; --retain applies only to data or status topics whose profile entry allows retain.")
        if run.args.operation == "request":
            if not entry.get("response"):
                raise refused("usage", f"{entry['topic']} declares no response topic; use publish.")
            if run.args.timeout is not None and not 100 <= run.args.timeout <= 60000:
                raise refused("usage", "--timeout takes 100 to 60000 ms.")
        run.payload(entry)
    # The credential is read last: a refusal above never consumes it.
    run.read_credential()

"""One broker connection of mqtt-tool on paho-mqtt 2.1.0 (spec REQ-DATA-96d18686 section 4).

The helper drives paho's `loop()` itself and never calls `loop_forever` or `loop_start`, so paho neither
reconnects nor resends on its own: a reconnect happens only where the operation asks for it (subscribe), and a
PUBLISH is sent once (REQ-REL-b1ff1dd3). Every session is clean (REQ-FUNC-1bc7512d). With TLS the certificate chain
and host name are verified in the handshake, before CONNECT is sent (REQ-SEC-bc6dcac7); each failure has its own
code (REQ-REL-023ba532).
"""

from __future__ import annotations

import secrets
import socket
import ssl
import time
from collections import deque
from typing import Any

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

from .credential import Credential
from .profile import Profile
from .report import Ended

AUTH_REFUSED = {134, 135, 140}  # bad user name or password, not authorized, bad authentication method
POLL = 0.05


class StopFlag:
    """Set by SIGTERM; every wait checks it."""

    requested = False


STOP = StopFlag()


def tls_context(profile: Profile) -> ssl.SSLContext | None:
    if not profile.data["tls"]["enabled"]:
        return None
    context = ssl.create_default_context(cafile=str(profile.ca)) if profile.ca else ssl.create_default_context()
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return context


class Connection:
    def __init__(self, profile: Profile, credential: Credential | None) -> None:
        self.profile = profile
        self.client_id = f"{profile.data['client']['idPrefix']}-{secrets.token_hex(4)}"
        self.v5 = profile.protocol == "5"
        self.client = mqtt.Client(
            callback_api_version=CallbackAPIVersion.VERSION2,
            client_id=self.client_id,
            protocol=mqtt.MQTTv5 if self.v5 else mqtt.MQTTv311,
            **({} if self.v5 else {"clean_session": True}),
        )
        self.client.enable_logger(None)
        if credential is not None:
            self.client.username_pw_set(credential.username or "", credential.password)
        context = tls_context(profile)
        if context is not None:
            self.client.tls_set_context(context)
        will = profile.data.get("will")
        if will:
            self.client.will_set(will["topic"], will["payload"].encode("utf-8"), will["qos"], will["retain"])
        self.client.connect_timeout = profile.data["connect"]["timeoutMs"] / 1000
        self.connack: Any = None
        self.session_present = False
        self.connected = False
        self.lost: str | None = None
        self.subacks: dict[int, list[Any]] = {}
        self.unsubacks: set[int] = set()
        self.published: dict[int, Any] = {}
        self.messages: deque[mqtt.MQTTMessage] = deque()
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_subscribe = lambda _c, _u, mid, codes, _p: self.subacks.__setitem__(mid, list(codes))
        self.client.on_unsubscribe = lambda _c, _u, mid, _codes, _p: self.unsubacks.add(mid)
        self.client.on_publish = lambda _c, _u, mid, code, _p: self.published.__setitem__(mid, code)
        self.client.on_message = lambda _c, _u, message: self.messages.append(message)

    def _on_connect(self, _client: Any, _userdata: Any, flags: Any, reason: Any, _properties: Any) -> None:
        self.connack = reason
        self.session_present = bool(getattr(flags, "session_present", False))
        self.connected = not reason.is_failure

    def _on_disconnect(self, _client: Any, _userdata: Any, _flags: Any, reason: Any, _properties: Any) -> None:
        if self.connected:
            self.lost = str(reason)
        self.connected = False

    def open(self, revoked_code: str = "auth-failed") -> None:
        """TCP, TLS, CONNECT and CONNACK; Ended with a distinct code on each failure."""
        self.connack, self.lost = None, None
        host, port = self.profile.data["broker"]["host"], self.profile.data["broker"]["port"]
        keepalive = self.profile.data["client"]["keepaliveS"]
        try:
            if self.v5:
                self.client.connect(host, port, keepalive, clean_start=True)
            else:
                self.client.connect(host, port, keepalive)
        except ssl.SSLCertVerificationError as error:
            raise Ended("error", "tls-failed", f"The broker's certificate was refused: {error.verify_message or error.reason}.") from None
        except ssl.SSLError as error:
            raise Ended("error", "tls-failed", f"The TLS handshake failed: {error.reason or type(error).__name__}.") from None
        except ConnectionRefusedError:
            raise Ended("error", "broker-unreachable", f"Nothing accepts connections at {host}:{port}.") from None
        except (socket.timeout, TimeoutError):
            raise Ended("error", "connect-timeout", f"{host}:{port} did not answer within {self.client.connect_timeout:g} s.") from None
        except OSError as error:
            raise Ended("error", "broker-unreachable", f"{host}:{port} cannot be reached: {error.strerror or type(error).__name__}.") from None
        deadline = time.monotonic() + self.profile.data["connect"]["timeoutMs"] / 1000
        while self.connack is None:
            if STOP.requested:
                self.drop()
                raise Ended("incomplete", "stopped", "VERA ended the run (SIGTERM) before the broker accepted the connection.")
            if time.monotonic() > deadline:
                self.drop()
                raise Ended("error", "connect-timeout", f"The broker sent no CONNACK within {self.profile.data['connect']['timeoutMs']} ms.")
            if self.client.loop(timeout=POLL) != mqtt.MQTT_ERR_SUCCESS and self.connack is None:
                raise Ended("error", "broker-unreachable", "The broker closed the connection before CONNACK.")
        if self.connack.is_failure:
            self.drop()
            if self.connack.value in AUTH_REFUSED:
                raise Ended("error" if revoked_code == "auth-failed" else "incomplete", revoked_code, f"The broker refused the credential: {self.connack}.")
            raise Ended("error", "protocol-error", f"The broker refused the connection: {self.connack}.")

    def pump(self, seconds: float = POLL) -> bool:
        """Runs the network loop for up to `seconds`; False once the connection is lost."""
        end = time.monotonic() + seconds
        while True:
            if not self.connected:
                return False
            if self.client.loop(timeout=min(POLL, max(0.0, end - time.monotonic()))) != mqtt.MQTT_ERR_SUCCESS:
                if self.connected:
                    self.lost = self.lost or "connection lost"
                self.connected = False
                return False
            if time.monotonic() >= end:
                return self.connected

    def wait(self, ready: Any, seconds: float, stoppable: bool = True) -> bool:
        """Pumps until `ready()` holds, the time is up, Stop is requested (when `stoppable`) or the connection is lost."""
        deadline = time.monotonic() + seconds
        while not ready():
            if (stoppable and STOP.requested) or time.monotonic() > deadline or not self.pump():
                return bool(ready())
        return True

    def subscribe(self, filters: list[tuple[str, int]]) -> list[Any]:
        result, mid = self.client.subscribe(filters)
        if result != mqtt.MQTT_ERR_SUCCESS:
            raise Ended("incomplete", "disconnected", "The subscription could not be sent.")
        timeout = self.profile.data["connect"]["timeoutMs"] / 1000
        if not self.wait(lambda: mid in self.subacks, timeout):
            if STOP.requested:
                raise Ended("incomplete", "stopped", "VERA ended the run (SIGTERM) before the broker granted the subscription.")
            if not self.connected:
                raise Ended("incomplete", "disconnected", "The connection was lost before the broker granted the subscription.")
            raise Ended("error", "connect-timeout", "The broker sent no SUBACK.")
        codes = self.subacks[mid]
        refused = [filter_ for (filter_, _), code in zip(filters, codes) if code.is_failure]
        if refused:
            raise Ended("error", "not-authorized", f"The broker refused the subscription to {', '.join(refused)}.")
        return codes

    def unsubscribe(self, filters: list[str]) -> bool:
        if not self.connected:
            return False
        result, mid = self.client.unsubscribe(filters)
        # Not cut short by Stop: the UNSUBACK is what lets the result say the subscription ended.
        return result == mqtt.MQTT_ERR_SUCCESS and self.wait(lambda: mid in self.unsubacks, 2.0, stoppable=False)

    def close(self) -> bool:
        """A normal DISCONNECT, so the broker publishes no Will; False when the connection was already gone."""
        if not self.connected:
            self.drop()
            return False
        self.client.disconnect()
        for _ in range(10):
            if self.client.loop(timeout=POLL) != mqtt.MQTT_ERR_SUCCESS:
                break
        self.drop()
        return True

    def drop(self) -> None:
        self.connected = False
        try:
            sock = self.client.socket()
            if sock is not None:
                sock.close()
        except OSError:
            pass

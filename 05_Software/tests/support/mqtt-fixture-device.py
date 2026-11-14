"""A fixture device and publisher for the mqtt-tools tests, on paho-mqtt over the test broker's plaintext port.

  device  HOST PORT USER PASSWORD PROTOCOL COMMAND_TOPIC [--field NAME] [--decoy] [--silent]
          Subscribes to COMMAND_TOPIC and answers each command on its response topic: MQTT 5 by the request's
          ResponseTopic and CorrelationData, 3.1.1 on COMMAND_TOPIC + "/reply" echoing the JSON field NAME.
          --decoy first sends a reply with another correlation; --silent never answers. Prints READY.
  publish HOST PORT USER PASSWORD MESSAGES_JSON
          Publishes [{topic, payloadBase64, qos, retain}] in order (QoS 1 waits for PUBACK), then disconnects.

A test fixture standing in for a device; no real hardware is involved.
"""

import base64
import json
import sys
import time

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties


def client(protocol: str, client_id: str, user: str, password: str) -> mqtt.Client:
    version = mqtt.MQTTv5 if protocol == "5" else mqtt.MQTTv311
    c = mqtt.Client(
        callback_api_version=CallbackAPIVersion.VERSION2,
        client_id=client_id,
        protocol=version,
        **({} if version == mqtt.MQTTv5 else {"clean_session": True}),
    )
    c.username_pw_set(user, password)
    return c


def device(host, port, user, password, protocol, topic, rest) -> None:
    field = rest[rest.index("--field") + 1] if "--field" in rest else "id"
    decoy, silent = "--decoy" in rest, "--silent" in rest
    c = client(protocol, "fixture-device", user, password)

    def on_message(cl, _u, msg):
        if silent:
            return
        if protocol == "5":
            props = msg.properties
            target = getattr(props, "ResponseTopic", None)
            correlation = getattr(props, "CorrelationData", None)
            if not target:
                return
            if decoy:
                other = Properties(PacketTypes.PUBLISH)
                other.CorrelationData = b"not-yours"
                cl.publish(target, b'{"ok": false}', 1, properties=other)
            reply = Properties(PacketTypes.PUBLISH)
            reply.CorrelationData = correlation
            cl.publish(target, json.dumps({"ok": True, "echo": json.loads(msg.payload)}).encode(), 1, properties=reply)
        else:
            request = json.loads(msg.payload)
            target = topic + "/reply"
            if decoy:
                cl.publish(target, json.dumps({field: "not-yours", "ok": False}).encode(), 1)
            cl.publish(target, json.dumps({field: request.get(field), "ok": True}).encode(), 1)

    def on_subscribe(*_args):
        print("READY", flush=True)

    c.on_message = on_message
    c.on_subscribe = on_subscribe
    c.connect(host, int(port), 30)
    c.subscribe(topic, 1)
    c.loop_forever()


def publish(host, port, user, password, messages_path) -> None:
    messages = json.loads(open(messages_path, encoding="utf-8").read())
    c = client("5", "fixture-publisher-" + str(time.time_ns())[-6:], user, password)
    c.connect(host, int(port), 30)
    c.loop_start()
    for message in messages:
        info = c.publish(message["topic"], base64.b64decode(message["payloadBase64"]), message.get("qos", 1), message.get("retain", False))
        info.wait_for_publish(5)
    c.disconnect()
    c.loop_stop()
    print("PUBLISHED", len(messages), flush=True)


if __name__ == "__main__":
    mode, *args = sys.argv[1:]
    if mode == "device":
        device(*args[:6], args[6:])
    else:
        publish(*args[:5])

# MQTT tools (telemetry and commands)

This plugin lets the agent capture MQTT telemetry and send controlled device commands on a broker that your workbench configures. Captures are bounded by time, message count and bytes, and keep every raw payload with its flags. A message goes only to a topic the broker profile declares, is sent once and never retried, and a command is never retained. MQTT 5 and 3.1.1 are supported; there is no broker administration. Results go to `arduino-iot-results/`.

## What it needs

- **mqtt-tool**, a Python script in the plugin pinned to paho-mqtt 2.1.0, which VERA installs itself with **Install dependencies**.
- A **broker profile**: a JSON file in the workbench that declares the broker, TLS trust, the credential reference, the protocol, the topics a capture may subscribe to and a run may publish to, limits, payload schemas and an optional status Last Will.
- The **broker credential** (`broker-credential`): a username and password stored under the reference the profile names, for example `bench`. Set it in the plugin page's **Configuration** section. It stays in VERA's credential store and only reaches an approved run of this plugin; never paste it into the chat.

## How to use it

The agent uses the `mqtt-telemetry` and `mqtt-commands` skills.

- "Check the broker profile mqtt/bench.json and test the connection with the bench credential."
- "Capture vera-test/bench1/telemetry/# for 30 seconds and count the new messages."
- "Publish online to the status topic vera-test/bench1/status/vera."
- "Send the LED command {"on":true} and wait for the device's response."

## Risk and approvals

- **Safe** (runs without asking): describing the client and checking a profile offline.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): a connection test and a bounded capture. Nothing is published, except the status Last Will if the connection ends abnormally.
- **Device write** (asks in **Ask** and **Auto-edit**): publishing one message or sending a request; a command may make a device act. Stop cannot take back a sent message.
- **Irreversible** (asks, and you type the confirmation word shown on the card): publishing a retained message, which the broker keeps and delivers to every later subscriber until it is replaced. In **Bypass — full access** this runs without asking.

Before you approve a run that names a credential, check the profile's broker host: the credential goes to that broker.

## Limits

- Windows x64 and Linux x64.
- QoS 2 is not supported. A QoS 1 message may reach the device twice through broker redelivery.
- If the connection is lost before the acknowledgement, delivery is reported as unknown.
- The plugin has not yet run against a product broker or a real device.

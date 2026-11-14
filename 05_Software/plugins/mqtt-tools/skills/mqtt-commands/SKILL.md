---
name: mqtt-commands
description: How to publish MQTT messages and send device commands with mqtt-tool - declared topics only, schema-checked payloads, request/response with correlation, no retained commands and no retries, and how to read delivery and physical state. Use whenever a task sends a command or data to a device over MQTT.
---
# mqtt-commands

A command topic may make a device act (a relay, a motor, a heater). Say what the command does before you run it.

## Publish

`mqtt-tool publish --profile mqtt/bench.json --credential bench --topic vera-test/bench1/status/vera --payload online`

- Only topics the profile's `publish` list declares; the payload must satisfy the topic's schema (`payload-invalid`
  otherwise). Use `--payload-file` for binary or long payloads.
- `--retain` only on a `data` or `status` topic whose entry allows retain: the broker keeps the message for every
  later subscriber until it is replaced. A command is never retained (`retain-refused`).

## Request and response

`mqtt-tool request --profile mqtt/bench.json --credential bench --topic vera-test/bench1/cmd/led --payload '{"on":true}'`

- mqtt-tool subscribes to the declared response topic first, publishes once with a fresh correlation (MQTT 5
  correlation data; 3.1.1 the profile's JSON field) and accepts only the response that carries it. Replies with
  another correlation are listed under `request.uncorrelated` and ignored.
- `response-timeout` (exit 1): no matching reply in time. The command was delivered as `publish.delivery` says and may
  have acted: `physical` stays `unknown`. Do not send it again on your own; ask the user.

## Delivery

- `acknowledged` (QoS 1 PUBACK), `sent` (QoS 0 written), `refused` (the broker refused it), `not-sent`, or `unknown`
  (`delivery-unknown`: the connection was lost after sending and before the acknowledgement). `retried` is always
  false: mqtt-tool never sends a command twice and never reconnects to do it.
- A QoS 1 message may still reach the device twice (broker redelivery); devices should ignore a repeated id.
- Stop or a lost connection does not take back a message already sent, or a Will the broker already published.

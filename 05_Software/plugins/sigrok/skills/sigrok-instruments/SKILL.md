---
name: sigrok-instruments
description: Identify sigrok bench instruments, read values and request approval before configuring power supplies, loads, generators or relays.
---

Use `--list-serial` and a targeted `--driver <driver> --scan` to identify
the device. Match the observed instrument, connection and channel.
Use `--show` to inspect the selected driver and `--get <key>` for supported
configuration reads. Prefer a short bounded capture for time-varying meter
readings. For example, `--driver korad-kaxxxxp:conn=COM3 --get voltage`
reads voltage if the device was identified at COM3.

Separate reads from configuration. sigrok-cli applies `-c` before
`--get` or capture, so a command with `-c` on an output-driving driver
can change the bench. Before proposing `--set`, explain the exact device,
channel, setting, proposed value and physical effect. Wait for the approval
card's typed confirmation in Ask mode for a supply, load, generator, relay
or ATK PWM change. Never ramp outputs in a loop. Verify an authorized
change with a separate read and report the observed result.

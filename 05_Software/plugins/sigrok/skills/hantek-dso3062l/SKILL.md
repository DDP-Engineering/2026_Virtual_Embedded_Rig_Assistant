---
name: hantek-dso3062l
description: Use the DDP Hantek DSO-3062L mixed-signal driver for bounded frames and inspect analog ranges, logic channels and triggers.
---

Check `-L` for `hantek-dso3062l`. If truncated, use
`--driver hantek-dso3062l --show` to check driver support. A driver can be
present even when no device is found. If the driver is absent, report that
the installed CLI lacks it. The USB identity is `04b5:3062`. Use the targeted
`--driver hantek-dso3062l --scan` and `--show` before capture.

- The driver exposes two analog channels and D0–D15. Use `--show` to
  confirm exact names and group settings. Analog groups have volts/div
  (`vdiv`) and DC, AC or GND coupling. The nine hardware ranges use factory
  offset calibration.
- Use `--frames 1 -O srzip -o captures/scope.sr` for a single capture.
  Start with a shallow record and select an advertised sample rate. A
  single analog channel interleaves two ADC cores, while the logic channels
  advance at the point rate. Deep records approach 16 M points and constrain
  feasible trigger position and sample-rate combinations.
- Select triggers on a connected channel. Roll is the continuous
  acquisition mode. Use background execution only for requested continuous
  work and verify the resulting trace.

The fork's `04_HardwareDocu/Hantek_DSO3062L/Protocol_Reference.md` describes
the record geometry, trigger limitations and analog front end.

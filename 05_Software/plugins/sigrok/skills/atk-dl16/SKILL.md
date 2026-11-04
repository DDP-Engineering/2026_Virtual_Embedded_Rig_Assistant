---
name: atk-dl16
description: Use the DDP ATK-DL16 logic analyzer for triggered captures and distinguish capture settings from PWM output changes.
---

Check `-L` for `atk-dl16`. If truncated, use `--driver atk-dl16 --show`
to check driver support. A driver can be present even when no device is found.
If the driver is absent, report that the installed CLI lacks it.
Use `--driver atk-dl16 --scan` for USB `1a86:ffcc`,
then inspect `--show`. The physical header and capture use D0–D15.

- Use a bounded capture first, for example `--config samplerate=10m
  --samples 100000 -O srzip -o captures/atk.sr`. Choose the threshold,
  sample rate and channels from the observed setup. The fork verified
  1–500 MHz with all 16 inputs and caps depth at 256 Msamples. Continuous
  throughput is lower than the buffered acquisition rates.
- Trigger on a connected input, for example `-t D8=r -w`. A floating
  input can trigger spuriously. A condition that never occurs can yield
  zero samples and no file.
- PWM0 and PWM1 are physical generator outputs. Group settings include
  `enabled`, `output_frequency` and `output_duty_cycle`. Inspect the
  advertised units and explain the wiring and requested output change
  before proposing a separately approved command. Keep PWM settings out of
  capture and read commands.

The fork's `04_HardwareDocu/ATK_DL16/Protocol_Extraction.md` records the
trigger, sample-rate and PWM bench measurements.

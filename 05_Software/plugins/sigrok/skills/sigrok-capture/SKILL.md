---
name: sigrok-capture
description: Discover a local sigrok instrument and capture a bounded digital or analog trace to a workbench srzip file.
---

Use `run_program` with program `sigrok-cli` and separate arguments. Check
`-L` before using fork-only drivers. If the result is truncated, absence from
the tail is inconclusive. Use `--driver <id> --show` or the full log in Runs.
If `atk-dl16` or `hantek-dso3062l` is unavailable, report which driver is missing
and point the user to **Install programs** for the DDP fork. Use `--scan`,
preferably with the expected `--driver`, then
`--driver <driver> --show` to inspect available channels and options.
Specify the observed connection as `<driver>:conn=<connection>` if needed.
Never guess a connection from an example.

Create `captures/` in the workbench and choose an unused filename. Use an
explicit driver, sample rate, channels and a bound such as `--samples`,
`--time` (milliseconds), or `--frames`. Select a sample rate suited to the
signal and the device's advertised limits. For example, with ATK-DL16
connected and D0 through D2 selected:

```text
sigrok-cli --driver atk-dl16 -C D0,D1,D2 -c samplerate=10m --samples 100000 -o captures/logic.sr -O srzip
```

Use `-t D0=r -w` only when the device advertises that trigger and the wire is
connected. Choose srzip for triggered captures. Avoid sending raw samples to
stdout. Report the workbench-relative path, capture settings and whether the
file exists and contains samples. A trigger timeout or empty trace calls for
checking the input and trigger before retrying.

Use `--continuous` only for a requested streaming capture, with
`background: true`. Monitor the handle with `program_output`, end with
`program_stop`, and verify the resulting srzip opens before reporting it.
Prefer a bounded capture when a complete saved trace is required.

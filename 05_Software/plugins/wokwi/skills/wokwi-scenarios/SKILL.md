---
name: wokwi-scenarios
description: How to write a Wokwi scenario YAML that wokwi-tool accepts - name, version 1 and steps of delay, wait-serial, write-serial, set-control and expect-pin on parts of the diagram - and which wokwi-cli commands it refuses. Use whenever a task writes or fixes a Wokwi test scenario.
---
# wokwi-scenarios

```yaml
name: Button lights the LED
version: 1
steps:
  - wait-serial: ready
  - set-control:
      part-id: btn1
      control: pressed
      value: 1
  - delay: 200ms
  - expect-pin:
      part-id: led1
      pin: A
      value: 1
```

- One command per step, plus an optional `name`. Supported: `delay` (a time with units: `500ms`, `2s`, `100us`),
  `wait-serial` (text), `write-serial` (text or a list of bytes), `set-control` (`part-id`, `control`, numeric
  `value`), `expect-pin` (`part-id`, `pin`, `value` 0 or 1).
- Every `part-id` must be a part of the job's diagram.json; `pin` and `control` names are the part's own (see the
  Wokwi part reference, and validate-diagram's linter for pins).
- Refused as unsupported-input: `take-screenshot`, `expect-chip-output`, `touch`, `touch-press`, `touch-release`,
  `touch-move` and any other key. Use prepare-job's `--screenshot-part` and `--screenshot-ms` for a screenshot.
- A scenario with `--expect-text` in the same job is refused: wokwi-cli would end at whichever finishes first.
- Delays are simulated time. Keep their sum well below `--virtual-timeout-ms`, or the run ends virtual-timeout.
- A scenario passes only when every step completes; an `expect-pin` mismatch fails at the simulated nanosecond shown.

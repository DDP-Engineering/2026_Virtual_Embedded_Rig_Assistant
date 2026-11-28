---
name: probe-rs-test
description: How to run firmware tests on the board with probe-rs run and read which passed, for embedded-test suites and for firmware that ends by itself through semihosting. Use when the user wants on-target unit tests or a self-test executed and judged.
---
# probe-rs-test

Load `probe-rs-connect` first: every command below also takes `--probe S --chip C --non-interactive`.

`probe-rs run <elf>` flashes the ELF, starts it and waits until the firmware ends. Run it in the
foreground: it is device-write, one approval per run, and the ELF's SHA-256 is on the approval.

| Command | Use |
|---|---|
| `probe-rs run <tests.elf>` | flash and run every test of an embedded-test binary |
| `probe-rs run <tests.elf> --list` | list the tests instead of running them |
| `probe-rs run <tests.elf> <filter>` | only the tests whose name contains `filter`; `--exact` for the whole name |
| `probe-rs run <tests.elf> --skip-test <filter>` | all but those (the option may be repeated) |
| `probe-rs run <tests.elf> --format json` | the report as JSON; also `pretty` and `terse` |
| `probe-rs run <app.elf>` | firmware that ends itself through semihosting: a self-test |

## Procedure

1. Use the test ELF the build produced (for Rust, the path `cargo test --no-run` prints). The test
   options work only when the ELF was built with embedded-test; otherwise probe-rs says the binary
   does not contain embedded-test.
2. Always pass `timeout` (seconds, up to 3600): the time the suite should need plus a margin. Each
   test restarts the target, so a suite takes longer than its tests alone, and firmware that never
   ends would otherwise hold the run for an hour.
3. Read the verdict from the exit code and the summary: exit 0 when every test passed; a failure ends
   with `Some tests failed` and a non-zero exit code. Report the failed tests by name with their
   output; the run log holds the full report.
4. `--ignored` runs only the tests marked ignored, `--include-ignored` runs them too.
5. Firmware without embedded-test is judged by how it ends: `Firmware exited successfully` (exit 0),
   `Firmware exited with: ...` or `Firmware exited unexpectedly: ...` (an error, with a stack trace).
   For firmware that never ends, use `probe-rs-rtt` instead.

For a test that also needs instruments, a serial port or a pass/fail report over several steps, use the
hil-testing plugin.

---
name: probe-rs-rtt
description: Start, follow and stop bounded background RTT logs with probe-rs attach or run, using the exact build ELF and explicit local probe selection.
---

Load probe-rs-connect. Confirm the probe/chip and that firmware supplies RTT (and defmt metadata if
applicable). Use the exact ELF matching the target to locate RTT and decode defmt. All examples use
observed values, not guessed selectors. Use `run_program` with `background: true`:

- `attach --probe <selector> --chip <chip> --non-interactive <build.elf>` attaches without flashing
  or resetting; device-read may still briefly halt the target.
- `run --probe <selector> --chip <chip> --non-interactive <build.elf>` flashes, starts and logs;
  device-write requires the same exact-file/hash review as probe-rs-flash.

Save the returned handle and log path. Call `program_output` with that handle, `until` set to a
specific expected log pattern and `waitMs: 10000` (maximum 30000 per call). A timeout or empty output
is not success: inspect `running`, `matched`, exit code and truncation, then perform bounded additional
reads or stop and diagnose. Preserve the full log; results retain only the capped tail. A background
run without an explicit timeout has no automatic duration limit; set a task-appropriate timeout
(the plugin caps requested timeouts at 120 seconds) or reliably stop it after observation.

Always call `program_stop` with the handle after the expected observation, failure, cancellation or
before another operation needs the probe. Report the stopped outcome. Existing process-tree cleanup
and serial-port guards apply; a USB --probe selector is not a serial-port lock. Avoid concurrent
operations on the same USB probe. No interactive REPL/server is needed.

VERA closes stdin. RTT input is unsupported: do not wait for a prompt or try to send an RTT command.
In 0.32.0 a discovered down channel activates the upstream readline UI; its error/EOF paths differ
from output-only RTT. Real down-channel streaming with closed stdin still requires bench validation.
Prefer firmware with only up channels for output capture. If a run exits or stalls when a down channel
appears, retain the log and report the limitation; never claim a working stream based on replay.

With no ELF, 0.32.0 permits `attach`, but it needs an explicitly known `--scan-region <address|start..end|ram>`
to find RTT; otherwise it does not scan/poll. Prefer the ELF symbol over a broad RAM scan. Use
`--rtt-channel-mode no-block-skip` only when dropping logs is acceptable: default block-if-full can
stall firmware while nobody drains RTT. Do not use the removed --rtt-scan-memory option.

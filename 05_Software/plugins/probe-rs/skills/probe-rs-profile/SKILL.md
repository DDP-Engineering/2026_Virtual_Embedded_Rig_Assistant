---
name: probe-rs-profile
description: How to measure where running firmware spends its time with probe-rs profile, as a list of functions by share of samples. Use when firmware is slow, misses deadlines or draws CPU time for no known reason.
---
# probe-rs-profile

Load `probe-rs-connect` first: every command below also takes `--probe S --chip C --non-interactive`.

`probe-rs profile` samples the program counter for a fixed time and names the functions from the ELF:

`probe-rs profile --probe S --chip C --non-interactive --duration 10 build/app.elf flat --line-info --limit 25 pcsr`

| Part | Meaning |
|---|---|
| `--duration <seconds>` | how long to sample; required |
| `<elf>` | the ELF of the firmware on the board; another build gives wrong names |
| `flat` | one line per function that was executing; put its options right after it |
| `--limit <n>` | how many functions to list (default 25); `--line-info` adds file and line |
| `pcsr` | sample through the debug unit without stopping the core (ARM only; not every core has it) |
| `naive` | halt, read the program counter, resume, for every sample: works everywhere, slows the firmware |
| `itm <clock Hz> <baud>` | sample through the SWO pin (ARM, SWO wired) |

## Procedure

1. Profile the firmware as it runs now: the command is device-read and neither flashes nor resets. Bring
   the board into the state the user asks about first (the slow screen, the busy loop).
2. Try `pcsr` first on an ARM Cortex-M. When it fails or returns no samples, and on RISC-V and
   Xtensa, use `naive` and tell the user it disturbs timing: anything time-critical (motor control,
   radio, USB) may misbehave while it runs.
3. The run ends by itself after `--duration`; it may take up to 30 minutes in all.
4. The output is `Samples <n>` and then one line per function, `<function> - <share>%`, largest first.
   Report the top entries with their shares. An idle or sleep function at the top means the CPU mostly
   waits; many samples in a fault handler or a busy-wait loop is a finding.
5. `--reset` restarts the target before sampling, to profile start-up. `--flash` writes the ELF first:
   that is a device-write run with an approval.

---
name: probe-rs-inspect
description: Read bounded target memory or peripheral registers with probe-rs, decode using an available SVD tool, and map captured fault PC/LR through exact-build binutils.
---

Load probe-rs-connect. Confirm the exact chip/core, register address and access semantics from the
matching SVD/reference manual before reading. A peripheral read can clear status bits or pop a FIFO;
device-read may also halt the target. Do not scan unknown peripheral ranges or invent addresses.

Use `run_program` program `probe-rs`, e.g.
`read b32 <register-address> 1 --probe <selector> --chip <chip> --non-interactive --format hex-table`.
Widths are `b8`, `b16`, `b32`, `b64`; the final number is a count of words, not bytes (b32 4 reads
16 bytes). Choose the documented width/alignment and smallest useful count. Use `--core <index>`
only for a core verified from the target description.

In 0.32.0 the default is `hex-table`: each row begins with its address and colon, followed by
width-padded hex values. Do not interpret the row address as a register value. `--format simple-hex`
returns a space-separated list of width-padded hexadecimal words without row addresses, useful for
decoding a single register. Other formats are `ihex` and `binary`; `--output <file>` writes the
selected format to a file. The introductory help's older default description is stale.

If `decode_register` (CAP-02) is actually available in the current tool list, use it with the matching
SVD-derived register definition and observed value, following its real schema. If absent, do not
invent or call that tool: report the raw value and decode named fields only from a verified register
definition, citing it; state what remains unknown. Reserved bits are not named behavior.

For an ARM HardFault, obtain the captured stack-frame address from firmware/debug evidence, then
read the eight stacked b32 words only when the frame location is established. Basic frames contain
R0/R1/R2/R3/R12/LR/PC/xPSR; extended floating-point frames need their correct offset. Never guess SP
or treat EXC_RETURN as a code LR. Preserve raw PC/LR and build identity. Load crash-decode and use
binutils `arm-none-eabi-addr2line -e <exact.elf> -a -f -C -i <PC> <LR>`; for RISC-V addresses use
`riscv-none-elf-addr2line`. Xtensa needs the matching esp32-idf addr2line, not the ARM/RISC-V binaries.
Report unresolved `??`/`:0`, and use bounded objdump ranges for context.

`write b32 <address> <value>...` has a different trailing argument meaning (values, not count).
Every write remains irreversible, including RAM-looking addresses: option registers can permanently
protect flash and GPIO writes drive pins. Do not write to inspect or test a register.

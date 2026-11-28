---
name: probe-rs-inspect
description: How to read target memory and peripheral registers with probe-rs, decode a register value into its fields and turn fault addresses into source lines. Use to check what a register or variable holds on a live board.
---
# probe-rs-inspect

Load `probe-rs-connect` first: every command below also takes `--probe S --chip C --non-interactive`.

| Command | Risk | Use |
|---|---|---|
| `probe-rs read b32 <address> <count>` | device-read | read `count` words of 32 bits; also `b8`, `b16`, `b64` |
| `probe-rs read b32 <address> 1 --format simple-hex` | device-read | one register as a bare hex value |
| `probe-rs read b8 <address> <bytes> --format binary --output <file>` | device-read | a memory range into a file |
| `probe-rs write b32 <address> <value>...` | device-write | write words; asks the user first |

## Procedure

1. Take the address, width and meaning of a register from the chip's SVD or reference manual, never
   from memory of another chip. Reading can have effects: some status registers clear on read and a
   data register pops a FIFO. Do not sweep unknown peripheral ranges.
2. Read: `probe-rs read b32 0x40023800 1 --probe S --chip C --non-interactive`. The last number counts
   words, not bytes (`b32 4` reads 16 bytes). The address may be decimal, `0x` hex or `0o` octal. Add
   `--core <index>` only on a multi-core chip.
3. The default output is `hex-table`: `<address>: <word> <word> ...`; the part before the colon is
   the address, not data. `--format simple-hex` prints only the words; `ihex` and `binary` are for
   files (`--output <file>`).
4. Decode the value with `decode_register` and a register definition for this exact chip (a JSON
   device definition, for example one made from its SVD file). Without a definition report the raw
   value and name only the fields the reference manual documents; reserved bits have no meaning.
5. A read may halt the core for a moment. Reading megabytes takes minutes; a read may run for up to
   30 minutes.

## Faults

- The easy way to a crash location is `probe-rs attach <elf>`: it stops on the fault and prints the
  stack trace (skill `probe-rs-rtt`).
- For addresses you already have (PC and LR from a log or a fault handler), load `crash-decode`
  (plugin binutils): `arm-none-eabi-addr2line -e <exact.elf> -a -f -C -i <PC> <LR>`, or
  `riscv-none-elf-addr2line` for RISC-V. Xtensa needs the addr2line of esp32-idf. Use the ELF of the
  firmware on the board; an `EXC_RETURN` value (`0xFFFFFFxx`) in LR is not a code address.
- On Cortex-M3 and above the fault status is in `CFSR` at `0xE000ED28`, `HFSR` at `0xE000ED2C`, and the
  faulting address in `BFAR` at `0xE000ED38` or `MMFAR` at `0xE000ED34` when CFSR marks it valid.

## Do not

- `probe-rs write` only when the user asks to change a value. A write to a flash controller or option
  register can lock the chip for good, and a write to a GPIO register drives pins.
- `probe-rs trace` never ends and prints binary: read the address again with `read` to watch a value.

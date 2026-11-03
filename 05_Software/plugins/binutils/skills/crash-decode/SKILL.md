---
name: crash-decode
description: Decode ARM HardFault PC/LR or RISC-V crash addresses to functions and source lines using the exact build ELF and inline frame information.
---

Obtain the fault log, stacked PC and LR (ARM), or the RISC-V exception PC and return address. Label
each address and distinguish code addresses from stack pointers. Use only the exact ELF corresponding
to the flashed/crashing build: record its path, revision/configuration and identity/hash when known.
An ELF from a later rebuild can produce plausible but incorrect lines. Never invent a matching build.

1. Load elf-inspect if architecture or section mapping is uncertain. Use `arm-none-eabi-addr2line` for
   ARM and `riscv-none-elf-addr2line` for RISC-V through `run_program`. Espressif targets use esp32-idf.
2. Invoke `addr2line -e <exact.elf> -a -f -C -i <PC> <LR>`: `-a` labels the address, `-f` prints the
   function, `-C` demangles, and `-i` expands inline callers. Report each frame's file and line and cite
   the matching source; inline output may include several frames per address.
3. An ARM LR like `0xfffffff9` is EXC_RETURN, not a code location. Find the stacked LR/PC in the fault
   frame instead. Preserve raw addresses; if the Thumb bit is set, decode the normalized even address
   as well and label that adjustment. A return address identifies the instruction after a call: inspect
   the bounded surrounding instructions before claiming the call site; do not blindly subtract bytes.
4. Treat `??` or `:0` as unresolved. Check debug info, ELF identity, architecture, relocation/load base,
   flash mapping and stripped symbols. Report the limitation explicitly instead of guessing a line.

For context use `objdump --disassemble=<symbol> -S <exact.elf>` or a small explicit address interval.
Avoid whole-image disassembly. Keep the full run log; the result is capped at the existing last
12,000 characters. Decoding known fixture addresses establishes tool operation, not a hardware fault.

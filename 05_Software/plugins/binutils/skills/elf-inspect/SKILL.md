---
name: elf-inspect
description: Inspect ARM or RISC-V ELF headers, sections, load segments and one function, checking the linker script and flash offsets.
---

Identify the build and ELF path first. Run the matching resolved `arm-none-eabi-readelf` or
`riscv-none-elf-readelf` through `run_program` with `-h -S -l <firmware.elf>`. Read the ELF machine,
entry point, section flags and section-to-segment mapping. Use `-W` if wide names would be cut off.
Read the actual linker script and build/map output with file tools; do not infer placement from names.

Compare virtual addresses (run-time RAM/flash), physical/load addresses, file offsets and segment
file/memory sizes. A file offset is not automatically a flash offset. `.bss`/NOBITS has memory size
without image bytes; `.data` can have a RAM VMA and flash LMA. Check each segment against MEMORY
regions and the flasher's documented base/partition offsets. Never guess offsets or flash anything
with this plugin. Espressif toolchains and build metadata belong to esp32-idf.

Disassemble only the function being investigated:

```
<prefix>objdump --disassemble=<mangled-symbol> -S firmware.elf
<prefix>objdump -d --start-address=0x08000000 --stop-address=0x08000040 firmware.elf
```

Use `nm -S -C` to find the size and identity, and non-demangled `nm` when selecting a C++ symbol for
`--disassemble=`. Address intervals need both bounds and an executable section. Do not run `-d`/`-D`
over the whole image. The runner retains the full log and returns its last 12,000 characters;
check `truncated` and narrow the symbol/interval or read a bounded log chunk when necessary.

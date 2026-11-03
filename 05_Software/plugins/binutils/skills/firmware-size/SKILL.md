---
name: firmware-size
description: Compare two ARM or RISC-V firmware ELF builds, explain flash and RAM growth, and rank the symbols that grew most.
---

Use `run_program` with the resolved `arm-none-eabi-` or `riscv-none-elf-` programs. Confirm architecture
and identify both build revisions, configuration, linker scripts and exact ELF paths. Keep identical
build options when attributing changes to source. If a tool is missing, ask the user to install
programs in Plugins; discovery never installs it. Espressif ELF files use the esp32-idf plugin.

1. Run `<prefix>size -A before.elf` and `size -A after.elf` to compare sections; `size -B` supplies
   text/data/bss totals. Report before, after and signed delta in bytes. Debug sections do not consume
   target memory. Initialized `.data` consumes both RAM and its flash load image; `.bss` consumes RAM.
   Derive actual flash/RAM placement from the linker script and `readelf -l`, including custom sections.
2. Run `<prefix>nm -S --size-sort -C --defined-only before.elf` and the same command for after. Match
   symbols by demangled name and type, account for repeated local names, then subtract old size from new
   size. Sort positive deltas descending, including added symbols (old size zero), and list removed
   symbols separately. Report the largest growth with before/after/delta; do not confuse addresses
   with hexadecimal symbol sizes. Keep code, initialized data and BSS growth distinguishable.
3. Tie the ranked changes to source or map-file evidence using `read`/`grep`. Avoid attributing all
   section growth to the few named symbols: alignment, anonymous data and linker changes can contribute.
4. If `firmware-comparator` (CAP-03) is available in the skill catalog, load it and feed the measured
   section table, ranked symbol deltas and build identities into its comparison. Otherwise present
   those measurements directly.

Results contain only the existing last 12,000 characters; full command output is retained in the run
log. If `truncated` is true, read the log in bounded chunks before ranking symbols; a tail alone cannot
establish a complete diff. Never run whole-image `objdump -d` or `-D`. For a relevant function use
`objdump --disassemble=<symbol>` or explicit `--start-address` and `--stop-address`, as elf-inspect describes.

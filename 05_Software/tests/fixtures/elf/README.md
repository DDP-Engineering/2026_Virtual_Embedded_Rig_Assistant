# Tiny real ELF analysis corpus

These are freestanding executables, not text stubs or runnable host programs. They have no board
startup code and never need to run on hardware. `firmware.c` and `firmware.ld` are the complete inputs.
The before build has WORKSPACE=16; after has 64 and three additional operations in `grow`.

| Prefix | Machine / ABI | text before/after | data | bss before/after | grow before/after |
|---|---|---|---|---|---|
| arm-none-eabi | ELF32 little-endian ARM Cortex-M4 Thumb, soft float | 72 / 104 | 4 | 16 / 64 | 36 / 68 |
| riscv-none-elf | ELF32 little-endian RISC-V RV32IMAC, ILP32 | 94 / 142 | 4 | 16 / 64 | 44 / 92 |

Both have DWARF 4 line/function information (`-g -gdwarf-4`), unstripped symbols, code at 0x08000000,
initialized data at 0x20000000 with a flash load address and NOBITS BSS at 0x20000004. The largest
positive symbol deltas are ARM workspace +48 then grow +32; RISC-V workspace +48 and grow +48 (tie).
`crash_site` remains 36 ARM / 50 RISC-V bytes. Debug sections do not consume target flash/RAM.

Known after-build synthetic fault-frame addresses (not a real hardware HardFault):

| Architecture | PC: crash_site | LR/code address: grow | Expected source lines |
|---|---|---|---|
| ARM | 0x08000044 | 0x08000000 | firmware.c:18, firmware.c:8 |
| RISC-V | 0x0800005c | 0x08000000 | firmware.c:18, firmware.c:8 |

These point at function entry instructions; they are selected address-to-line test inputs, not a
claim that a real stacked LR points to a function entry. The ARM before crash_site is 0x08000024;
RISC-V before is 0x0800002c. Use `addr2line -e <after.elf> -a -f -C -i <PC> <LR>` and
`objdump --disassemble=crash_site <after.elf>` to inspect them. `readelf -h -S -l` verifies layout.

Rebuild from this directory or any cwd, with xPack ARM GCC 15.2.1-1.1 and RISC-V GCC 15.2.0-1:

```
python build.py --arm-bin <xpack-arm>/bin --riscv-bin <xpack-riscv>/bin
python build.py --arm-bin <xpack-arm>/bin --riscv-bin <xpack-riscv>/bin --check
```

Use `python3` on Linux. The script prints the exact hashes and uses no libraries/startup,
`-O0 -ffreestanding -fno-builtin -fno-unwind-tables -fno-asynchronous-unwind-tables -nostdlib`,
`-frandom-seed=vera-elf`, relative debug paths and no build ID. No generated map or timestamp is
committed. The fixture output is checked byte-for-byte when reproducing with `--check`.

SHA-256 of committed images:

- arm-none-eabi-before.elf: 7d613a0aaf6d4d0aeb376c04b14304647a339a33622e75b827a57c560b43009f
- arm-none-eabi-after.elf: fea620d3b425d97df109043f24d21de395fed8067e8e1968071775c7d15f3496
- riscv-none-elf-before.elf: adc8d41e677ff3e307ea315960b8f1ecd695f4ba4d756eeca0c04df4f8281d7e
- riscv-none-elf-after.elf: 814b2166769bb5400fe4b99e5d972031834d2141dce30e9051edf0379acb6f6e

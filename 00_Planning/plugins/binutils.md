# Plugin `binutils` — firmware image analysis

PURPOSE: specify the official `binutils` plugin, which lets the agent inspect firmware ELF files
with the GNU binary utilities: section and symbol sizes, symbol tables, headers, targeted
disassembly and crash-address decoding.
DONE-WHEN: on Windows x64 and Linux x64 the agent reports the size of two builds side by side with
the largest growing symbols, decodes a HardFault PC/LR to source lines, and disassembles one
function, using an ARM and a RISC-V toolchain that VERA found or installed.
STATUS: proposed 2026-11-01; not implemented. Plugin format and rules: [architecture.md](architecture.md).
Work package: PLG-20 in [plan.md](plan.md).

## 1. Scope

| Tool | Use |
|---|---|
| `size` | text/data/bss per image (`-B`) or per section (`-A`) |
| `nm` | symbols with sizes (`-S --size-sort -C`), for "what grew" questions |
| `readelf` | ELF header, sections, segments and load addresses (`-h -S -l`), compared with the linker script and flash offsets |
| `objdump` | targeted disassembly (`--disassemble=<symbol>`, `--start-address`/`--stop-address`, `-S` with sources) |
| `addr2line` | addresses to `function file:line` (`-e app.elf -f -C -i -a <addr>…`) |

Architectures in this plugin: ARM (`arm-none-eabi-`) and RISC-V (`riscv-none-elf-`). Espressif
toolchains (`xtensa-esp-elf-`, `riscv32-esp-elf-`) stay in `esp32-idf`, which finds them through EIM.
No program here touches hardware, so every rule is `safe`.

## 2. Provisioning: find first, download second

Engineers almost always have a toolchain already; a second copy of several hundred MB helps nobody.

| Order | Kind | Where |
|---|---|---|
| 1 | `find` | `PATH`; STM32CubeCLT and STM32CubeIDE plugin folders; PlatformIO `~/.platformio/packages/toolchain-gccarmnoneeabi*/bin` and `toolchain-riscv*/bin`; Arduino `~/.arduino15/packages/*/tools/*/*/bin`; Zephyr SDK `~/zephyr-sdk-*/arm-zephyr-eabi/bin`; xPack `~/.local/xPacks` and `%APPDATA%\xPacks` |
| 2 | `download` | the xPack GNU Arm Embedded GCC and xPack RISC-V Embedded GCC releases (GitHub `xpack-dev-tools`), pinned version and SHA-256 per platform (`win32-x64` zip, `linux-x64` and `linux-arm64` tar.gz) |

- Only programs that resolve appear in the prompt's `<programs>` block (architecture §3.4), so a
  user with only an ARM toolchain sees five lines, not ten.
- Version probe: `<prefix>size --version`, first line.

## 3. Manifest

```yaml
format: 1
id: binutils
version: 1.0.0
name: GNU binutils (ARM, RISC-V)
description: Inspect firmware ELF files - sizes, symbols, sections, targeted disassembly and crash addresses to source lines. Use for size growth, map and memory layout questions and HardFault decoding.
ecosystem: general
platforms: [windows-x64, linux-x64, linux-arm64]
programs:
  arm-none-eabi-size:
    install:
      find: { windows: ["%PATH%", "C:/ST/STM32CubeCLT*/GNU-tools-for-STM32/bin", "~/.platformio/packages/toolchain-gccarmnoneeabi*/bin"], linux: ["$PATH", "~/.platformio/packages/toolchain-gccarmnoneeabi*/bin", "~/zephyr-sdk-*/arm-zephyr-eabi/bin"] }
      hint: Install the xPack GNU Arm Embedded GCC from Plugins, or point VERA at an existing toolchain.
    version: { args: [--version], match: '(\d+\.\d+(?:\.\d+)?)' }
    timeout: 60
  # arm-none-eabi-nm, -readelf, -objdump, -addr2line and the riscv-none-elf- set follow the same shape
rules:
  - { match: "{arm-none-eabi-*,riscv-none-elf-*} *", risk: safe, note: Reads a local ELF file; no hardware. }
```

- Whole-image disassembly (`-d`, `-D`) exceeds the tool result cap; the full output still lands in
  the run log. The skills ask for `--disassemble=<symbol>` or an address range instead.

- `download` is chosen per program only when `find` fails, and installs one toolchain archive shared
  by the five programs of that prefix.
- Response files (`@file`) are refused before rules (architecture §2.2).

## 4. Skills

| Skill | Covers |
|---|---|
| `firmware-size` | `size -A`, `nm -S --size-sort -C` on two builds, a ranked diff of growing symbols; feeds `firmware-comparator` (CAP-03) |
| `crash-decode` | addresses from a fault log, a core dump or a `probe-rs read` of stacked PC/LR, through `addr2line -f -C -i`; cites the ELF and the build |
| `elf-inspect` | `readelf -h -S -l`: entry point, section placement against the linker script and the flash offsets used by the flasher |

## 5. Verification

- Fixture ELFs for ARM and RISC-V (small, built once and committed with their source) in
  `05_Software/tests/fixtures/elf/`; tests check `find` resolution order and the version probe with a
  fake toolchain folder.
- Smoke on Windows and Linux with a real toolchain: size diff, `addr2line` of a known address, and a
  `--disassemble=<symbol>` run within the result cap.

NOTES:
- Verify while implementing: current xPack release numbers, archive names and SHA-256 values; the
  STM32CubeCLT install path on Windows and Linux.
- Map files (`.map`) are read with `read`/`grep`; no program is needed.

# Official plugins: firmware analysis, Git and analysis skills

## Routing

Select for `binutils` (ARM/RISC-V size, nm, readelf, objdump and addr2line, with firmware-size, crash-decode and
elf-inspect); `git` (workbench version control, three skills and Git option-role classification); and
`analysis-skills`.

The analysis-skills procedures and their requirements are in [Skills](skills.md).

The conventions shared by all official plugins (package format, catalog source, packs, versions and evidence
levels) and the page of every other plugin are in [Official plugins](official-plugins.md). The platform that
installs, classifies, approves and runs these programs is [Plugins](plugins.md); plugin skill discovery is
[Skills](skills.md).

## Public interface

- `binutils` 0.3.0, general, windows-x64/linux-x64/linux-arm64: ten `arm-none-eabi-` and
  `riscv-none-elf-` programs (`size`, `nm`, `readelf`, `objdump`, `addr2line`), all safe. Per-program
  `--version` probes, timeout 60 s. Ordered PATH/ST/PlatformIO/Arduino/Zephyr/xPack discovery;
  only a user action installs a missing tool from SHA-256-pinned xPack ARM 15.2.1-1.1 or RISC-V
  15.2.0-1 archives, five entry points sharing each archive. Zephyr uses explicit alternate names;
  Espressif remains in esp32-idf. Three skills compare sections/symbol deltas, decode exact-build
  PC/LR with inline frames and inspect linker/flash mapping with bounded disassembly.
  Fixture source, linker script, DWARF4 ELFs and reproduction instructions are in tests/fixtures/elf.
  Windows/native Ubuntu x64 acceptance uses real local archives via VERA_BINUTILS_ARCHIVES;
  linux-arm64 archive hashes/members/AArch64 host headers are inspected, not executed.

- `git` 0.3.0 discovers user Git >=2.40 through PATH and standard Windows/Linux paths, without downloads. Fixed prefix/env plus the mandatory no-ext-diff execution guard neutralise fsmonitor, hooks, pager and external diff; an inert no-hooks/README.txt preserves the hooks directory in catalog zips. `optionSyntax: git` keeps option case/arity/boundaries for highest-risk rules, blocking executable aliases, configuration overrides and explicit helpers. Read inspections/listings are safe, mutations/remotes default to device-write, discard/force/delete paths irreversible. Skills git-inspect/git-commit/git-branches bound history, cite hashes, stage reviewed explicit paths, use messages and preserve conflicts. Git bypasses the write queue/Changes panel; run logs and the index watcher retain visibility. Local filters/textconv and other user Git configuration are not sandboxed. tests/plugins/git.test.ts exercises actual catalog installation, native Git markers, replay Ask and controlled credential failure; Windows/Linux environment receipts name the actual platform.

- `analysis-skills` 0.3.0, general, Windows x64/Linux x64, is a format1 skills-only package with no
  programs or rules. Its firmware-comparator procedure and seven-section comparison template load
  through source plugin. It compares explicit captured runs with parse_log, documented conditions,
  release notes and criterion evidence, saves a session artifact and never operates hardware/tests.
  Test-planner adds a six-section sourced manual plan with one to five targeted cases and a baseline
  control when available; missing target/setup/criteria blocks readiness. Plugin commands are
  optional future instructions with risk levels, and todo records preparation, not measurements.
  Folder and bundled-catalog zip installation are covered by analysis-skills.test.ts and
  prepare-plugins.test.ts.

## Key behaviors

- `REQ-FUNC-20b10003` / `REQ-SEC-20b10004` — official binutils package, pinned find-first sources and safe analysis.
- `REQ-UX-20b10005` / `REQ-UX-20b10006` / `REQ-UX-20b10007` — size, crash and ELF inspection skills.
- `REQ-TEST-20b10008` — reproducible genuine ARM/RISC-V ELF corpus.

## Files

- `05_Software/plugins/binutils/` — manifest, measured source pins README and three skills.
- `05_Software/tests/plugins/binutils.test.ts`, `tests/fixtures/elf/` — genuine cross-architecture corpus, fake-root discovery and real offline archive/replay acceptance.

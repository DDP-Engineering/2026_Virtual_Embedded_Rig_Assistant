# GNU binutils for ARM and RISC-V

Inspect local firmware with `size`, `nm`, `readelf`, `objdump` and `addr2line` from the
`arm-none-eabi-` and `riscv-none-elf-` toolchains. Every command is classified safe: these programs
analyze host files and never access hardware. Response files remain refused by VERA. Espressif
toolchains belong to esp32-idf.

Install this plugin from the bundled catalog or this folder, enable it for the workbench and use
firmware-size, crash-decode or elf-inspect. Only resolved programs appear in the agent prompt,
with their probed `--version`. Discovery never installs programs. Choose **Install programs** in
Plugins (or `vera plugin install --path <this-folder>`) for the managed fallback.

Search order is PATH, STM32CubeCLT/CubeIDE (ARM), PlatformIO, Arduino, Zephyr SDK, then xPack folders.
ST default roots include `C:/ST/STM32CubeCLT*/GNU-tools-for-STM32/bin` and
`/opt/st/stm32cubeclt*/GNU-tools-for-STM32/bin`; custom locations can be put on PATH. Arduino paths
fix the tool folder name so only package/version are wildcard segments. Zephyr's `arm-zephyr-eabi-*`
and `riscv64-zephyr-elf-*` binaries are searched by explicit file names. xpm's versioned
`@xpack-dev-tools/<toolchain>/*/.content/bin` roots and manually unpacked xPack folders are searched.
Existing binaries with an unreadable version remain unavailable instead of silently downloading another.

If discovery misses, a user-triggered install downloads the pinned xPack archive into
`<userData>/plugins/runtime/downloads/<sha256>/`. Five tools of one architecture share one verified
archive/extraction. No global install, personal toolchain modification, Python or board is required.
The provisioner's existing transfer deadline, 2 GiB transfer bound, hash checks, staging cleanup and
system-tar/streaming-zip extraction apply.

Pins verified from official release assets and their `.sha` files on 2026-11-03:

| Toolchain | Host archive suffix | SHA-256 |
|---|---|---|
| ARM 15.2.1-1.1 | win32-x64.zip | bae6a3d1667697ce750c3b13d6d26d80973ecedc2cc87bf04869e83447fd93ea |
| ARM 15.2.1-1.1 | linux-x64.tar.gz | da6a49ad4003944b823c6c93702a8787c922ab34bd7e918ec0eaf6933a9b1ff6 |
| ARM 15.2.1-1.1 | linux-arm64.tar.gz | 67980c7990eba7bb7ffdf39699102effd70889f5ac427be19a8c8a6c5fab2972 |
| RISC-V 15.2.0-1 | win32-x64.zip | 85ef714dacd273b1dadf4af4892774520ac01915bfa6da816a56e7e41591e09e |
| RISC-V 15.2.0-1 | linux-x64.tar.gz | aaaa8060c914851a3e5ee1ba82cc3d6f80972f90638a05c6e823a37557a33758 |
| RISC-V 15.2.0-1 | linux-arm64.tar.gz | 4e60e2a54c16385e4e2476d08240f857495d5a61609d97e1ee49f72875a6ec1e |

Each archive contains `xpack-<prefix>-gcc-<version>/bin/<prefix>-<program>[.exe]`; the manifest
names each exact URL/member. Sources: [ARM release](https://github.com/xpack-dev-tools/arm-none-eabi-gcc-xpack/releases/tag/v15.2.1-1.1),
[RISC-V release](https://github.com/xpack-dev-tools/riscv-none-elf-gcc-xpack/releases/tag/v15.2.0-1),
[ST installation guide](https://www.st.com/resource/en/user_manual/um3089-stm32cubeclt-installation-guide-stmicroelectronics.pdf),
[xPack installation](https://xpack-dev-tools.github.io/arm-none-eabi-gcc-xpack/docs/install/).

Tests use tiny genuine ELF fixtures in `tests/fixtures/elf/` with source/debug info and reproduction
instructions. Normal tests need no network. For real x64 acceptance, supply the official archives
locally using `VERA_BINUTILS_ARCHIVES=<folder>` and run `vitest run tests/integration/binutils.test.ts`.
The local transport still goes through VERA's SHA-256 verification/extraction, runner and replay agent.
Linux arm64 archives have verified hashes, members and AArch64 executable headers; execution needs
an arm64 host and is not established by x64 acceptance.

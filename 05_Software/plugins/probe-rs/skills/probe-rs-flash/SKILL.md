---
name: probe-rs-flash
description: Flash and verify the exact build ELF on an identified probe-rs target, preserving image hashes in approval and resetting only after verification succeeds.
---

Load probe-rs-connect first. Confirm the observed probe, exact chip, supply/wiring and intended build.
Use `run_program` program `probe-rs` with separate arguments; examples below use placeholders that must
come from observations. Read the build metadata and use the ELF from that build. Never guess a binary
base address or substitute an ELF from a later rebuild.

1. Run `probe-rs download --probe <selector> --chip <chip> --non-interactive --binary-format elf <build.elf>`.
   The workbench-relative ELF argument binds the file's SHA-256 to the approval. Before approving,
   report the image path and SHA-256 from the approval payload, target and consequences. Do not invent
   a hash if the permission mode runs unattended; use the actual recorded request/run evidence.
   Download is device-write. An ELF changed after preparation invalidates the grant: request a new
   approval for the rebuilt file. Do not bypass the conflict or quietly reuse the old hash.
2. Only after a successful download, run
   `probe-rs verify --probe <selector> --chip <chip> --non-interactive --binary-format elf <build.elf>`.
   Confirm success from the actual exit/output, not from an issued command. Verify is device-read.
3. Only after successful verification, run
   `probe-rs reset --probe <selector> --chip <chip> --non-interactive`. Reset is device-read and
   restarts the target; report its outcome. If verification fails, stop and preserve the logs.

For ESP-IDF builds, inspect the vendor build metadata first: an IDF bootloader-compatible ELF may
require `--binary-format idf` and exact `--idf-bootloader`/`--idf-partition-table` files. Keep all named
inputs workbench-relative so their hashes appear in approval; verify using the same format/inputs.
Do not assume a generic ELF supplies a bootloader or partition table. Use esp32-flash for the
build's established serial/flasher_args.json workflow when appropriate.

`run` combines flashing and RTT and is device-write; load probe-rs-rtt and start it in the background.
Do not add erase, mass-unlock, --allow-erase-all or security operations to resolve an ordinary error.
Arbitrary `write` is irreversible because addresses can target flash/option registers or GPIO pins;
it is not a substitute for download. Never exercise eFuses, option bytes or lock bits as a test.

---
name: esp32-efuse-review
description: Review ESP32 eFuse state and an explicitly requested irreversible change, explain its consequences and write a session artifact plan before asking for one burn. Use when the user asks to inspect eFuses, secure boot, flash encryption, key protection or a permanent chip configuration.
---

Only perform an irreversible operation when the user explicitly requests it. A question about
secure boot, an inspection, a build, or enabling this plugin never implicitly requests a burn.

1. Establish the exact target chip, connection and intended field from the user and board context.
   Read `espefuse --chip CHIP --port PORT summary` through `run_program` first. Read the command's
   chip-specific help and vendor documentation; fields and coding schemes vary between chips.
   Never infer a production command from the ESP32 virtual example below.
2. Explain each requested burn: the exact field/key/block, current and intended value, one-time
   0-to-1 bits, dependencies, read/write protection, effect on boot/debug/recovery and how a wrong
   value can brick this specific chip. Do not expose private key material in chat or artifacts.
   Stop when target identity, key custody, firmware compatibility or the intended value is unclear.
3. Refuse to batch burns: no chained irreversible subcommands, multiple field/value pairs, multiple
   keys or grouped protection operations in one call. If a coding scheme needs a combined burn,
   stop and explain the constraint; this workflow does not perform it. Review one requested
   irreversible operation at a time, then re-read state before considering another.
4. Write a plan in a **session artifact** with `artifact_save` before any irreversible call.
   Record target identity, current summary, exact argv for one operation, intended field/value,
   key/image paths and hashes (no secret bytes), consequences, prerequisites and read-back checks.
   Link the session artifact for the user's review. A chat-only plan is insufficient.
5. In Ask and Auto-edit, submit that one command through `run_program` and wait for VERA's typed
   confirmation, for example `burn-efuse` for a burn-efuse command. Do not substitute the vendor's
   `BURN` word. Bypass runs without a prompt and records `decided_by: mode`; it does not remove
   this skill's requirement for an explicit request, written plan and single-operation review.
6. Programs have closed stdin. For a deliberately submitted noninteractive burn, the explicit
   argv must contain global `--do-not-confirm` before the subcommand. This skips espefuse's own
   `BURN` prompt; it does not bypass VERA's approval gate. Never put it in a hidden prefix.
7. Parse the process result: require exit code 0, inspect its output and re-read `summary` to verify
   the intended field. A successful tool call alone does not mean the process succeeded. Stop on
   errors or unexpected state; never automatically retry a burn or use `--force` to work around it.

Virtual demonstration only (no hardware connection), use an owned workbench scratch file:

```text
espefuse --chip esp32 --virt --path-efuse-file efuses.bin summary JTAG_DISABLE
espefuse --chip esp32 --virt --path-efuse-file efuses.bin --do-not-confirm burn-efuse JTAG_DISABLE 1
espefuse --chip esp32 --virt --path-efuse-file efuses.bin summary JTAG_DISABLE
```

Even virtual burns retain the irreversible classification. Without `--path-efuse-file`, virtual
state does not persist across calls. Never drop `--virt` from a demonstration or test.

`espsecure` handles local key/image generation, digests, signing, verification and encryption.
Select paths deliberately: outputs can overwrite files; `sign-data` can modify its input when
no output is supplied. `safe` is a hardware-risk label, not a sandbox or a secret-management
guarantee. HSM operations are blocked. Do not print private keys or upload them.

---
name: probe-rs-flash
description: How to flash, verify and restart a target with probe-rs in one run, back up the firmware that is on the board first, and erase a chip. Use when firmware must be written to a board through a debug probe or compared with what is on it.
---
# probe-rs-flash

Load `probe-rs-connect` first: every command below also takes `--probe S --chip C --non-interactive`.

| Command | Risk | Use |
|---|---|---|
| `probe-rs download --verify --reset <image>` | device-write | write the image, read it back, restart the target |
| `probe-rs download --preverify --verify --reset <image>` | device-write | the same, and skip the writing when the board already holds this image |
| `probe-rs verify <image>` | device-read | compare the image with the flash, nothing is written |
| `probe-rs reset` | device-read | restart the target |
| `probe-rs read b8 <start> <bytes> --format binary --output <file>` | device-read | copy flash to a file (backup) |
| `probe-rs erase` | device-write | erase all non-volatile memory |

## Procedure

1. The image is the file of the build the user means: take the ELF path from the build output, never
   from a guess or an older build. Name it workbench-relative, so the approval shows its SHA-256. An
   image rebuilt after the approval is refused: ask again with the new file.
2. Flash in one run, which is one approval:
   `probe-rs download --probe S --chip C --non-interactive --verify --reset build/app.elf`.
   The format follows the file; force it with `--binary-format elf|hex|bin|uf2|idf`. A `bin` has no
   addresses, so it needs `--base-address <address>` from the build, never a guessed one. Without
   `--reset` the new firmware is not started.
3. It worked when the exit code is 0 and the output ends with `Finished in <seconds>s`. A failed
   read-back ends the run with an error; report it and keep the log.
4. `probe-rs verify` alone always exits 0. Its last line decides: `Verification successful` or
   `Verification failed: contents do not match`. Never report a match from the exit code.
5. To keep the firmware that is on the board, back it up before flashing: `probe-rs chip info C` shows the
   NVM range; then `probe-rs read b8 <start> <size in bytes, decimal> --format binary --output
   backup/<name>.bin ...`. Restore it with `download --binary-format bin --base-address <start> --verify
   backup/<name>.bin`. A read-protected chip refuses the read: say so, do not unlock it.
6. Download, verify, erase and read may run for up to 30 minutes, enough for a large image on a slow
   probe; they end by themselves, so they need no `timeout`.

## Other cases

- ESP-IDF builds: the application ELF alone is not a bootable image. Use `--binary-format idf` with the
  build's own `--idf-bootloader <file>` and `--idf-partition-table <file>`, or the esp32-esptool plugin's
  `esp32-flash` skill, which follows the build's `flasher_args.json`.
- `--chip-erase` (erase everything before writing), `probe-rs erase` and `--allow-erase-all` (unlock a
  protected chip by wiping it) also destroy settings, calibration and keys stored in flash. Use them
  only when the user asks for exactly that, never to get past an ordinary error.
- `probe-rs run <elf>` flashes, starts and then follows the log: see `probe-rs-rtt`, or `probe-rs-test`
  for firmware that ends by itself.
- `probe-rs write` writes single memory words; it does not flash.

---
name: stm32-flash
description: Find an ST-LINK probe, connect to an STM32 part, flash and verify an image, read memory back and reset with STM32_Programmer_CLI.
---

Use `run_program` with program `stm32_programmer_cli` and separate arguments.
One call may hold several commands; they run in order, so put `-c` first.
Find the probe without touching any target:

```text
-l st-link-only
```

Agree the probe (its serial number when several are attached) and the
interface with the user. Then connect and read the part's identity; the
connection output names the device ID, flash size and revision:

```text
-c port=SWD
-c port=SWD sn=0670FF000000000000000000 mode=UR
```

Use `mode=UR` (connect under reset) only when a running program blocks the
connection, and say that it resets the board.

Flash the build's image, verify it and reset in one call (ELF and hex carry
their addresses; a `.bin` needs the start address, usually `0x08000000`). A hex,
srec or ELF image can also carry option-byte or OTP segments, which `-w` writes
as well: flash only images built for this board, and check an unfamiliar file's
address ranges first (`-fchecksum` lists its segments):

```text
-c port=SWD -w build/app.elf -v -rst
-c port=SWD -w build/app.bin 0x08000000 -v -rst
```

Read memory back to compare or archive it:

```text
-c port=SWD -r32 0x08000000 0x40
-c port=SWD -r 0x08000000 0x1000 captures/flash.bin
```

`-c port=SWD -e all` is a mass erase; erase only the sectors you will rewrite
when the user wants other data kept (`-e 0 1 2`). Report the probe, device ID,
image and the "File download complete" and verification lines. "No debug probe
detected" or "Unable to get core ID" calls for checking the USB cable, the
target power and the SWD wiring before anything else.

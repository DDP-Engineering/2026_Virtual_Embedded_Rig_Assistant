---
name: stm32-option-bytes
description: Read and explain STM32 option bytes and change one option byte at a time only on the user's explicit request.
---

Read before you change anything, and keep the output as a record:

```text
-c port=SWD -ob displ
```

Explain each field from the device's reference manual (FLASH option bytes
section) and cite it: RDP, BOR level, nBOOT/BOOT0 selection, watchdog and
standby settings, write protection (WRP) and PCROP ranges.

Change one option byte per call, only the one the user asked for, with the
value you computed and showed first:

```text
-c port=SWD -ob nBOOT_SEL=1
```

Every option-byte write is irreversible in VERA: in ask mode it waits for the
typed word `-ob`. State the old value, the new value and the consequence before
the call. Read protection needs particular care:

- `RDP=0xBB` (level 1) blocks debug reads of flash. Going back to `RDP=0xAA`
  triggers a mass erase, so the firmware and data are lost.
- `RDP=0xCC` (level 2) is permanent. Debug access and option-byte changes are
  disabled forever and the part cannot be reprogrammed through SWD again.
  Never write it unless the user asks for exactly that, for a production part,
  and confirms they understand it cannot be undone.

Wrong BOOT or watchdog settings can also stop the part from starting the
application. `-rdu`, `-tzenreg`, OTP, key and secure-firmware commands are
irreversible too and belong only to an explicit, reviewed production step.

Read the option bytes again afterwards (`-ob displ`) and compare them with the
record; report any difference and stop if the connection fails after a write.

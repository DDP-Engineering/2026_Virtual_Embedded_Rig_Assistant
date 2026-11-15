# GDB debugging

GDB debugging lets the agent debug Cortex-M firmware with symbols, without a debugger console. Offline, it inspects a firmware ELF. Through a declared probe, it runs one finite, supervised session per call: a snapshot of registers, backtrace, locals, RAM variables and the decoded fault state, one hardware breakpoint with a timeout, or bounded stepping. Symbols are shown only when the ELF matches the target's flash. Results go to `embedded-lab-results/<run-id>/` in the workbench.

## What it needs

- **arm-none-eabi-gdb** 12 or newer and **OpenOCD** 0.12.0 or newer, which you install yourself (for example the xPack builds, or `gdb-multiarch` and `openocd` on Ubuntu); then use **Check dependencies** on the plugin page. Probe drivers and USB permissions are yours to set up.
- **gdb-elf** and **gdb-debug**: scripts installed automatically.
- For live sessions, a debug probe declared in `lab/resources.json` (parameter `lab-resources`, optional) by USB VID, PID and serial, with a profile: `stm32f4-stlink` (Cortex-M4F) or `stm32g0-stlink` (Cortex-M0+). The plugin page's **Configuration** section shows its state.
- The ELF of exactly the image on the board.

## How to use it

- "Inspect build/app.elf: architecture, symbols and debug info." (skill `debug-sessions`)
- "The board on stlink1 hangs. Take a snapshot with build/app.elf, keep the core halted and decode the fault."
- "Read the variables counter and state.mode in the same snapshot."
- "Run until the function sample is reached, with a 30-second timeout."
- "Step three source lines from here."

The agent asks what the firmware drives (relays, motors, heaters) before a live session and lets the core run again on exit only with your agreement for actuating firmware. When the ELF does not match the flash, it reports the symbols as unknown instead of guessing.

## Risk and approvals

- Safe, runs without asking: ELF inspection and diagnosis, tool versions, and the cleanup `release`.
- Device-write: `snapshot`, `break` and `step`. Each halts the core through the probe, and `break` and `step` run firmware; the chosen exit policy (halted or resume) applies at the end. Nothing is written to memory or flash. Ask and Auto-edit modes ask before each one.
- Irreversible: any session with `--firmware-effect actuates`, for firmware that drives actuators: halting it can leave an output in its last state, and running it lets it act on the hardware. VERA asks you to type the confirmation word, except in Bypass.
- Blocked: calling GDB or OpenOCD directly.

## Limits

- Windows x64 and Linux x64. Not yet run against a real probe and board; both profiles are unverified.
- No RTOS awareness, peripheral registers, memory writes, semihosting, SWO/ITM or standalone continue. Memory is read only as named variables, the stacked frame and fault registers.
- References: https://sourceware.org/gdb/current/onlinedocs/gdb.html/GDB_002fMI.html and https://openocd.org/doc/html/GDB-and-OpenOCD.html

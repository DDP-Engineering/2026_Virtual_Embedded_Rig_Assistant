# Renode virtual boards

This plugin lets the agent run a firmware ELF on a supported virtual board with the pinned Renode 1.17.0, before or without hardware. The agent lists the supported board profiles, checks a firmware against a profile's architecture, memory map and boot address before anything runs, boots it headless, captures its UART and runs approved test sets (UART lines, timer ticks, button and UART stimuli, the modeled LED) with separate virtual and real time budgets. Results go to `embedded-lab-results/` and always count as virtual evidence, not a hardware test.

## What it needs

- **Renode 1.17.0.** **Install dependencies** downloads the pinned portable package into VERA's program folder and checks its SHA-256; a Renode 1.17.0 on PATH works too. Another engine version blocks a run.
- **renode-sim**, a Python script in the plugin, which VERA installs itself. The agent always works through it.
- A firmware ELF built for a supported board. The first profile is `stm32f4-discovery` (STM32F407, Cortex-M4F) with the approved test set `board-basics`.
- No hardware, no other plugins and no configuration. You can add your own profiles in `renode/profiles/<id>/` and test sets in `renode/tests/<id>/` of the workbench; they are checked like the plugin's own.

## How to use it

The agent uses the `virtual-boards` skill. It states the architecture and boot address explicitly and never switches to another profile just to make a check pass.

- "Which virtual boards are supported?"
- "Check build/app.elf against stm32f4-discovery as cortex-m4 with boot address 0x08000000."
- "Boot the firmware on the virtual board for 2 virtual seconds and show the UART output."
- "Run the board-basics test set with version 1.2.3."
- "Write a report of the virtual run next to the HIL run."

## Risk and approvals

All renode-sim operations (tools, profiles, validate, run, capture-uart, test, report) are rated **Safe**: they run on your computer only, use no device, network listener or host file outside the new run folder, and run without asking. Running Renode directly is **Blocked**, because its monitor can run Python, include scripts, download files and open sockets or host devices.

## Limits

- Windows x64 and Linux x64; native Ubuntu has not been checked yet.
- Only approved profiles run; there is no Renode console, monitor command, `.resc` script or Robot Framework access.
- If the firmware touches a peripheral the model does not implement, the result is incomplete. The STM32F4 model does not simulate the clock tree, cycle timing, DAC, ADC, USB, SDIO, DCMI or the board's external parts.
- Virtual time is simulated time. A simulation says nothing about electrical timing, power consumption, EMI or the analog circuit.
- A workbench `.repl` file should be reviewed like code.

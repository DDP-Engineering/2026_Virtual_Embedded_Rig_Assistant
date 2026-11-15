# Power profiling

This plugin lets the agent measure a board's current, voltage, power, energy and charge with a Joulescope JS220 and analyse the captures offline. A capture ties the data to the firmware build and records GPI markers for events; gaps and overflow never become zero. The analysis gives mean, minimum and maximum current, energy and charge, time in sleep and active states, energy per event, an A/B firmware comparison and a battery-life interval with its assumptions. Results go to `embedded-lab-results/`.

## What it needs

- **power-profile** (with pyjoulescope_driver 2.5.5) and **power-analyze**, Python scripts that VERA installs itself with **Install dependencies**.
- **A Joulescope JS220** with the board supplied through it. USB access needs WinUSB on Windows or the vendor's udev rule on Linux, which you set up yourself.
- **The bench registry** `lab/resources.json` in the workbench (required), which declares the meter as a power monitor, for example alias `js1`. The plugin page's **Configuration** section shows whether the file is present and valid.
- No other plugins. A firmware A/B verdict uses lab-validate from the lab-validation plugin.

## How to use it

The agent uses the `power-measurement` and `energy-analysis` skills. It asks how the board is wired, which GPIOs reach the meter's GPI inputs and the supply voltage.

- "Identify the meter js1 and check the driver and USB access."
- "Capture 20 seconds at 100 kHz with marker 0, firmware build/app.elf, board sensor-node rev B at 3.3 V."
- "Measure the energy and charge of that capture from 2 s to 12 s."
- "Split the capture into wake-ups by marker 0 and give the energy per wake-up and the sleep current."
- "Compare firmware A and B and estimate the battery life with battery.json."

## Risk and approvals

- **Safe** (runs without asking): checking the driver prerequisites and every offline analysis step.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): listing the connected meters and identifying the meter; nothing is changed.
- **Device write** (asks in **Ask** and **Auto-edit**): a capture, because it sets the meter's sample rate and range, which changes the burden in series with your board (the previous settings are restored afterwards); and VERA's cleanup after an interrupted capture.

The plugin never switches the board's current path, drives the meter's outputs or updates its firmware.

## Limits

- Windows x64 and Linux x64.
- The JS220 profile is not yet checked against a real meter.
- One capture holds at most 1 000 000 samples.
- If the meter's current path is off, captures are refused.
- Not provided: a meter console, power-path control, JLS files and other meters such as PPK2 or Otii.

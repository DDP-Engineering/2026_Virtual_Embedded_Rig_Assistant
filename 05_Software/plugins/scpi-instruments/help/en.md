# SCPI bench instruments

This plugin lets the agent work with the bench instruments your workbench declares: a multimeter, an oscilloscope or a power supply, through PyVISA. It identifies an instrument, reads values with units, captures waveforms, changes settings and powers a board from a supply output for a bounded hold. Every command comes from a validated profile; there is no raw SCPI and no network search. Each instrument is reserved for the run, and its outputs are switched off after Stop, a timeout or a crash, or the state is reported as unknown. Results go to `embedded-lab-results/`.

## What it needs

- **scpi**, a Python script with pinned PyVISA 1.16.2 and pyvisa-py 0.8.1, which VERA installs itself with **Install dependencies**.
- **The bench registry** `lab/resources.json` in the workbench (required). Each entry has an alias, the VISA resource, the serial number, the profile and bench limits. The plugin page's **Configuration** section shows whether the file is present and valid.
- **Supported instruments**: Keysight 34460A/34461A, Rigol DS1054Z/DS1074Z/DS1104Z (and Plus), Rigol DP832/DP832A, over TCPIP, USBTMC or (DP800) serial.
- For USBTMC: libusb 1.0 and device access, which you set up yourself (on Ubuntu `libusb-1.0-0` and a udev rule; on Windows a WinUSB driver, for example with Zadig). Optionally a vendor VISA library (NI-VISA, Keysight IO Libraries).

## How to use it

The agent uses the `bench-instruments` and `instrument-profiles` skills.

- "Identify the power supply psu and show its limits."
- "Read the DC voltage on the multimeter dmm, range 10 V."
- "Capture CHAN1 of the scope with 1 ms/div and 0.5 V/div."
- "Power the board from psu CH1 at 3.3 V, 0.2 A for 10 minutes while you flash it."

## Risk and approvals

- **Safe** (runs without asking): profile and registry information and recomputing a capture; no instrument is opened.
- **Device read** (asks in **Ask** mode, runs on its own in **Auto-edit**): listing local serial ports and USB devices, identify, read, status and capture (which sets only the waveform transfer, not the acquisition).
- **Device write** (asks in **Ask** and **Auto-edit**): changing settings, and switching every output off (also VERA's cleanup).
- **Irreversible** (asks, and you type the confirmation word `output`): energizing a supply output for the hold time; it is switched off afterwards and read back. In **Bypass — full access** this runs without asking.

## Limits

- Windows x64 and Linux x64. No profile has been verified on a real instrument yet; native Ubuntu and vendor VISA have not been run.
- An instrument whose identity matches no profile gets identify only.
- VERA cannot lock out other programs, and nothing can switch an output off if the whole computer or VERA is lost.

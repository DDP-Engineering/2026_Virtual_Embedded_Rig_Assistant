---
name: instrument-profiles
description: Explain which bench instruments scpi-instruments supports, what a profile verifies and how far its verification goes. Use when the user asks whether an instrument model is supported, why an instrument was refused, or how to add a model.
---

A profile (`profiles/<id>.json` in the package) is validated data: manufacturer, models and firmware pattern that
`*IDN?` must match, terminators and timeout, channels with limits, and the SCPI strings of fixed command slots. The
helper's code decides which slots each operation uses, so a profile cannot turn a query into an output command.

| Profile | Class | Models | Verification |
|---|---|---|---|
| `keysight-34461a` | multimeter | 34460A, 34461A | unverified |
| `rigol-ds1000z` | oscilloscope | DS1054Z, DS1074Z, DS1104Z (and Plus) | unverified |
| `rigol-dp800` | power supply | DP832, DP832A | unverified |

`unverified` means the commands come from the vendor's programming guide and have not been run by VERA against that
instrument; say so whenever you report a result. `scpi capabilities --profile <id>` prints a profile with its
verification record.

- An instrument whose identity matches no profile gets `identify` only. Never suggest pointing an entry at another
  model's profile.
- A new model is added by the plugin's maintainers as a new profile from its programming guide, checked against a real
  instrument (model, firmware, transport and OS recorded in `verification.instruments`). There is no raw SCPI command
  to fall back on.
- Transports: pyvisa-py covers TCPIP (VXI-11, HiSLIP, SOCKET), USBTMC (needs libusb and, on Windows, a WinUSB/libusb
  driver the user installs) and serial; `backend: "ivi"` in the registry uses a VISA library the user installed (NI-VISA,
  Keysight IO Libraries). Which transport has run against a real instrument is listed in the README's matrix.

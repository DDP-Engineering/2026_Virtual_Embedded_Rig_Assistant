# LTspice circuit simulation

Batch simulation with **your own LTspice on Windows x64** (LTspice 26 or newer). The plugin finds LTspice where its
installer puts it - `%LOCALAPPDATA%\Programs\ADI\LTspice\LTspice.exe` (installed for you) or
`%ProgramFiles%\ADI\LTspice\LTspice.exe` (installed for all users) - and never downloads, installs or bundles it. It
is not offered on Linux or macOS and installs no Wine.

## Install LTspice

1. Download LTspice from https://www.analog.com/ltspice ("Download for Windows 10 64-bit and forward", LTspice64.msi).
2. Run the installer. If the per-user installation fails with Windows Installer error 2503 or 2502 (seen on managed
   computers), install it for all users from an administrator command prompt:
   `msiexec /i LTspice64.msi ALLUSERS=1`.
3. In VERA, enable the plugin; Install programs then finds LTspice and checks its version (`LTspice.exe -version`).

## What ltspice-tool does

`ltspice-tool` (standard-library Python) takes the same requests as `ngspice-tool`, so one request runs on both
engines and the results compare directly:

- `validate --netlist FILE` - checks a netlist and its includes without running LTspice.
- `convert --schematic FILE.asc` - converts a schematic on a copy with `LTspice -netlist` and checks the netlist.
- `run`, `sweep` - op, DC, AC, transient and noise analyses of a netlist or schematic; parameter and temperature
  steps and seeded Monte Carlo run as one LTspice `.step` run.
- `measure`, `compare`, `report` - measurements, criteria, comparisons and reports on run folders.

Every run writes a new folder under `electronics-results/` with the copied inputs, `effective.net`, LTspice's
`effective.log` and `effective.raw` (it opens in LTspice's waveform viewer), `series.csv`, `plot.svg`, `result.json`
and `report.md`. Exit codes: 0 completed, 2 refused (nothing was simulated), 3 failed.

## What is refused before LTspice runs

LTspice reads and writes files from netlist directives, so ltspice-tool refuses: `.wave`, `.savebias`, `.loadbias`,
`.savestate`, `.loadstate`; outside include cards, any text containing `file`, `scopedata`, `tbl`, `.inc`, `include`,
`.lib`, `loadbias`, `savebias`, `loadstate`, `savestate` or `fastaccess` (LTspice matches these by prefix, so a node
named `profile` is refused too); quoted strings outside include, library and model cards; frequency-response elements
(`@`, `&`); state machines and unknown cards; encrypted or non-UTF-8 workbench files, and files holding
U+0085/U+2028/U+2029 (LTspice line breaks) or invisible formatting characters such as a soft hyphen (LTspice drops
them); include names with `%` (LTspice crashes on them) or not in Unicode NFC, and netlists, includes and schematics
whose path inside the working directory is not in NFC (a folder copied from a Mac may not be). Includes must lie in
the working directory or in LTspice's own library (`%LOCALAPPDATA%\LTspice\lib\cmp` and `\sub`), which is read in
place and never copied. A library section needs a quoted file name: `.lib "models/corners.lib" TT`.

## Licence

LTspice is freeware of Analog Devices under its own licence (`License.txt` in the LTspice installation folder). VERA
never downloads, bundles or redistributes LTspice or its component libraries; run folders never copy library files.

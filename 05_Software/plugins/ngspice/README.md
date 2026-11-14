# ngspice

Reproducible local circuit simulation for VERA.

- **`ngspice`** - the engine. VERA uses your ngspice when it finds one (`C:/Spice64/bin/ngspice_con.exe`,
  `%ProgramFiles%/Spice64`, `%LOCALAPPDATA%/Programs/Spice64` on Windows; `$PATH`, `/usr/bin/ngspice`, `/usr/local/bin/ngspice` on Linux), version
  42 or newer. On Windows, Install programs downloads the pinned official build:
  - ngspice-47 (released 2026-08-11), `https://downloads.sourceforge.net/project/ngspice/ng-spice-rework/47/ngspice-47_64.7z`
  - SHA-256 `59225971bd68cdd1199443649aa4615a9e6d684933f205ab49006a3942518f5a`, 13 814 879 bytes
  - executable `Spice64/bin/ngspice_con.exe` (the console build). The archive's example files with non-ASCII names
    are not extracted.
  - On Ubuntu there is no official binary: `sudo apt install ngspice`.
  - Every direct engine command is blocked (a netlist's control block can run shell commands); ngspice-tool reports
    the engine version.
- **`ngspice-tool`** (`scripts/ngspice_tool.py`, standard library) - `validate`, `run`, `sweep`, `measure`, `compare`,
  `report`. It checks the netlist and its includes before the engine runs, runs `ngspice -b -n` on a copy with its own
  control block and writes a new run folder (`electronics-results/<run-id>/`) with the log, the effective netlist,
  input hashes, `series.csv`, `plot.svg`, `result.json` and `report.md`. It sets no solver option. It refuses lines such
  as `*#` or `;#` (ngspice runs them as commands), XSPICE `A` instances (code models can start programs or read files) and
  replaces the title line, on which ngspice acts too. Exact contract:
  spec REQ-DATA-29b9a988 in VERA's `.agentic/specs/`, and `ngspice-tool run --help`.
- **Skill** `circuit-simulation`.

## Licence

ngspice is licensed under the Modified BSD licence, with parts under other licences (from `Spice64/docs/COPYING`):
LGPLv2 (KLU, numparam, tclspice), MPLv2.0 (OSDI), GPLv2 or newer (the XSPICE table code model), public domain
(XSPICE, ndev), and the manual under CC-BY-SA 4.0. VERA downloads the official archive from SourceForge at the
user's action; it does not redistribute ngspice or any device model.

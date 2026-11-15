# KiCad schematic and PCB analysis

KiCad schematic and PCB analysis lets the agent analyse KiCad 10 projects without changing them. It reads the sheet hierarchy, symbol instances, nets, board layers, stackup, tracks and net classes; runs KiCad's ERC and DRC and reports each violation with its objects and positions; and produces a BOM, KiCad's netlist and inspection or fabrication exports (schematic and board PDF or SVG, Gerber, drill and position files), each checked. KiCad runs only on a copy of the project. Each run creates a folder under `electronics-results/` in the workbench with `result.json`, `report.md` and KiCad's own files.

## What it needs

- **KiCad 10**, which you install yourself from https://www.kicad.org/download/ (on Ubuntu from the KiCad 10 PPA). Then use **Check dependencies** on the plugin page.
- **kicad-tool**: a script in the plugin, installed automatically by **Install dependencies**.
- A KiCad project (`.kicad_pro`, `.kicad_sch` or `.kicad_pcb`) inside the workbench. Files from KiCad 8 or 9 run with a warning; older or newer files are refused and must be saved in KiCad 10 first.
- No required plugins and no configuration parameters.

## How to use it

- "Review the schematic of hardware/sensor.kicad_pro." (skill `schematic-review`)
- "Run ERC and list the violations with their sheets and positions."
- "Run DRC on the board with the zones refilled, and check parity with the schematic." (skill `pcb-review`)
- "Export the BOM and the netlist."
- "Create the Gerber, drill and position files for a two-layer board."

In a review the agent keeps KiCad's findings apart from its own observations and marks each observation as a fact or a hypothesis. It does not call a net or a part adequately sized without the electrical requirements behind it. Zero DRC violations does not validate function, current capacity, impedance or return paths.

## Risk and approvals

- Safe, runs without asking in every permission mode: all `kicad-tool` operations. They work on a temporary copy and only create new run folders; the project is never changed, and a run whose sources changed meanwhile is discarded.
- Blocked: running `kicad-cli` directly, other than version or help, because it rewrites files in the project folder it reads and can save or upgrade a project.

There are no device-read, device-write or irreversible commands.

## Limits

- Windows x64 and Linux x64. Verified with KiCad 10.0.8 on Windows 11; native Ubuntu x64 is pending.
- ERC and the review report refuse a project with ERC's simulation model check turned on; set that check to ignore.
- No schematic or board changes (see the kicad-layout plugin), no 3D model export, no jobsets or upgrades.
- Reference: https://docs.kicad.org/10.0/en/cli/cli.html

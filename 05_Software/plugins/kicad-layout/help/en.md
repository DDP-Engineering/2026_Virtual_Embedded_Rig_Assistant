# KiCad PCB placement and local routing

KiCad PCB placement and local routing lets the agent make controlled edits to a KiCad 10 board on a candidate copy, through KiCad's official IPC API. It moves, rotates and aligns footprints and adds keepouts and local tracks and vias. Every request is checked first (locked items, nets, layers, the outline), then the candidate is verified with DRC and unconnected items and reported with before and after previews. Your board changes only when you ask to apply a passing candidate. Run folders go to `electronics-results/<run-id>/` in the workbench.

## What it needs

- **KiCad 10**, which you install yourself from https://www.kicad.org/download/ (on Ubuntu from the KiCad 10 PPA). Then use **Check dependencies** on the plugin page.
- KiCad's API enabled: in KiCad, **Preferences > Plugins**, enable the API server.
- **kicad-layout-tool**: a script in the plugin with its API client, installed automatically by **Install dependencies**.
- Only one KiCad window holding the API: close other KiCad windows before opening a candidate. The candidate opens in its own PCB editor window; leave that window alone while the agent works.
- No required plugins and no configuration parameters.

## How to use it

- "Open a candidate of boards/sensor.kicad_pcb." (skill `kicad-layout`)
- "Move C3 next to U1's VCC pin and rotate it by 90 degrees."
- "Add a 0.25 mm VCC track from C3 to U1 and a GND via next to it."
- "Keep the area under the antenna free of tracks and vias."
- "Show me the report and previews, then apply the candidate to the board."

A refused request changes nothing. The agent never unlocks parts by itself; it asks you.

## Risk and approvals

- Safe, runs without asking: opening, editing and closing a candidate. These work only on the copy in the run folder and never write your board.
- Blocked: other `kicad-cli` commands, because `kicad-cli` rewrites files in the project folder it reads.
- Applying a candidate: VERA's `apply_candidate` writes a candidate whose objectives passed over the source board, with the same approval as any file write: refused in Read-only, asked for in Ask mode. It is refused when the source or the candidate changed, or while the board is open in KiCad; save or discard your changes there and close it first.

## Limits

- Windows x64 and Linux x64. Native Ubuntu is not yet verified for this version.
- KiCad 10's API needs a PCB editor window; there is no headless mode.
- KiCad's DRC does not prove signal integrity, RF behaviour or thermal fitness.
- No global placement, autorouting, schematic editing or footprint replacement. For autorouting, use the freerouting plugin.
- Reference: https://dev-docs.kicad.org/en/apis-and-binding/ipc-api/

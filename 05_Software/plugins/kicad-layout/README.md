# KiCad PCB placement and local routing

Controlled edits of KiCad 10 boards on a **candidate copy**, through KiCad's official IPC API: move and rotate
footprints, align them, add keepouts and explicit local tracks and vias, verify the result with KiCad's DRC and
unconnected items, and apply it to your board only when you ask, through VERA's approval.

## Requirements

- KiCad 10 installed by you (VERA never installs KiCad): https://www.kicad.org/download/ (Ubuntu: the KiCad 10 PPA).
- KiCad's API enabled: in KiCad, **Preferences > Plugins**, enable the API server. VERA does not change KiCad's
  settings.
- Only one KiCad window holding the API: KiCad 10 serves its API from the first KiCad process only (Windows,
  observed with 10.0.8). Close other KiCad windows before opening a candidate; the candidate opens in its own PCB
  editor window. KiCad 10's API needs that window: it has no headless mode.
- The helper's API client, kicad-python 0.8.0 (with protobuf 5.29.6 and pynng 0.9.0), is installed by VERA with the
  plugin's programs.

## What kicad-layout-tool does

- `open --board FILE.kicad_pcb` copies the board, its project file, design rules, footprint library table and the
  schematics of its folder into `electronics-results/<run-id>/candidate/`, opens the copy in KiCad's PCB editor,
  saves it through KiCad and writes `state.json`, `board.json`, `drc-before.json` and layer previews.
- `edit --run DIR --json TEXT` (or `--request FILE` for a request beyond the 4096-character argument limit) checks a request (place, align, keepout, track, via; units mm) against the board the
  API has open: it must be this run's candidate, unchanged since the tool last saved it; footprints must exist and
  not be locked, nets and copper layers must exist, nothing may leave the outline. It runs the request in one KiCad
  commit, checks that no other item changed, saves, runs DRC (zones refilled, schematic parity when the schematic is
  present) and writes the objectives, `result.json`, `report.md` and previews.
- `close --run DIR` stops the candidate's PCB editor when it has no unsaved edits.

Exit codes: 0 completed, 2 refused (nothing changed), 3 failed. A failure before KiCad saved the candidate leaves it
as it was. Any failure after the save says that the edit was saved, and result.json and report.md describe it: when
only the checks did not finish (kicad-cli DRC, previews, their files), state.json records the edit with objectives
`none` until a later edit checks it again; when the run folder could not record the edit, or KiCad's new state could
not be read back, close the PCB editor and open a new candidate.

Refusals: `usage` (the command line), `path` (`--board`, `--results-dir`, `--run-id`), `run` (`--run` is not a
kicad-layout run folder), `request` (a malformed request, or a footprint moved by two operations), `changed` (the
candidate or its window changed), `binding` (the API's open board is not the candidate, or another KiCad window holds
the API), `footprint`, `net` (also when KiCad would connect a new track or via to another net's copper: a short),
`layer`, `locked`, `outline`. Failures: `connection`, `kicad`, `output`.

## Applying a candidate

The plugin never writes your board. VERA's `apply_candidate` tool (offered in the desktop app while this official
plugin is enabled in the workbench; the command-line app does not offer it)
writes a candidate whose objectives passed over the source board, through the same approval and conflict checks as
any file write: refused in read-only mode, asked for in ask mode. It is refused when the source changed since the
candidate was opened, when the candidate changed since its check, or while the board is open in KiCad (its lock file
`~<name>.kicad_pcb.lck` exists): save or discard your changes there and close it first.

## Limits

- KiCad's DRC does not prove signal integrity, RF behaviour or thermal fitness.
- No global placement, autorouting, schematic editing or footprint replacement.
- Native Ubuntu has not been verified for this version.

---
name: kicad-layout
description: Place footprints and add local tracks, vias and keepouts on a KiCad 10 board through a checked candidate copy, verify it with DRC and unconnected items, show the changes, and apply it only when the user asks. Use when asked to move or rotate a part (a decoupling capacitor next to its IC, say), align parts, route a short connection or keep an area free.
---

Use `run_program` with program `kicad-layout-tool`. It works on a candidate copy in a run folder and never writes
the user's board; `kicad-cli` is blocked. KiCad's API must be enabled (KiCad: Preferences > Plugins, enable the
API server), and only one KiCad window may hold the API: the candidate opens in its own PCB editor window.

## 1. Open a candidate

```text
kicad-layout-tool open --board <folder>/<name>.kicad_pcb
```

It copies the board and its project files into `electronics-results/<run-id>/candidate/`, opens the copy in KiCad's
PCB editor (no clicks are needed; leave that window alone), saves it through KiCad and writes `state.json`,
`board.json` (footprints with reference, uuid, position, orientation, side, locked and pads; nets; copper layers;
outline; routing per net), `drc-before.json` and layer previews. A refusal `binding` means another KiCad window
holds the API: ask the user to close it. `connection` means the API is off or KiCad did not answer.

## 2. Compose and run an edit

Read `board.json` and `state.json`. A request is JSON, units mm and degrees, `candidate` = `candidate.sha256` from
state.json:

```text
kicad-layout-tool edit --run electronics-results/<run-id> --json '{"format":1,"candidate":"<sha256>","units":"mm","operations":[
  {"op":"place","footprint":"C3","at":[112.5,80.0],"orientation":90},
  {"op":"track","net":"VCC","layer":"F.Cu","width":0.25,"points":[[112.5,80.0],[118.0,80.0]]},
  {"op":"via","net":"GND","at":[118.0,82.0],"diameter":0.6,"drill":0.3}]}'
```

A request longer than 4096 characters goes in a workbench file: `--request <file>` instead of `--json`.

Operations: `place` (a footprint by reference, optional `uuid`, `at` and/or `orientation`), `align` (references and
one of `x`/`y`, optional `pitch`), `keepout` (copper layers, a polygon, `forbid` some of tracks, vias, pads,
footprints, zones), `track` (net, copper layer, width, points), `via` (net, at, diameter, drill). Up to 64 per
request; they run in one KiCad commit. Move a footprint once per request (one `place` sets `at` and
`orientation`). Take pad positions from `board.json` after a `place`: rotation moves pads.

Refusals (exit 2, nothing changed): `usage` and `path` (the arguments), `run` (not a run folder), `request`
(malformed, or a footprint moved twice), `changed` (the candidate changed; read state.json again, or the window has
edits not made by the tool), `binding`, `footprint`, `net` (also when a new track or via would touch another net's
copper: KiCad would connect it to that net, a short; route it clear), `layer`, `locked` (never unlock parts
yourself; ask the user), `outline` (an item would leave the board outline). Failures (exit 3): `connection`,
`kicad`, `output`; nothing is saved, unless the problem says the edit was saved. Then do what it says: when its
checks did not finish, state.json counts the edit with objectives `none` and the next edit checks it again; when the
run folder could not record it or KiCad's state could not be read back, the user closes the editor and you open a
new candidate.

## 3. Read the objectives and the report

Each edit runs KiCad's DRC on the saved candidate. `objectives` is `pass` when DRC has no new error and the
unconnected items did not rise since open, otherwise `fail` with the new violations; fix a failing candidate with
another edit. `result.json` and `report.md` list the moved footprints (before/after), the created items, track
length and vias per touched net, DRC and unconnected counts and the `previews/before-*.svg` and `after-*.svg` files.
DRC is not signal integrity: say what it does not check.

## 4. Show the change, apply only when asked

Show the user the report: the changes, the objectives and the previews. Only when the user asks to apply a
candidate whose objectives passed, call the VERA tool `apply_candidate` with `{"run": "electronics-results/<run-id>"}`;
it writes the candidate over the source board through the normal approval. It is refused when the source changed
since open, the candidate changed since its check, or the board is open in KiCad (the user saves or discards their
changes there and closes it).

## 5. Close

```text
kicad-layout-tool close --run electronics-results/<run-id>
```

It stops the candidate's PCB editor window when it has no unsaved edits. The run folder stays.

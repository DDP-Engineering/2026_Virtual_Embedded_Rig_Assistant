---
name: pcb-review
description: Review a KiCad 10 board - layers, stackup, net classes, tracks, KiCad's DRC with unconnected items and parity - and produce checked fabrication exports. Use when asked to check a PCB layout or prepare Gerber, drill and position files.
---

Use `run_program` with program `kicad-tool`. It runs KiCad on a copy of the project and never changes it; do not
try to run `kicad-cli` directly (blocked).

## 1. Read the board

```text
kicad-tool inspect --project <folder>/<name>.kicad_pro
```

`summary.board` gives the layers, the stackup (or `available: false`), outline dimensions, footprints, per-net
track count, length and widths, vias, zones and the project's net classes. Read `result.json` when the printed
document is `truncated`.

## 2. Run DRC

```text
kicad-tool drc --project <folder>/<name>.kicad_pro
kicad-tool drc --project <folder>/<name>.kicad_pro --refill-zones
```

With a schematic in the project DRC also compares the board with it (parity); the schematic's own ERC belongs
to the schematic-review skill. Report KiCad's violations, unconnected items and schematic parity differences
with their types, severities, objects and positions. `--refill-zones` refills the zones on the copy only; say when you used it.
Zero DRC violations does not validate the design: DRC checks the board against its rules, not function,
current capacity, impedance or return paths.

## 3. Review the layout, separately

For current capacity, impedance or return paths name the parameters you need (current, copper thickness,
allowed temperature rise, stackup, target impedance) and use the electronics-calc plugin (`elec-calc`) for the
numbers; without them state that the point is not evaluated. A decoupling capacitor that is close to a pin is
not by itself good decoupling: the via and return path matter too. For every observation give the footprint,
pad or net, the condition, the source and whether it is a **fact** or a **hypothesis**.

## 4. Fabrication files

```text
kicad-tool export --project <folder>/<name>.kicad_pro --kind gerbers --layers F.Cu,B.Cu,F.Mask,B.Mask,F.SilkS,B.SilkS,F.Paste,B.Paste,Edge.Cuts
kicad-tool export --project <folder>/<name>.kicad_pro --kind drill
kicad-tool export --project <folder>/<name>.kicad_pro --kind pos
```

Choose the layer list with the user (inner layers `In1.Cu`... on multilayer boards); report each file's check
and the drill and position counts against the board. A failed check stops the hand-off to a manufacturer. Cite
the run folder (`result.json`, `report.md`) of every run.

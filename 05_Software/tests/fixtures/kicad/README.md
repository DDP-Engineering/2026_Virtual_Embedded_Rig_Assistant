# kicad fixtures

Fictional KiCad 10 projects for `tests/integration/kicad.test.ts`, written by `make_fixtures.py` (run it from
this folder with any Python 3.10+; UUIDs derive from names, so the output is deterministic). Every expected
value below follows from the design the script draws, and was written down before the helper existed; KiCad
10.0.8 confirmed each one. None was copied from `kicad-tool` output. Part numbers (`FX-...`) and circuits are
fictional.

Each project carries its own symbol library `fixture.kicad_sym` and footprint library `fixture.pretty`, named by
`sym-lib-table` / `fp-lib-table` with `${KIPRJMOD}` paths, so KiCad needs no global library.

`internals.py` reaches states no command line can arrange: the KiCad the helper finds (`locate`), the search
order of KiCad discovery over fake roots (`discover`), a missing or non-10 kicad-cli (`version`), a kicad-cli
that fails, writes nothing, cannot start, leaves a truncated Gerber or no job file (`fail`), a project file
that resolves outside its folder (`linkout`), a lower parse limit (`limit`), a source file changed during a
kicad-cli call (`change`), a call held long enough to stop the process tree (`slow`), every kicad-cli argument list recorded
(`calls`), and the document fitter fed oversized documents (`fit`).

## hier - hierarchy, instances, nets and BOM

Sheets (name path, file):

| Path | File | Page |
|---|---|---|
| `/` | `hier.kicad_sch` | 1 |
| `/ch1/` | `channel.kicad_sch` | 2 |
| `/ch2/` | `channel.kicad_sch` | 3 |
| `/monitor/` | `sub/monitor.kicad_sch` | 4 |
| `/monitor/probe/` | `sub/probe.kicad_sch` | 5 |

`sub/monitor.kicad_sch` names its sheet file `probe.kicad_sch`: KiCad resolves a sheet file from the folder of
the schematic that contains the sheet, so it is `sub/probe.kicad_sch`.

Root: J1 `PWR_IN` (pin 1 +5V, pin 2 GND), U1 `LDO_3V3` (IN +5V, OUT +3V3, GND), C1 10uF on +5V, C2, C3 and C10
10uF on +3V3 (C3 do-not-populate), H1 `MountingHole` (excluded from the BOM, no pins), J2 `EN_IN` (pin 1 EN_A,
pin 2 EN_B), PWR_FLAGs on +5V and GND. Each `channel` instance: R1 1k from EN to LED, D1 `LED_G` from LED
(anode, pin 2) to GND (cathode, pin 1), R2 100k from EN to GND; annotated R101/D101/R102 in ch1 and
R201/D201/R202 in ch2. `monitor`: R401 and R402 10k from +3V3 through MID to GND; `probe`: TP501 on MID.

Instances: 17 (8 root, 3 per channel, 2 monitor, 1 probe); power symbols and flags are not instances. The
channel symbols appear twice with the same symbol UUID and different sheet UUID paths: identity is the sheet
path plus the symbol UUID, never the reference.

Nets (8): `+3V3` {U1.2, C2.1, C3.1, C10.1, R401.1}; `+5V` {J1.1, U1.3, C1.1}; `GND` {J1.2, U1.1, C1.2, C2.2,
C3.2, C10.2, D101.1, D201.1, R102.2, R202.2, R402.2}; `/EN_A` {J2.1, R101.1, R102.1}; `/EN_B` {J2.2, R201.1,
R202.1}; `/ch1/LED` {R101.2, D101.2}; `/ch2/LED` {R201.2, D201.2}; `/monitor/MID` {R401.2, R402.1, TP501.1}. The
EN nets carry the root labels' names because KiCad names a net after the label of the highest sheet; the LED
net exists once per channel instance.

BOM (`Quantity,References,Value,Footprint,MPN,DNP`, rows ordered by their first reference):

| Qty | References | Value | Footprint | MPN | DNP |
|---|---|---|---|---|---|
| 3 | C1,C2,C10 | 10uF | fixture:C_0805 | FX-C0805-10U | |
| 1 | C3 | 10uF | fixture:C_0805 | FX-C0805-10U | yes |
| 2 | D101,D201 | LED_G | fixture:LED_0603 | FX-LED-G | |
| 1 | J1 | PWR_IN | fixture:Conn_2_THT | | |
| 1 | J2 | EN_IN | fixture:Conn_2_THT | | |
| 2 | R101,R201 | 1k | fixture:R_0603 | FX-R0603-1K | |
| 2 | R102,R202 | 100k | fixture:R_0603 | FX-R0603-100K | |
| 2 | R401,R402 | 10k | fixture:R_0603 | FX-R0603-10K | |
| 1 | TP501 | TP | fixture:TestPoint | | |
| 1 | U1 | LDO_3V3 | fixture:SOT-23 | FX-LDO33 | |

C10 follows C2 (natural order); the DNP C3 is a row of its own; H1 is in `excluded`. 16 instances in rows.
ERC: no violation (every pin is connected, +5V and GND carry a PWR_FLAG, +3V3 is driven by U1's output).
Power nets for the review (a `power_in` or `power_out` pin): `+3V3`, `+5V`, `GND`.

## erc - planted ERC defects

Root: two 10k resistors from BUS to GND, both annotated R1 (a duplicate reference), a GND PWR_FLAG, U1 `LOAD` with a power input on +12V that nothing drives,
a 10.16 mm wire at (127, 76.2) that touches nothing, and two instances `blk1`, `blk2` of `block.kicad_sch`,
whose buffer U (U101 / U201) has an unconnected input and drives BUS from its output.

| Sheet | Type | Severity | Object |
|---|---|---|---|
| `/` | `power_pin_not_driven` | error | the +12V power symbol's input pin (#PWR105) |
| `/` | `wire_dangling` | error | the wire |
| `/` | `unconnected_wire_endpoint` | warning | the wire (one per free end, 2) |
| `/blk1/` | `pin_not_connected` | error | U101 pin 1 |
| `/blk1/` | `pin_not_driven` | error | U101 pin 1 |
| `/blk2/` | `pin_not_driven` | error | U201 pin 1 |
| `/blk1/` | `pin_to_pin` | error | U101 pin 2 and U201 pin 2 (two outputs on BUS) |

8 violations: 6 errors, 2 warnings. KiCad marks an unconnected pin once per sheet file (on its first instance)
but checks drivers per instance, and reports a conflict once per net. KiCad 10.0.8's ERC does not report the
duplicate R1; kicad-tool's own check lists it under `duplicateReferences`: R1, unit 1, 2 instances, both on `/`.
Power symbols (references starting with `#`) are not counted: two GND power symbols on the root share
`#PWR101` on purpose, and KiCad's counts stay 6/2.

kicad-tool reads files from KiCad 8 on (schematic format 20231120, board 20240108); the tests refuse a copy saved
in KiCad 7's format. An instance entry with an empty reference is unannotated: KiCad 10.0.8's netlist shows it as
`R?`, so it is no duplicate.

## board - layout facts, DRC defects and exports

`defects.kicad_pcb`, 2 copper layers, outline 50 x 30 mm from (100, 100) to (150, 130), board thickness 1.6 mm,
stackup F.Mask 0.01, F.Cu 0.035, core 1.51 FR4 (er 4.5, tan d 0.02), B.Cu 0.035, B.Mask 0.01.

| Footprint | Position | Pads |
|---|---|---|
| J1 Conn_2_THT | (105, 110) | 1 VIN, 2 GND at (105, 113.5); drill 1.0 |
| R1 R_0805 | (115, 110) | 1 VIN (114.05), 2 OUT (115.95) |
| R2 R_0805 | (125, 110) | 1 OUT, 2 GND |
| R3 R_0805 | (115, 120) | 1 GND, 2 SIG |
| R4 R_0805 | (121, 105) | 1 SIG, 2 SPARE |
| H1 MountingHole_3.2mm | (145, 125) | NPTH 3.2, excluded from position files and BOM |

Tracks: VIN 1 segment 9.05 mm (0.5 wide); OUT 1 segment 8.1 mm; GND 2 segments, 20.95 mm on B.Cu and 3.5 mm on
F.Cu, 24.45 mm; SIG 2 segments, 4.1 + 15 = 19.1 mm. One GND via 0.8/0.4 at (125.95, 113.5). One GND zone on
B.Cu. Net classes (`defects.kicad_pro`): Default (clearance 0.2, track 0.25, via 0.8/0.4) and Power (clearance
1.0, track 0.5), pattern `VIN` -> Power.

DRC (2 violations, 1 unconnected item):
- `tracks_crossing` (error): the SIG track (120.05, 120)-(120.05, 105) crosses the OUT track on F.Cu at y = 110.
- `clearance` (error): R1 pad 1 (VIN, Power class 1.0 mm) to pad 2 (OUT): gap 1.9 - 1.0 = 0.9 mm < 1.0 mm.
- unconnected: R3 pad 1 (GND) has no track; KiCad pairs it with the nearest GND copper, the B.Cu track.

The same counts hold after `--refill-zones` (the zone is on B.Cu, away from the defects).

Exports: Gerbers for F.Cu, B.Cu, F.Mask, B.Mask, Edge.Cuts give 5 files with `%TF.FileFunction` (Copper L1 Top,
Copper L2 Bot, Soldermask Top/Bot, Profile) and the job file. Drill: PTH 3 holes (via 0.4 x 1, J1 1.0 x 2),
NPTH 1 hole (3.2). Position file: 5 rows (J1, R1, R2, R3, R4; H1 excluded). Board statistics: 6 footprints,
pads 2 through-hole, 8 SMD, 1 NPTH, 1 through via.

`clean.kicad_pcb`: R1 alone on a 20 x 10 mm board, nets A and B on one pad each: no violation, nothing
unconnected.

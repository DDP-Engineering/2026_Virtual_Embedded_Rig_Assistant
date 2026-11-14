"""Writes the fictional KiCad 10 board of the kicad-layout tests (see README.md for its design).

Run with any Python 3.10+ from this folder: `python make_fixtures.py`. It reuses the writers of the kicad plugin's
fixtures (../kicad/make_fixtures.py); the output is deterministic, UUIDs derive from names.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("kicad_fixtures", HERE.parent / "kicad" / "make_fixtures.py")
assert _spec and _spec.loader
kf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(kf)
Q, uid, sx, write = kf.Q, kf.uid, kf.sx, kf.write

OUTLINE = (100.0, 100.0, 150.0, 130.0)
# (footprint, value, reference, x, y, pad nets, locked)
FOOTPRINTS = [
    ("Conn_2_THT", "PWR_IN", "J1", 105.0, 112.0, {"1": "VIN", "2": "GND"}, False),
    ("SOT-23", "REG", "U1", 120.0, 112.0, {"1": "GND", "2": "VOUT", "3": "VIN"}, False),
    ("C_0805", "100n", "C1", 140.0, 125.0, {"1": "VIN", "2": "GND"}, False),
    ("R_0805", "10k", "R1", 130.0, 105.0, {"1": "VOUT", "2": "FB"}, False),
    ("R_0805", "10k", "R2", 133.0, 110.0, {"1": "FB", "2": "GND"}, False),
    ("MountingHole_3.2mm", "MountingHole", "H1", 145.0, 105.0, {}, True),
    ("R_0805", "1k", "R3", 110.0, 125.0, {"1": "SENSE"}, False),
    ("R_0805", "1k", "R4", 114.0, 127.0, {"1": "SENSE"}, False),
]
# (net, layer, width, start, end, locked)
SEGMENTS = [
    ("VIN", "F.Cu", 0.5, (105.0, 112.0), (121.0, 112.0), False),
    ("VOUT", "F.Cu", 0.25, (119.0, 111.05), (119.0, 105.0), False),
    ("VOUT", "F.Cu", 0.25, (119.0, 105.0), (129.05, 105.0), False),
    ("FB", "F.Cu", 0.25, (130.95, 105.0), (132.05, 110.0), False),
    ("GND", "B.Cu", 0.5, (105.0, 115.5), (134.0, 115.5), True),
    ("GND", "F.Cu", 0.25, (134.0, 115.5), (133.95, 110.0), False),
]
# (net, x, y, diameter, drill)
VIAS = [("GND", 134.0, 115.5, 0.8, 0.4)]


def board() -> str:
    body: list = [
        "kicad_pcb",
        ["version", kf.PCB_VERSION],
        ["generator", Q("pcbnew")],
        ["generator_version", Q("10.0")],
        ["general", ["thickness", 1.6], ["legacy_teardrops", False]],
        ["paper", Q("A4")],
        ["layers", *[[ordinal, Q(name), kind, *([Q(user)] if user else [])] for ordinal, name, kind, user in kf.LAYERS]],
        ["setup", kf.STACKUP, ["pad_to_mask_clearance", 0], ["allow_soldermask_bridges_in_footprints", False]],
    ]
    for name, value, ref, x, y, nets, locked in FOOTPRINTS:
        node = kf.fp_text(name, value, ref, x, y, nets, True)
        if locked:
            node.insert(2, ["locked", True])
        body.append(node)
    x1, y1, x2, y2 = OUTLINE
    body.append(["gr_rect", ["start", x1, y1], ["end", x2, y2], ["stroke", ["width", 0.1], ["type", "solid"]], ["fill", False], ["layer", Q("Edge.Cuts")], ["uuid", uid("layout", "outline")]])
    for index, (net, layer, width, (sx1, sy1), (sx2, sy2), locked) in enumerate(SEGMENTS):
        node = ["segment", ["start", sx1, sy1], ["end", sx2, sy2], ["width", width], ["layer", Q(layer)], ["net", Q(net)]]
        if locked:
            node.append(["locked", True])
        node.append(["uuid", uid("layout", "segment", index)])
        body.append(node)
    for index, (net, x, y, size, drill) in enumerate(VIAS):
        body.append(["via", ["at", x, y], ["size", size], ["drill", drill], ["layers", Q("F.Cu"), Q("B.Cu")], ["net", Q(net)], ["uuid", uid("layout", "via", index)]])
    body.append(["embedded_fonts", False])
    return sx(body) + "\n"


def main() -> None:
    folder = HERE / "board"
    write(folder / "layout.kicad_pcb", board())
    write(folder / "layout.kicad_pro", kf.project_file("layout"))
    kf.footprint_library(folder)
    kf.lib_tables(folder, symbols=False, footprints=True)
    print("fixtures written")


if __name__ == "__main__":
    main()

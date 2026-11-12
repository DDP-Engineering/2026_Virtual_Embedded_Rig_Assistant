"""Writes the fictional KiCad 10 projects under this folder (see README.md for the design and expected values).

Run with any Python 3.10+ from this folder: `python make_fixtures.py`. The output is deterministic (UUIDs derive
from names), so a regenerated fixture is byte-identical unless this script changes.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAMESPACE = uuid.UUID("6f1c7a52-2b0e-4f7e-9d9a-0c4e3a1b5d21")
SCH_VERSION = 20260306
PCB_VERSION = 20260206
FP_VERSION = 20260206


class Q(str):
    """A quoted string token."""


def uid(*names: object) -> Q:
    return Q(str(uuid.uuid5(NAMESPACE, "/".join(str(name) for name in names))))


def num(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def sx(node: object, depth: int = 0) -> str:
    if isinstance(node, Q):
        return '"' + node.replace("\\", "\\\\").replace('"', '\\"') + '"'
    if isinstance(node, bool):
        return "yes" if node else "no"
    if isinstance(node, (int, float)):
        return num(node) if isinstance(node, float) else str(node)
    if isinstance(node, str):
        return node
    assert isinstance(node, list) and node
    inner = [sx(child, depth + 1) for child in node]
    if all(not isinstance(child, list) for child in node) or (len(node) <= 4 and sum(isinstance(c, list) for c in node) == 0):
        return "(" + " ".join(inner) + ")"
    pad = "\t" * (depth + 1)
    head = [inner[0]]
    rest = []
    for child, text in zip(node[1:], inner[1:]):
        if isinstance(child, list):
            rest.append("\n" + pad + text)
        else:
            head.append(text)
    return "(" + " ".join(head) + "".join(rest) + "\n" + "\t" * depth + ")"


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


# ---------------------------------------------------------------- symbols

FONT = ["effects", ["font", ["size", 1.27, 1.27]]]
HIDDEN = ["effects", ["font", ["size", 1.27, 1.27]], ["hide", True]]


def prop(name: str, value: str, x: float = 0.0, y: float = 0.0, hidden: bool = False) -> list:
    return ["property", Q(name), Q(value), ["at", x, y, 0], HIDDEN if hidden else FONT]


def pin(kind: str, x: float, y: float, angle: int, length: float, name: str, number: str, hide: bool = False) -> list:
    node = ["pin", kind, "line", ["at", x, y, angle], ["length", length]]
    if hide:
        node.append(["hide", True])
    node += [["name", Q(name), FONT], ["number", Q(number), FONT]]
    return node


def box(x1: float, y1: float, x2: float, y2: float) -> list:
    return [
        "rectangle",
        ["start", x1, y1],
        ["end", x2, y2],
        ["stroke", ["width", 0.254], ["type", "default"]],
        ["fill", ["type", "none"]],
    ]


# Symbol definitions: (reference prefix, power?, pins [(type, x, y, angle, length, name, number, hidden)], body).
SYMBOLS: dict[str, dict] = {
    "R": {"ref": "R", "pins": [("passive", 0, 3.81, 270, 1.27, "~", "1"), ("passive", 0, -3.81, 90, 1.27, "~", "2")], "body": box(-1.016, -2.54, 1.016, 2.54)},
    "C": {"ref": "C", "pins": [("passive", 0, 3.81, 270, 2.794, "~", "1"), ("passive", 0, -3.81, 90, 2.794, "~", "2")], "body": box(-2.032, -0.762, 2.032, 0.762)},
    "LED": {"ref": "D", "pins": [("passive", 0, 3.81, 270, 2.54, "A", "2"), ("passive", 0, -3.81, 90, 2.54, "K", "1")], "body": box(-1.27, -1.27, 1.27, 1.27)},
    "Conn_2": {"ref": "J", "pins": [("passive", -5.08, 1.27, 0, 3.81, "Pin_1", "1"), ("passive", -5.08, -1.27, 0, 3.81, "Pin_2", "2")], "body": box(-1.27, -2.54, 1.27, 2.54)},
    "LDO": {"ref": "U", "pins": [("power_in", -7.62, 0, 0, 2.54, "IN", "3"), ("power_out", 7.62, 0, 180, 2.54, "OUT", "2"), ("power_in", 0, -7.62, 90, 2.54, "GND", "1")], "body": box(-5.08, -5.08, 5.08, 5.08)},
    "BUF": {"ref": "U", "pins": [("input", -7.62, 0, 0, 2.54, "IN", "1"), ("output", 7.62, 0, 180, 2.54, "OUT", "2")], "body": box(-5.08, -2.54, 5.08, 2.54)},
    "LOAD": {"ref": "U", "pins": [("power_in", 0, 7.62, 270, 2.54, "VCC", "1"), ("power_in", 0, -7.62, 90, 2.54, "GND", "2")], "body": box(-5.08, -5.08, 5.08, 5.08)},
    "TestPoint": {"ref": "TP", "pins": [("passive", 0, -2.54, 90, 2.54, "1", "1")], "body": box(-0.762, -0.762, 0.762, 0.762)},
    "MountingHole": {"ref": "H", "pins": [], "body": box(-1.27, -1.27, 1.27, 1.27)},
    "+5V": {"ref": "#PWR", "power": True, "pins": [("power_in", 0, 0, 90, 0, "+5V", "1", True)], "body": box(-0.762, 1.27, 0.762, 2.54)},
    "+3V3": {"ref": "#PWR", "power": True, "pins": [("power_in", 0, 0, 90, 0, "+3V3", "1", True)], "body": box(-0.762, 1.27, 0.762, 2.54)},
    "+12V": {"ref": "#PWR", "power": True, "pins": [("power_in", 0, 0, 90, 0, "+12V", "1", True)], "body": box(-0.762, 1.27, 0.762, 2.54)},
    "GND": {"ref": "#PWR", "power": True, "pins": [("power_in", 0, 0, 270, 0, "GND", "1", True)], "body": box(-1.27, -2.54, 1.27, -1.27)},
    "PWR_FLAG": {"ref": "#FLG", "power": True, "flag": True, "pins": [("power_out", 0, 0, 90, 0, "pwr", "1")], "body": box(-1.016, 1.27, 1.016, 2.54)},
}


def symbol_definition(name: str, qualified: bool) -> list:
    spec = SYMBOLS[name]
    node: list = ["symbol", Q(f"fixture:{name}" if qualified else name)]
    if spec.get("power") and not spec.get("flag"):
        node.append(["power", "global"])
    elif spec.get("flag"):
        node.append(["power", "global"])
    node += [
        ["pin_names", ["offset", 0]],
        ["exclude_from_sim", False],
        ["in_bom", not spec.get("power", False)],
        ["on_board", not spec.get("power", False)],
        prop("Reference", spec["ref"], 0, 3.81, hidden=spec.get("power", False)),
        prop("Value", name, 0, -3.81),
        prop("Footprint", "", 0, 0, hidden=True),
        prop("Datasheet", "", 0, 0, hidden=True),
        prop("Description", f"Fixture {name}", 0, 0, hidden=True),
        ["symbol", Q(f"{name}_0_1"), spec["body"]],
    ]
    unit: list = ["symbol", Q(f"{name}_1_1")]
    for kind, x, y, angle, length, pin_name, number, *hidden in spec["pins"]:
        unit.append(pin(kind, x, y, angle, length, pin_name, number, bool(hidden and hidden[0])))
    node.append(unit)
    node.append(["embedded_fonts", False])
    return node


def symbol_library(names: list[str]) -> str:
    return sx(["kicad_symbol_lib", ["version", 20251024], ["generator", Q("kicad_symbol_editor")], ["generator_version", Q("10.0")], *[symbol_definition(n, False) for n in names]]) + "\n"


# ---------------------------------------------------------------- schematics


class Sheet:
    """One schematic file. Parts carry a reference per sheet-instance path."""

    def __init__(self, project: str, name: str) -> None:
        self.project = project
        self.name = name
        self.uuid = uid(project, name, "sheet-file")
        self.items: list = []
        self.used: set[str] = set()
        self.count = 0
        self.powers = 0

    def _stub(self, x: float, y: float, angle: int) -> tuple[float, float]:
        # Pin angle points from the connection point into the body; the stub goes the other way.
        dx, dy = {0: (-2.54, 0), 180: (2.54, 0), 90: (0, 2.54), 270: (0, -2.54)}[angle]
        end = (round(x + dx, 4), round(y + dy, 4))
        self.count += 1
        self.items.append(["wire", ["pts", ["xy", x, y], ["xy", end[0], end[1]]], ["stroke", ["width", 0], ["type", "default"]], ["uuid", uid(self.project, self.name, "wire", self.count)]])
        return end

    def label(self, net: str, x: float, y: float) -> None:
        self.count += 1
        self.items.append(["label", Q(net), ["at", x, y, 0], ["effects", ["font", ["size", 1.27, 1.27]], ["justify", "left", "bottom"]], ["uuid", uid(self.project, self.name, "label", self.count)]])

    def hlabel(self, net: str, shape: str, x: float, y: float) -> None:
        self.count += 1
        self.items.append(["hierarchical_label", Q(net), ["shape", shape], ["at", x, y, 180], ["effects", ["font", ["size", 1.27, 1.27]], ["justify", "right"]], ["uuid", uid(self.project, self.name, "hlabel", self.count)]])

    def place(self, lib: str, key: str, x: float, y: float, refs: dict[str, str], value: str, footprint: str = "", nets: dict[str, str] | None = None, fields: dict[str, str] | None = None, dnp: bool = False, in_bom: bool = True) -> None:
        """Place a symbol; `nets` maps pin numbers to a net: `label:NAME`, `hier:NAME:shape`, `power:NAME`, `none`."""
        self.used.add(lib)
        spec = SYMBOLS[lib]
        node: list = [
            "symbol",
            ["lib_id", Q(f"fixture:{lib}")],
            ["at", x, y, 0],
            ["unit", 1],
            ["body_style", 1],
            ["exclude_from_sim", False],
            ["in_bom", in_bom and not spec.get("power", False)],
            ["on_board", not spec.get("power", False)],
            ["dnp", dnp],
            ["uuid", uid(self.project, self.name, "symbol", key)],
            prop("Reference", next(iter(refs.values())), x + 2.54, y - 1.27, hidden=spec.get("power", False)),
            prop("Value", value, x + 2.54, y + 1.27),
            prop("Footprint", footprint, x, y, hidden=True),
            prop("Datasheet", "", x, y, hidden=True),
            prop("Description", "", x, y, hidden=True),
        ]
        for field, text in (fields or {}).items():
            node.append(prop(field, text, x, y, hidden=True))
        for kind, px, py, angle, length, name, number, *hidden in spec["pins"]:
            node.append(["pin", Q(number), ["uuid", uid(self.project, self.name, "symbol", key, "pin", number)]])
        node.append(["instances", ["project", Q(self.project), *[["path", Q(path), ["reference", Q(ref)], ["unit", 1]] for path, ref in refs.items()]]])
        self.items.append(node)
        for kind, px, py, angle, length, name, number, *hidden in spec["pins"]:
            target = (nets or {}).get(number, "none")
            if target == "none" or spec.get("power"):
                continue
            end = self._stub(round(x + px, 4), round(y - py, 4), angle)
            mode, _, rest = target.partition(":")
            if mode == "label":
                self.label(rest, *end)
            elif mode == "hier":
                net, _, shape = rest.partition(":")
                self.hlabel(net, shape, *end)
            elif mode == "power":
                self.power(rest, end[0], end[1], refs, key + "-" + number)
            elif mode == "wire":  # A dangling wire: the stub only.
                pass

    def power(self, name: str, x: float, y: float, owner_refs: dict[str, str], key: str) -> None:
        """A power symbol whose reference is unique per sheet instance (#PWR<instance><count>)."""
        self.powers += 1
        prefix = "#FLG" if name == "PWR_FLAG" else "#PWR"
        refs = {path: f"{prefix}{index + 1}{self.powers:02d}" for index, path in enumerate(owner_refs)}
        self.place(name, f"pwr-{key}-{self.powers}", x, y, refs, name)

    def flag(self, net: str, x: float, y: float, refs: dict[str, str]) -> None:
        """A power symbol for `net` joined by a wire to a PWR_FLAG, so that ERC sees the net driven."""
        self.power(net, x, y, refs, f"flag-{net}")
        end = self._stub(x, y, 180)
        self.power("PWR_FLAG", end[0], end[1], refs, f"flag-{net}-pwr")

    def sheet(self, key: str, name: str, file: str, x: float, y: float, pins: list[tuple[str, str, str]], parent_path: str, page: str) -> None:
        """A sheet symbol with pins (name, shape, root net label); pins sit on the left edge, 2.54 mm apart."""
        height = 5.08 + 2.54 * len(pins)
        node: list = [
            "sheet",
            ["at", x, y],
            ["size", 20.32, height],
            ["exclude_from_sim", False],
            ["in_bom", True],
            ["on_board", True],
            ["dnp", False],
            ["stroke", ["width", 0], ["type", "solid"]],
            ["fill", ["color", 0, 0, 0, 0]],
            ["uuid", uid(self.project, self.name, "sheet", key)],
            ["property", Q("Sheetname"), Q(name), ["at", x, y - 0.7, 0], ["effects", ["font", ["size", 1.27, 1.27]], ["justify", "left", "bottom"]]],
            ["property", Q("Sheetfile"), Q(file), ["at", x, y + height + 0.6, 0], ["effects", ["font", ["size", 1.27, 1.27]], ["justify", "left", "top"]]],
        ]
        for index, (pin_name, shape, net) in enumerate(pins):
            py = round(y + 2.54 * (index + 1), 4)
            node.append(["pin", Q(pin_name), shape, ["at", x, py, 180], ["uuid", uid(self.project, self.name, "sheet", key, "pin", pin_name)], ["effects", ["font", ["size", 1.27, 1.27]], ["justify", "left"]]])
            end = self._stub(x, py, 0)
            self.label(net, *end)
        node.append(["instances", ["project", Q(self.project), ["path", Q(parent_path), ["page", Q(page)]]]])
        self.items.append(node)

    def rename(self, old: str, new: str) -> None:
        """Gives every symbol now annotated `old` the reference `new` (a deliberate duplicate)."""

        def walk(node: list) -> None:
            for index, child in enumerate(node):
                if isinstance(child, list):
                    if child[:2] == ["property", Q("Reference")] and child[2] == old:
                        child[2] = Q(new)
                    elif child[:1] == ["reference"] and child[1] == old:
                        child[1] = Q(new)
                    walk(child)

        walk(self.items)

    def text(self, root: bool) -> str:
        body: list = [
            "kicad_sch",
            ["version", SCH_VERSION],
            ["generator", Q("eeschema")],
            ["generator_version", Q("10.0")],
            ["uuid", self.uuid],
            ["paper", Q("A4")],
            ["lib_symbols", *[symbol_definition(name, True) for name in sorted(self.used)]],
            *self.items,
        ]
        if root:
            body.append(["sheet_instances", ["path", Q("/"), ["page", Q("1")]]])
        body.append(["embedded_fonts", False])
        return sx(body) + "\n"


def project_file(name: str, classes: list[dict] | None = None, patterns: list[dict] | None = None) -> str:
    default = {
        "bus_width": 12, "clearance": 0.2, "diff_pair_gap": 0.25, "diff_pair_via_gap": 0.25, "diff_pair_width": 0.2,
        "line_style": 0, "microvia_diameter": 0.3, "microvia_drill": 0.1, "name": "Default", "pcb_color": "rgba(0, 0, 0, 0.000)",
        "priority": 2147483647, "schematic_color": "rgba(0, 0, 0, 0.000)", "track_width": 0.25, "tuning_profile": "",
        "via_diameter": 0.8, "via_drill": 0.4, "wire_width": 6,
    }
    data = {
        "meta": {"filename": f"{name}.kicad_pro", "version": 3},
        "net_settings": {
            "classes": [default, *(classes or [])],
            "meta": {"version": 5},
            "net_colors": None,
            "netclass_assignments": None,
            "netclass_patterns": patterns or [],
        },
    }
    return json.dumps(data, indent=2) + "\n"


def lib_tables(folder: Path, symbols: bool, footprints: bool) -> None:
    if symbols:
        write(folder / "sym-lib-table", '(sym_lib_table\n\t(version 7)\n\t(lib (name "fixture") (type "KiCad") (uri "${KIPRJMOD}/fixture.kicad_sym") (options "") (descr "Fixture symbols"))\n)\n')
    if footprints:
        write(folder / "fp-lib-table", '(fp_lib_table\n\t(version 7)\n\t(lib (name "fixture") (type "KiCad") (uri "${KIPRJMOD}/fixture.pretty") (options "") (descr "Fixture footprints"))\n)\n')


def make_hier() -> None:
    folder = HERE / "hier"
    project = "hier"
    root = Sheet(project, "hier.kicad_sch")
    rp = f"/{root.uuid}"
    ch1, ch2, mon = uid(project, root.name, "sheet", "ch1"), uid(project, root.name, "sheet", "ch2"), uid(project, root.name, "sheet", "monitor")
    root.place("Conn_2", "J1", 30.48, 50.8, {rp: "J1"}, "PWR_IN", "fixture:Conn_2_THT", {"1": "power:+5V", "2": "power:GND"})
    root.flag("+5V", 20.32, 25.4, {rp: ""})
    root.flag("GND", 45.72, 25.4, {rp: ""})
    root.place("LDO", "U1", 63.5, 50.8, {rp: "U1"}, "LDO_3V3", "fixture:SOT-23", {"3": "power:+5V", "2": "power:+3V3", "1": "power:GND"}, {"MPN": "FX-LDO33"})
    root.place("C", "C1", 45.72, 66.04, {rp: "C1"}, "10uF", "fixture:C_0805", {"1": "power:+5V", "2": "power:GND"}, {"MPN": "FX-C0805-10U"})
    root.place("C", "C2", 81.28, 66.04, {rp: "C2"}, "10uF", "fixture:C_0805", {"1": "power:+3V3", "2": "power:GND"}, {"MPN": "FX-C0805-10U"})
    root.place("C", "C3", 91.44, 66.04, {rp: "C3"}, "10uF", "fixture:C_0805", {"1": "power:+3V3", "2": "power:GND"}, {"MPN": "FX-C0805-10U"}, dnp=True)
    root.place("C", "C10", 101.6, 66.04, {rp: "C10"}, "10uF", "fixture:C_0805", {"1": "power:+3V3", "2": "power:GND"}, {"MPN": "FX-C0805-10U"})
    root.place("MountingHole", "H1", 120.65, 30.48, {rp: "H1"}, "MountingHole", "fixture:MountingHole_3.2mm", in_bom=False)
    root.place("Conn_2", "J2", 30.48, 101.6, {rp: "J2"}, "EN_IN", "fixture:Conn_2_THT", {"1": "label:EN_A", "2": "label:EN_B"})
    root.sheet("ch1", "ch1", "channel.kicad_sch", 76.2, 96.52, [("EN", "input", "EN_A")], rp, "2")
    root.sheet("ch2", "ch2", "channel.kicad_sch", 76.2, 116.84, [("EN", "input", "EN_B")], rp, "3")
    root.sheet("monitor", "monitor", "sub/monitor.kicad_sch", 127.0, 96.52, [], rp, "4")
    write(folder / "hier.kicad_sch", root.text(True))

    channel = Sheet(project, "channel.kicad_sch")
    paths = {f"{rp}/{ch1}": "1", f"{rp}/{ch2}": "2"}
    channel.place("R", "R1", 50.8, 50.8, {p: f"R{n}01" for p, n in paths.items()}, "1k", "fixture:R_0603", {"1": "hier:EN:input", "2": "label:LED"}, {"MPN": "FX-R0603-1K"})
    channel.place("LED", "D1", 50.8, 71.12, {p: f"D{n}01" for p, n in paths.items()}, "LED_G", "fixture:LED_0603", {"2": "label:LED", "1": "power:GND"}, {"MPN": "FX-LED-G"})
    channel.place("R", "R2", 71.12, 50.8, {p: f"R{n}02" for p, n in paths.items()}, "100k", "fixture:R_0603", {"1": "hier:EN:input", "2": "power:GND"}, {"MPN": "FX-R0603-100K"})
    write(folder / "channel.kicad_sch", channel.text(False))

    monitor = Sheet(project, "sub/monitor.kicad_sch")
    mp = f"{rp}/{mon}"
    probe = uid(project, monitor.name, "sheet", "probe")
    monitor.place("R", "R1", 50.8, 50.8, {mp: "R401"}, "10k", "fixture:R_0603", {"1": "power:+3V3", "2": "label:MID"}, {"MPN": "FX-R0603-10K"})
    monitor.place("R", "R2", 50.8, 71.12, {mp: "R402"}, "10k", "fixture:R_0603", {"1": "label:MID", "2": "power:GND"}, {"MPN": "FX-R0603-10K"})
    monitor.sheet("probe", "probe", "probe.kicad_sch", 101.6, 50.8, [("MID", "passive", "MID")], mp, "5")
    write(folder / "sub" / "monitor.kicad_sch", monitor.text(False))

    probe_sheet = Sheet(project, "sub/probe.kicad_sch")
    probe_sheet.place("TestPoint", "TP1", 50.8, 50.8, {f"{mp}/{probe}": "TP501"}, "TP", "fixture:TestPoint", {"1": "hier:MID:passive"})
    write(folder / "sub" / "probe.kicad_sch", probe_sheet.text(False))

    write(folder / "hier.kicad_pro", project_file(project))
    write(folder / "fixture.kicad_sym", symbol_library(sorted(SYMBOLS)))
    footprint_library(folder)
    lib_tables(folder, symbols=True, footprints=True)


def make_erc(name: str = "erc") -> None:
    folder = HERE / name
    project = name
    root = Sheet(project, "erc.kicad_sch")
    rp = f"/{root.uuid}"
    b1, b2 = uid(project, root.name, "sheet", "blk1"), uid(project, root.name, "sheet", "blk2")
    # BUS load: two pull-downs, both annotated R1 (KiCad's ERC does not report a duplicate reference).
    root.place("R", "R1", 40.64, 50.8, {rp: "R1"}, "10k", "fixture:R_0603", {"1": "label:BUS", "2": "power:GND"})
    root.place("R", "R2", 55.88, 50.8, {rp: "R1"}, "10k", "fixture:R_0603", {"1": "label:BUS", "2": "power:GND"})
    root.flag("GND", 25.4, 76.2, {rp: ""})
    # Defect: a power input on +12V that no power output or flag drives.
    root.place("LOAD", "U1", 101.6, 50.8, {rp: "U1"}, "LOAD", "fixture:SOT-23", {"1": "power:+12V", "2": "power:GND"})
    # Defect: a wire that ends in the air.
    root.count += 1
    root.items.append(["wire", ["pts", ["xy", 127.0, 76.2], ["xy", 137.16, 76.2]], ["stroke", ["width", 0], ["type", "default"]], ["uuid", uid(project, root.name, "wire", "dangling")]])
    # Defect: both blocks drive BUS from an output pin.
    root.sheet("blk1", "blk1", "block.kicad_sch", 76.2, 96.52, [("OUT", "output", "BUS")], rp, "2")
    root.sheet("blk2", "blk2", "block.kicad_sch", 76.2, 116.84, [("OUT", "output", "BUS")], rp, "3")
    # Two GND power symbols share #PWR101: power symbols are not part of the duplicate-reference check.
    root.rename("#PWR106", "#PWR101")

    block = Sheet(project, "block.kicad_sch")
    paths = {f"{rp}/{b1}": "1", f"{rp}/{b2}": "2"}
    # Defect: the buffer's input pin is left unconnected in every instance.
    block.place("BUF", "U1", 50.8, 50.8, {p: f"U{n}01" for p, n in paths.items()}, "BUF", "fixture:SOT-23", {"1": "none", "2": "hier:OUT:output"})
    write(folder / "erc.kicad_sch", root.text(True))
    write(folder / "block.kicad_sch", block.text(False))
    write(folder / "erc.kicad_pro", project_file(project).replace(f'"{project}.kicad_pro"', '"erc.kicad_pro"'))
    write(folder / "fixture.kicad_sym", symbol_library(sorted(SYMBOLS)))
    footprint_library(folder)
    lib_tables(folder, symbols=True, footprints=True)


# ---------------------------------------------------------------- boards

LAYERS = [
    (0, "F.Cu", "signal", None), (2, "B.Cu", "signal", None), (9, "F.Adhes", "user", "F.Adhesive"), (11, "B.Adhes", "user", "B.Adhesive"),
    (13, "F.Paste", "user", None), (15, "B.Paste", "user", None), (5, "F.SilkS", "user", "F.Silkscreen"), (7, "B.SilkS", "user", "B.Silkscreen"),
    (1, "F.Mask", "user", None), (3, "B.Mask", "user", None), (17, "Dwgs.User", "user", "User.Drawings"), (19, "Cmts.User", "user", "User.Comments"),
    (21, "Eco1.User", "user", "User.Eco1"), (23, "Eco2.User", "user", "User.Eco2"), (25, "Edge.Cuts", "user", None), (27, "Margin", "user", None),
    (31, "F.CrtYd", "user", "F.Courtyard"), (29, "B.CrtYd", "user", "B.Courtyard"), (35, "F.Fab", "user", None), (33, "B.Fab", "user", None),
]

STACKUP = [
    "stackup",
    ["layer", Q("F.SilkS"), ["type", Q("Top Silk Screen")]],
    ["layer", Q("F.Paste"), ["type", Q("Top Solder Paste")]],
    ["layer", Q("F.Mask"), ["type", Q("Top Solder Mask")], ["thickness", 0.01]],
    ["layer", Q("F.Cu"), ["type", Q("copper")], ["thickness", 0.035]],
    ["layer", Q("dielectric 1"), ["type", Q("core")], ["thickness", 1.51], ["material", Q("FR4")], ["epsilon_r", 4.5], ["loss_tangent", 0.02]],
    ["layer", Q("B.Cu"), ["type", Q("copper")], ["thickness", 0.035]],
    ["layer", Q("B.Mask"), ["type", Q("Bottom Solder Mask")], ["thickness", 0.01]],
    ["layer", Q("B.Paste"), ["type", Q("Bottom Solder Paste")]],
    ["layer", Q("B.SilkS"), ["type", Q("Bottom Silk Screen")]],
    ["copper_finish", Q("None")],
    ["dielectric_constraints", False],
]

# Footprints: name -> (attr flags, pads [(number, type, shape, x, y, w, h, drill, layers)]).
FOOTPRINTS: dict[str, tuple[list[str], list[tuple]]] = {
    "R_0805": (["smd"], [("1", "smd", "rect", -0.95, 0, 1.0, 1.25, None, ["F.Cu", "F.Paste", "F.Mask"]), ("2", "smd", "rect", 0.95, 0, 1.0, 1.25, None, ["F.Cu", "F.Paste", "F.Mask"])]),
    "Conn_2_THT": (["through_hole"], [("1", "thru_hole", "circle", 0, 0, 1.7, 1.7, 1.0, ["*.Cu", "*.Mask"]), ("2", "thru_hole", "circle", 0, 3.5, 1.7, 1.7, 1.0, ["*.Cu", "*.Mask"])]),
    "R_0603": (["smd"], [("1", "smd", "rect", -0.8, 0, 0.8, 0.95, None, ["F.Cu", "F.Paste", "F.Mask"]), ("2", "smd", "rect", 0.8, 0, 0.8, 0.95, None, ["F.Cu", "F.Paste", "F.Mask"])]),
    "C_0805": (["smd"], [("1", "smd", "rect", -0.95, 0, 1.0, 1.45, None, ["F.Cu", "F.Paste", "F.Mask"]), ("2", "smd", "rect", 0.95, 0, 1.0, 1.45, None, ["F.Cu", "F.Paste", "F.Mask"])]),
    "LED_0603": (["smd"], [("1", "smd", "rect", -0.8, 0, 0.8, 0.95, None, ["F.Cu", "F.Paste", "F.Mask"]), ("2", "smd", "rect", 0.8, 0, 0.8, 0.95, None, ["F.Cu", "F.Paste", "F.Mask"])]),
    "SOT-23": (["smd"], [("1", "smd", "rect", -1.0, 0.95, 0.9, 0.8, None, ["F.Cu", "F.Paste", "F.Mask"]), ("2", "smd", "rect", -1.0, -0.95, 0.9, 0.8, None, ["F.Cu", "F.Paste", "F.Mask"]), ("3", "smd", "rect", 1.0, 0, 0.9, 0.8, None, ["F.Cu", "F.Paste", "F.Mask"])]),
    "TestPoint": (["smd"], [("1", "smd", "circle", 0, 0, 1.5, 1.5, None, ["F.Cu", "F.Mask"])]),
    "MountingHole_3.2mm": (["exclude_from_pos_files", "exclude_from_bom"], [("", "np_thru_hole", "circle", 0, 0, 3.2, 3.2, 3.2, ["*.Cu", "*.Mask"])]),
}


def fp_text(name: str, value: str, ref: str, x: float, y: float, nets: dict[str, str] | None, placed: bool) -> list:
    attrs, pads = FOOTPRINTS[name]
    node: list = ["footprint", Q(f"fixture:{name}" if placed else name)]
    if not placed:
        node += [["version", FP_VERSION], ["generator", Q("pcbnew")], ["generator_version", Q("10.0")]]
    node.append(["layer", Q("F.Cu")])
    if placed:
        node += [["uuid", uid("board", ref)], ["at", x, y]]
    node += [
        ["descr", Q(f"Fixture footprint {name}")],
        ["property", Q("Reference"), Q(ref if placed else "REF**"), ["at", 0, -2, 0], ["layer", Q("F.Fab")], ["uuid", uid("fp", name, ref, "ref")], ["effects", ["font", ["size", 1, 1], ["thickness", 0.15]]]],
        ["property", Q("Value"), Q(value if placed else name), ["at", 0, 2, 0], ["layer", Q("F.Fab")], ["uuid", uid("fp", name, ref, "value")], ["effects", ["font", ["size", 1, 1], ["thickness", 0.15]]]],
        ["property", Q("Datasheet"), Q(""), ["at", 0, 0, 0], ["layer", Q("F.Fab")], ["hide", True], ["uuid", uid("fp", name, ref, "ds")], ["effects", ["font", ["size", 1, 1], ["thickness", 0.15]]]],
        ["property", Q("Description"), Q(""), ["at", 0, 0, 0], ["layer", Q("F.Fab")], ["hide", True], ["uuid", uid("fp", name, ref, "desc")], ["effects", ["font", ["size", 1, 1], ["thickness", 0.15]]]],
        ["attr", *attrs],
    ]
    for number, kind, shape, px, py, w, h, drill, layers in pads:
        pad: list = ["pad", Q(number), kind, shape, ["at", px, py], ["size", w, h]]
        if drill is not None:
            pad.append(["drill", drill])
        pad.append(["layers", *[Q(layer) for layer in layers]])
        if placed and nets and number in nets:
            pad.append(["net", Q(nets[number])])
        pad.append(["uuid", uid("fp", name, ref, "pad", number)])
        node.append(pad)
    node.append(["embedded_fonts", False])
    return node


def board_text(footprints: list[tuple], segments: list[tuple], vias: list[tuple], zones: list[tuple], outline: tuple) -> str:
    body: list = [
        "kicad_pcb",
        ["version", PCB_VERSION],
        ["generator", Q("pcbnew")],
        ["generator_version", Q("10.0")],
        ["general", ["thickness", 1.6], ["legacy_teardrops", False]],
        ["paper", Q("A4")],
        ["layers", *[[ordinal, Q(name), kind, *([Q(user)] if user else [])] for ordinal, name, kind, user in LAYERS]],
        ["setup", STACKUP, ["pad_to_mask_clearance", 0], ["allow_soldermask_bridges_in_footprints", False]],
    ]
    for name, value, ref, x, y, nets in footprints:
        body.append(fp_text(name, value, ref, x, y, nets, True))
    x1, y1, x2, y2 = outline
    body.append(["gr_rect", ["start", x1, y1], ["end", x2, y2], ["stroke", ["width", 0.1], ["type", "solid"]], ["fill", False], ["layer", Q("Edge.Cuts")], ["uuid", uid("board", "outline", x1, y1)]])
    for index, (net, layer, width, (sx1, sy1), (sx2, sy2)) in enumerate(segments):
        body.append(["segment", ["start", sx1, sy1], ["end", sx2, sy2], ["width", width], ["layer", Q(layer)], ["net", Q(net)], ["uuid", uid("board", "segment", index, net)]])
    for index, (net, x, y, size, drill) in enumerate(vias):
        body.append(["via", ["at", x, y], ["size", size], ["drill", drill], ["layers", Q("F.Cu"), Q("B.Cu")], ["net", Q(net)], ["uuid", uid("board", "via", index)]])
    for index, (net, layer, (zx1, zy1, zx2, zy2)) in enumerate(zones):
        body.append([
            "zone", ["net", Q(net)], ["layer", Q(layer)], ["uuid", uid("board", "zone", index)], ["hatch", "edge", 0.5],
            ["connect_pads", ["clearance", 0.5]], ["min_thickness", 0.25], ["filled_areas_thickness", False],
            ["fill", ["thermal_gap", 0.5], ["thermal_bridge_width", 0.5]],
            ["polygon", ["pts", ["xy", zx1, zy1], ["xy", zx2, zy1], ["xy", zx2, zy2], ["xy", zx1, zy2]]],
        ])
    body.append(["embedded_fonts", False])
    return sx(body) + "\n"


def make_board() -> None:
    folder = HERE / "board"
    footprints = [
        ("Conn_2_THT", "PWR_IN", "J1", 105.0, 110.0, {"1": "VIN", "2": "GND"}),
        ("R_0805", "1k", "R1", 115.0, 110.0, {"1": "VIN", "2": "OUT"}),
        ("R_0805", "1k", "R2", 125.0, 110.0, {"1": "OUT", "2": "GND"}),
        ("R_0805", "10k", "R3", 115.0, 120.0, {"1": "GND", "2": "SIG"}),
        ("R_0805", "10k", "R4", 121.0, 105.0, {"1": "SIG", "2": "SPARE"}),
        ("MountingHole_3.2mm", "MountingHole", "H1", 145.0, 125.0, {}),
    ]
    segments = [
        ("VIN", "F.Cu", 0.5, (105.0, 110.0), (114.05, 110.0)),
        ("OUT", "F.Cu", 0.25, (115.95, 110.0), (124.05, 110.0)),
        ("GND", "B.Cu", 0.25, (105.0, 113.5), (125.95, 113.5)),
        ("GND", "F.Cu", 0.25, (125.95, 113.5), (125.95, 110.0)),
        ("SIG", "F.Cu", 0.25, (115.95, 120.0), (120.05, 120.0)),
        ("SIG", "F.Cu", 0.25, (120.05, 120.0), (120.05, 105.0)),
    ]
    vias = [("GND", 125.95, 113.5, 0.8, 0.4)]
    zones = [("GND", "B.Cu", (120.0, 111.0, 148.0, 128.0))]
    write(folder / "defects.kicad_pcb", board_text(footprints, segments, vias, zones, (100.0, 100.0, 150.0, 130.0)))
    power = {
        "bus_width": 12, "clearance": 1.0, "diff_pair_gap": 0.25, "diff_pair_via_gap": 0.25, "diff_pair_width": 0.2,
        "line_style": 0, "microvia_diameter": 0.3, "microvia_drill": 0.1, "name": "Power", "pcb_color": "rgba(0, 0, 0, 0.000)",
        "priority": 0, "schematic_color": "rgba(0, 0, 0, 0.000)", "track_width": 0.5, "tuning_profile": "",
        "via_diameter": 0.8, "via_drill": 0.4, "wire_width": 6,
    }
    write(folder / "defects.kicad_pro", project_file("defects", [power], [{"netclass": "Power", "pattern": "VIN"}]))
    clean = [("R_0805", "1k", "R1", 110.0, 105.0, {"1": "A", "2": "B"})]
    write(folder / "clean.kicad_pcb", board_text(clean, [], [], [], (100.0, 100.0, 120.0, 110.0)))
    footprint_library(folder)
    lib_tables(folder, symbols=False, footprints=True)


def footprint_library(folder: Path) -> None:
    for name in FOOTPRINTS:
        write(folder / "fixture.pretty" / f"{name}.kicad_mod", sx(fp_text(name, "", "", 0, 0, None, False)) + "\n")


if __name__ == "__main__":
    make_hier()
    make_erc()
    make_board()
    print("fixtures written")

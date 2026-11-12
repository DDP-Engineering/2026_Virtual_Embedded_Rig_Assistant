"""Board facts from the native `.kicad_pcb`, KiCad's statistics and the project's net classes (spec §6.1).

Dimensions and counts come from `kicad-cli pcb export stats`; layers, stackup, footprints, tracks, vias and zones
are read from the board file. Unconnected nets are left to DRC.
"""

from __future__ import annotations

import math
import re
from typing import Any

from . import sexpr

_MEASURE = re.compile(r"^\s*(-?[\d.]+)")


def _measure(text: Any) -> float | None:
    found = _MEASURE.match(str(text)) if text is not None else None
    return float(found.group(1)) if found else None


def _round(value: float) -> float:
    return round(value, 4)


def _arc_length(start: tuple[float, float], mid: tuple[float, float], end: tuple[float, float]) -> float:
    (ax, ay), (bx, by), (cx, cy) = start, mid, end
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:
        return math.dist(start, end)
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    radius = math.dist((ux, uy), start)
    angle = lambda p: math.atan2(p[1] - uy, p[0] - ux)  # noqa: E731
    sweep = (angle(end) - angle(start)) % (2 * math.pi)
    through = (angle(mid) - angle(start)) % (2 * math.pi)
    if through > sweep:  # The arc runs the other way round.
        sweep = 2 * math.pi - sweep
    return radius * sweep


def _point(node: list[Any] | None) -> tuple[float, float] | None:
    if node is None or len(node) < 3:
        return None
    x, y = sexpr.number(node[1]), sexpr.number(node[2])
    return (x, y) if x is not None and y is not None else None


def layers(tree: list[Any]) -> list[dict[str, Any]]:
    holder = sexpr.child(tree, "layers")
    found = []
    for item in holder[1:] if holder is not None else []:
        if isinstance(item, list) and len(item) >= 3:
            entry: dict[str, Any] = {"ordinal": sexpr.integer(item[0]), "name": str(item[1]), "type": str(item[2])}
            if len(item) > 3 and not isinstance(item[3], list):
                entry["userName"] = str(item[3])
            found.append(entry)
    return found


def layer_names(tree: list[Any]) -> set[str]:
    return {layer["name"] for layer in layers(tree)}


def stackup(tree: list[Any]) -> dict[str, Any]:
    setup = sexpr.child(tree, "setup")
    holder = sexpr.child(setup, "stackup") if setup is not None else None
    if holder is None:
        return {"available": False, "layers": []}
    entries = []
    for layer in sexpr.children(holder, "layer"):
        entry: dict[str, Any] = {"name": str(layer[1]), "type": str(sexpr.value(layer, "type", ""))}
        for key, name in (("thickness", "thickness"), ("epsilon_r", "epsilonR"), ("loss_tangent", "lossTangent")):
            number = sexpr.number(sexpr.value(layer, key))
            if number is not None:
                entry[name] = number
        material = sexpr.value(layer, "material")
        if material is not None:
            entry["material"] = str(material)
        entries.append(entry)
    return {"available": True, "layers": entries}


def footprints(tree: list[Any]) -> list[dict[str, Any]]:
    found = []
    for footprint in sexpr.children(tree, "footprint"):
        at = sexpr.child(footprint, "at")
        attr = sexpr.child(footprint, "attr")
        flags = [str(token) for token in attr[1:]] if attr is not None else []
        found.append(
            {
                "reference": sexpr.prop(footprint, "Reference") or "",
                "value": sexpr.prop(footprint, "Value") or "",
                "libId": str(footprint[1]) if len(footprint) > 1 and not isinstance(footprint[1], list) else "",
                "layer": str(sexpr.value(footprint, "layer", "")),
                "x": sexpr.number(at[1], 0.0) if at is not None and len(at) > 1 else 0.0,
                "y": sexpr.number(at[2], 0.0) if at is not None and len(at) > 2 else 0.0,
                "rotation": sexpr.number(at[3], 0.0) if at is not None and len(at) > 3 else 0.0,
                "attributes": flags,
                "excludeFromPos": "exclude_from_pos_files" in flags,
                "excludeFromBom": "exclude_from_bom" in flags,
                "dnp": "dnp" in flags,
            }
        )
    return found


def holes(tree: list[Any]) -> dict[str, int]:
    """Drilled holes of the board: plated (through-hole pads and vias) and non-plated pads."""
    plated = nonplated = 0
    for footprint in sexpr.children(tree, "footprint"):
        for pad in sexpr.children(footprint, "pad"):
            if sexpr.child(pad, "drill") is None or len(pad) < 3:
                continue
            if str(pad[2]) == "thru_hole":
                plated += 1
            elif str(pad[2]) == "np_thru_hole":
                nonplated += 1
    plated += len(sexpr.children(tree, "via"))
    return {"plated": plated, "nonPlated": nonplated}


def tracks(tree: list[Any]) -> list[dict[str, Any]]:
    nets: dict[str, dict[str, Any]] = {}
    for kind in ("segment", "arc"):
        for item in sexpr.children(tree, kind):
            net = str(sexpr.value(item, "net", ""))
            start, end = _point(sexpr.child(item, "start")), _point(sexpr.child(item, "end"))
            if start is None or end is None:
                continue
            mid = _point(sexpr.child(item, "mid")) if kind == "arc" else None
            length = _arc_length(start, mid, end) if mid is not None else math.dist(start, end)
            entry = nets.setdefault(net, {"net": net, "segments": 0, "length": 0.0, "widths": set(), "layers": set()})
            entry["segments"] += 1
            entry["length"] += length
            width = sexpr.number(sexpr.value(item, "width"))
            if width is not None:
                entry["widths"].add(width)
            entry["layers"].add(str(sexpr.value(item, "layer", "")))
    return [
        {**entry, "length": _round(entry["length"]), "widths": sorted(entry["widths"]), "layers": sorted(entry["layers"])}
        for entry in nets.values()
    ]


def vias(tree: list[Any]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, float, float], int] = {}
    for via in sexpr.children(tree, "via"):
        key = (str(sexpr.value(via, "net", "")), sexpr.number(sexpr.value(via, "size"), 0.0) or 0.0, sexpr.number(sexpr.value(via, "drill"), 0.0) or 0.0)
        groups[key] = groups.get(key, 0) + 1
    return [{"net": net, "size": size, "drill": drill, "count": count} for (net, size, drill), count in groups.items()]


def zones(tree: list[Any]) -> list[dict[str, Any]]:
    found = []
    for zone in sexpr.children(tree, "zone"):
        single = sexpr.value(zone, "layer")
        many = sexpr.child(zone, "layers")
        names = [str(single)] if single is not None else [str(token) for token in many[1:]] if many is not None else []
        found.append({"net": str(sexpr.value(zone, "net", "")), "layers": names})
    return found


def net_classes(settings: dict[str, Any] | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    net = (settings or {}).get("net_settings")
    if not isinstance(net, dict):
        return [], []
    keys = (("clearance", "clearance"), ("track_width", "trackWidth"), ("via_diameter", "viaDiameter"), ("via_drill", "viaDrill"), ("diff_pair_width", "diffPairWidth"), ("diff_pair_gap", "diffPairGap"))
    def finite(value: Any) -> bool:
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return False
        try:
            return math.isfinite(float(value))
        except OverflowError:
            return False

    raw = net.get("classes")
    classes = []
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, dict):
            named = item.get("name") if isinstance(item.get("name"), str) else None
            classes.append({"name": named, **{name: item[key] for key, name in keys if finite(item.get(key))}})
    raw = net.get("netclass_patterns")
    patterns = [
        {"netclass": str(item.get("netclass")), "pattern": str(item.get("pattern"))}
        for item in (raw if isinstance(raw, list) else [])
        if isinstance(item, dict)
    ]
    return classes, patterns


def dimensions(stats: dict[str, Any]) -> dict[str, Any]:
    raw = stats.get("board")
    board: dict[str, Any] = raw if isinstance(raw, dict) else {}
    keys = (("width", "width"), ("height", "height"), ("area", "area"), ("board_thickness", "thickness"), ("min_track_width", "minTrackWidth"), ("min_track_clearance", "minTrackClearance"), ("min_drill_diameter", "minDrill"))
    found: dict[str, Any] = {"hasOutline": bool(board.get("has_outline"))}
    for key, name in keys:
        found[name] = _measure(board.get(key))
    return found


def facts(tree: list[Any], stats: dict[str, Any], settings: dict[str, Any] | None) -> dict[str, Any]:
    classes, patterns = net_classes(settings)
    return {
        "layers": layers(tree),
        "stackup": stackup(tree),
        "dimensions": dimensions(stats),
        "counts": {key: stats.get(key) for key in ("pads", "vias", "components") if key in stats},
        "footprints": footprints(tree),
        "tracks": tracks(tree),
        "vias": vias(tree),
        "zones": zones(tree),
        "netClasses": classes,
        "netClassPatterns": patterns,
        "unconnected": "not-evaluated",
    }

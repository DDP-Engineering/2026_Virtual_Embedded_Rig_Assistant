"""Board work through the API (spec REQ-DATA-891d5b5d §5, §7): the inventory, the checks of a request against the
live board (footprints, locked items, nets, layers), its execution in one commit, the outline check from KiCad's
bounding boxes and the check that nothing but the named and created items changed."""

from __future__ import annotations

import math
from typing import Any, Callable

from kipy.board import Board
from kipy.board_types import Net, Track, Via, Zone
from kipy.geometry import Angle, PolygonWithHoles, PolyLine, PolyLineNode, Vector2
from kipy.proto.board.board_types_pb2 import BoardLayer, ZoneType
from kipy.util.board_layer import canonical_name, is_copper_layer

from .kicad import Api
from .request import Problem, Refused, fail, refuse

NM = 1_000_000


def nm(mm: float) -> int:
    return round(mm * NM)


def mm(value: int) -> float:
    return round(value / NM, 6)


def _xy(vector: Any) -> list[float]:
    return [mm(vector.x), mm(vector.y)]


def _degrees(angle: Any) -> float:
    value = round(angle.degrees % 360.0, 6)
    return 0.0 if value == 360.0 else value


def _box(box: Any) -> list[float]:
    x, y, w, h = box.pos.x, box.pos.y, box.size.x, box.size.y
    return [mm(min(x, x + w)), mm(min(y, y + h)), mm(max(x, x + w)), mm(max(y, y + h))]


def _reference(footprint: Any) -> str:
    return footprint.reference_field.text.value


def outline(api: Api, board: Board) -> list[float] | None:
    """The bounding box of the Edge.Cuts items, without their stroke width; None for a board without outline."""
    shapes = [shape for shape in api.call(board.get_shapes) if shape.layer == BoardLayer.BL_Edge_Cuts]
    if not shapes:
        return None
    boxes = api.call(board.get_item_bounding_box, shapes)
    edges: list[list[float]] = []
    for shape, box in zip(shapes, boxes):
        half = 0.0
        try:
            half = mm(shape.attributes.stroke.width) / 2
        except (AttributeError, ValueError):
            pass
        x1, y1, x2, y2 = _box(box)
        edges.append([round(x1 + half, 6), round(y1 + half, 6), round(x2 - half, 6), round(y2 - half, 6)])
    return [min(e[0] for e in edges), min(e[1] for e in edges), max(e[2] for e in edges), max(e[3] for e in edges)]


def copper_layers(api: Api, board: Board) -> dict[str, int]:
    return {canonical_name(layer): layer for layer in api.call(board.get_enabled_layers) if is_copper_layer(layer)}


def inventory(api: Api, board: Board) -> dict[str, Any]:
    """board.json (spec §5): what the agent composes requests from, read from KiCad."""
    footprints = api.call(board.get_footprints)
    pads: dict[str, list[dict[str, Any]]] = {}
    for pad in api.call(board.get_pads):
        parent = pad.parent.value if pad.parent is not None else ""
        pads.setdefault(parent, []).append({"number": pad.number, "net": pad.net.name, "at": _xy(pad.position)})
    tracks = api.call(board.get_tracks)
    vias = api.call(board.get_vias)
    routing: dict[str, dict[str, float]] = {}
    for track in tracks:
        entry = routing.setdefault(track.net.name, {"trackLength": 0.0, "vias": 0})
        length = math.dist((track.start.x, track.start.y), (track.end.x, track.end.y)) / NM
        entry["trackLength"] = round(entry["trackLength"] + length, 6)
    for via in vias:
        routing.setdefault(via.net.name, {"trackLength": 0.0, "vias": 0})["vias"] += 1
    return {
        "footprints": sorted(
            (
                {
                    "reference": _reference(fp),
                    "uuid": fp.id.value,
                    "value": fp.value_field.text.value,
                    "library": str(fp.definition.id),
                    "at": _xy(fp.position),
                    "orientation": _degrees(fp.orientation),
                    "side": "front" if fp.layer == BoardLayer.BL_F_Cu else "back",
                    "locked": bool(fp.locked),
                    "pads": sorted(pads.get(fp.id.value, []), key=lambda p: p["number"]),
                }
                for fp in footprints
            ),
            key=lambda f: (f["reference"], f["uuid"]),
        ),
        "nets": sorted(net.name for net in api.call(board.get_nets) if net.name),
        "copperLayers": list(copper_layers(api, board)),
        "outline": outline(api, board),
        "tracks": len(tracks),
        "vias": len(vias),
        "zones": len(api.call(board.get_zones)),
        "routing": dict(sorted(routing.items())),
    }


def snapshot(api: Api, board: Board) -> dict[str, Any]:
    """Every item the unchanged check compares, by UUID."""
    def points(zone: Any) -> tuple:
        try:
            return tuple((node.point.x, node.point.y) for node in zone.outline.outline.nodes if node.has_point)
        except AttributeError:
            return ()
    footprints = api.call(board.get_footprints)
    tracks = api.call(board.get_tracks)
    vias = api.call(board.get_vias)
    zones = api.call(board.get_zones)
    return {
        "footprints": {fp.id.value: (fp.position.x, fp.position.y, round(fp.orientation.degrees * 1000) % 360000, int(fp.locked), fp.layer)
                       for fp in footprints},
        "tracks": {t.id.value: (t.start.x, t.start.y, t.end.x, t.end.y, t.width, t.layer, t.net.name, int(t.locked))
                   for t in tracks},
        "vias": {v.id.value: (v.position.x, v.position.y, v.net.name, int(v.locked)) for v in vias},
        "zones": {z.id.value: (z.type, tuple(z.layers), points(z)) for z in zones},
        "nets": sorted(net.name for net in api.call(board.get_nets)),
        # Items by count as well as by UUID: a duplicated item shares its original's UUID.
        "counts": {"footprints": len(footprints), "tracks": len(tracks), "vias": len(vias), "zones": len(zones)},
    }


class Resolved:
    """The live items a request names, checked (spec §7)."""

    def __init__(self, api: Api, board: Board, operations: list[dict[str, Any]]):
        self.api, self.board, self.operations = api, board, operations
        footprints = api.call(board.get_footprints)
        by_reference: dict[str, list[Any]] = {}
        for fp in footprints:
            by_reference.setdefault(_reference(fp), []).append(fp)
        nets = {net.name: net for net in api.call(board.get_nets) if net.name}
        layers = copper_layers(api, board)
        problems: list[Problem] = []
        self.footprints: dict[str, Any] = {}
        self.nets, self.layers = nets, layers
        # The net each created track or via was asked for, and its operation, by UUID (see check_nets).
        self.requested_nets: dict[str, str] = {}
        self.created_by: dict[str, int] = {}
        for op in operations:
            where = f"operations[{op['index']}]"
            references = [op["footprint"]] if op["op"] == "place" else op.get("footprints", [])
            for ref in references:
                found = by_reference.get(ref, [])
                if len(found) != 1:
                    problems.append(Problem("footprint", where, f"{where}: footprint {ref} {'does not exist' if not found else 'is ambiguous (the reference is used more than once)'} on the board."))
                    continue
                fp = found[0]
                if op["op"] == "place" and "uuid" in op and op["uuid"] != fp.id.value.lower():
                    problems.append(Problem("footprint", where, f"{where}: the uuid is not {ref}'s ({fp.id.value})."))
                    continue
                if fp.locked:
                    problems.append(Problem("locked", where, f"{where}: footprint {ref} is locked; unlock it in KiCad if it may move."))
                    continue
                self.footprints[ref] = fp
            if op["op"] in ("track", "via") and op["net"] not in nets:
                problems.append(Problem("net", where, f"{where}: the board has no net {op['net']}."))
            for name in ([op["layer"]] if op["op"] == "track" else op.get("layers", []) if op["op"] == "keepout" else []):
                if name not in layers:
                    problems.append(Problem("layer", where, f"{where}: {name} is not an enabled copper layer ({', '.join(layers)})."))
        if problems:
            raise Refused(problems)

    def execute(self, hook: Callable[[str], None]) -> tuple[list[str], list[Any]]:
        """Runs the operations in one commit; returns the placed footprints' references and the created items."""
        api, board = self.api, self.board
        commit = api.call(board.begin_commit)
        try:
            hook("in-commit")
            placed: list[str] = []
            created: list[Any] = []
            for op in self.operations:
                kind = op["op"]
                if kind == "place":
                    fp = self.footprints[op["footprint"]]
                    if op.get("at") is not None:
                        fp.position = Vector2.from_xy(nm(op["at"][0]), nm(op["at"][1]))
                    if "orientation" in op:
                        fp.orientation = Angle.from_degrees(op["orientation"])
                    self.footprints[op["footprint"]] = api.call(board.update_items, [fp])[0]
                    placed.append(op["footprint"])
                elif kind == "align":
                    first = self.footprints[op["footprints"][0]]
                    start = (first.position.x, first.position.y)
                    moved = []
                    for index, ref in enumerate(op["footprints"]):
                        fp = self.footprints[ref]
                        x, y = fp.position.x, fp.position.y
                        if op["axis"] == "y":
                            y = nm(op["value"])
                            if op.get("pitch"):
                                x = start[0] + nm(op["pitch"]) * index
                        else:
                            x = nm(op["value"])
                            if op.get("pitch"):
                                y = start[1] + nm(op["pitch"]) * index
                        fp.position = Vector2.from_xy(x, y)
                        moved.append(fp)
                    for fp in api.call(board.update_items, moved):
                        self.footprints[_reference(fp)] = fp
                    placed.extend(op["footprints"])
                elif kind == "keepout":
                    zone = Zone()
                    zone.type = ZoneType.ZT_RULE_AREA
                    zone.name = "kicad-layout keepout"
                    zone.layers = [self.layers[name] for name in op["layers"]]
                    line = PolyLine()
                    for x, y in op["polygon"]:
                        line.append(PolyLineNode.from_xy(nm(x), nm(y)))
                    line.closed = True
                    polygon = PolygonWithHoles()
                    polygon.outline = line
                    zone.outline = polygon
                    settings = zone.proto.rule_area_settings
                    settings.keepout_tracks = "tracks" in op["forbid"]
                    settings.keepout_vias = "vias" in op["forbid"]
                    settings.keepout_pads = "pads" in op["forbid"]
                    settings.keepout_footprints = "footprints" in op["forbid"]
                    settings.keepout_copper = "zones" in op["forbid"]
                    created += api.call(board.create_items, [zone])
                elif kind == "track":
                    segments = []
                    for (x1, y1), (x2, y2) in zip(op["points"], op["points"][1:]):
                        track = Track()
                        track.start = Vector2.from_xy(nm(x1), nm(y1))
                        track.end = Vector2.from_xy(nm(x2), nm(y2))
                        track.width = nm(op["width"])
                        track.layer = self.layers[op["layer"]]
                        track.net = self.nets[op["net"]]
                        segments.append(track)
                    made = api.call(board.create_items, segments)
                    self.requested_nets.update({item.id.value: op["net"] for item in made})
                    self.created_by.update({item.id.value: op["index"] for item in made})
                    created += made
                elif kind == "via":
                    via = Via()
                    via.position = Vector2.from_xy(nm(op["at"][0]), nm(op["at"][1]))
                    via.net = self.nets[op["net"]]
                    via.diameter = nm(op["diameter"])
                    via.drill_diameter = nm(op["drill"])
                    made = api.call(board.create_items, [via])
                    self.requested_nets.update({item.id.value: op["net"] for item in made})
                    self.created_by.update({item.id.value: op["index"] for item in made})
                    created += made
                hook("after-operation")
        except BaseException:
            try:
                api.call(board.drop_commit, commit)
            except Exception:  # noqa: BLE001 - the original failure is the one to report
                pass
            raise
        api.call(board.push_commit, commit, "kicad-layout-tool edit")
        return placed, created


def check_outline(api: Api, board: Board, limits: list[float] | None, placed: list[Any], created: list[Any]) -> None:
    """Refused (outline) when KiCad's bounding box of a placed footprint or created item leaves the outline's box."""
    if limits is None:
        return
    items = placed + created
    if not items:
        return
    epsilon = 0.000001
    for item, box in zip(items, api.call(board.get_item_bounding_box, items)):
        x1, y1, x2, y2 = _box(box)
        if x1 < limits[0] - epsilon or y1 < limits[1] - epsilon or x2 > limits[2] + epsilon or y2 > limits[3] + epsilon:
            label = _reference(item) if hasattr(item, "reference_field") else type(item).__name__.lower()
            raise refuse("outline", "operations", f"{label} would extend beyond the board outline ({limits[0]:g}, {limits[1]:g}) - ({limits[2]:g}, {limits[3]:g}) mm: [{x1:g}, {y1:g}, {x2:g}, {y2:g}].")


def check_nets(after: dict[str, Any], requested: dict[str, str], created_by: dict[str, int]) -> None:
    """Refused (net) when KiCad gave a created track or via another net than requested: KiCad connects new copper
    to the copper it touches, so a track across another net's copper takes that net (a short, spec §7)."""
    for uuid, net in requested.items():
        item = after["tracks"].get(uuid) or after["vias"].get(uuid)
        actual = None if item is None else item[6] if uuid in after["tracks"] else item[2]
        if actual != net:
            where = f"operations[{created_by.get(uuid, 0)}]"
            if item is None:
                raise fail("kicad", where, f"{where}: a created track or via is missing after the commit.")
            if uuid in after["tracks"]:
                x1, y1, x2, y2 = (value / NM for value in item[:4])
                what = f"the new track from ({x1:g}, {y1:g}) to ({x2:g}, {y2:g}) mm"
            elif item is not None:
                what = f"the new via at ({item[0] / NM:g}, {item[1] / NM:g}) mm"
            else:
                what = "a new item"
            raise refuse("net", where, f"{where}: KiCad connected {what} to net {actual or 'none'} instead of {net}: it "
                                       f"touches copper of {actual or 'another net'} (a short). Route it clear of other nets' copper.")


def check_unchanged(before: dict[str, Any], after: dict[str, Any], placed: set[str], created: set[str]) -> dict[str, int]:
    """Counts of items verified unchanged; Failed (kicad) when anything else changed (spec §7)."""
    differences: list[str] = []
    counts: dict[str, int] = {}
    for kind in ("footprints", "tracks", "vias", "zones"):
        old, new = before[kind], after[kind]
        unchanged = 0
        for key, value in old.items():
            if key in placed:
                continue
            if new.get(key) != value:
                differences.append(f"{kind[:-1]} {key}")
            else:
                unchanged += 1
        differences += [f"new {kind[:-1]} {key}" for key in new.keys() - old.keys() if key not in created]
        if after["counts"][kind] - len(new) != before["counts"][kind] - len(old):
            differences.append(f"a duplicated {kind[:-1]}")
        added = sum(1 for key in created if key in new)
        if after["counts"][kind] != before["counts"][kind] + added:
            differences.append(f"the number of {kind}")
        counts[kind] = unchanged
    if before["nets"] != after["nets"]:
        differences.append("the net list")
    if differences:
        raise fail("kicad", "kicad", f"Items the request did not name changed during the edit ({', '.join(differences[:5])}); the candidate was reloaded from its last save and nothing was saved.")
    return counts


def created_items(items: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in items:
        if isinstance(item, Track):
            length = math.dist((item.start.x, item.start.y), (item.end.x, item.end.y)) / NM
            out.append({"type": "track", "uuid": item.id.value, "net": item.net.name, "layer": canonical_name(item.layer),
                        "width": mm(item.width), "length": round(length, 6), "start": _xy(item.start), "end": _xy(item.end)})
        elif isinstance(item, Via):
            out.append({"type": "via", "uuid": item.id.value, "net": item.net.name, "at": _xy(item.position),
                        "diameter": mm(item.diameter), "drill": mm(item.drill_diameter)})
        elif isinstance(item, Zone):
            out.append({"type": "keepout", "uuid": item.id.value, "layers": [canonical_name(layer) for layer in item.layers]})
    return out


def id_of(item: Any) -> str:
    return item.id.value


__all__ = ["Net", "Resolved", "check_nets", "check_outline", "check_unchanged", "created_items", "id_of", "inventory", "outline", "snapshot"]

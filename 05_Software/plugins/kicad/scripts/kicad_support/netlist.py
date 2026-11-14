"""KiCad's netlist (kicadsexpr) as instances, components and nets (spec REQ-DATA-c32834e3 §6.1, §6.2).

Connectivity comes from KiCad itself: the helper never derives a net from schematic geometry. A placed symbol unit
is identified by its sheet's UUID path followed by the symbol UUID; in a repeated sheet the reference alone does
not identify it.
"""

from __future__ import annotations

from typing import Any

from . import sexpr

MPN_FIELDS = ("mpn", "manufacturer part number", "manufacturer_part_number", "mfr pn", "mfr. no")


def _flags(component: list[Any]) -> dict[str, bool]:
    names = {str(sexpr.value(prop, "name", "")) for prop in sexpr.children(component, "property")}
    return {"dnp": "dnp" in names, "excludeFromBom": "exclude_from_bom" in names, "excludeFromBoard": "exclude_from_board" in names}


def _fields(component: list[Any]) -> dict[str, str]:
    fields: dict[str, str] = {}
    holder = sexpr.child(component, "fields")
    for item in sexpr.children(holder, "field") if holder is not None else []:
        name = str(sexpr.value(item, "name", ""))
        text = next((str(token) for token in item[1:] if not isinstance(token, list)), "")
        if name:
            fields[name] = text
    return fields


def _mpn(fields: dict[str, str]) -> str | None:
    for wanted in MPN_FIELDS:
        for name, text in fields.items():
            if name.casefold() == wanted and text.strip():
                return text.strip()
    return None


def read(tree: list[Any]) -> dict[str, Any]:
    """`instances`, `components` (by reference) and `nets` of a parsed netlist."""
    instances: list[dict[str, Any]] = []
    components: list[dict[str, Any]] = []
    holder = sexpr.child(tree, "components")
    for component in sexpr.children(holder, "comp") if holder is not None else []:
        reference = str(sexpr.value(component, "ref", ""))
        source = sexpr.child(component, "libsource")
        lib_id = f"{sexpr.value(source, 'lib', '')}:{sexpr.value(source, 'part', '')}" if source is not None else ""
        sheet = sexpr.child(component, "sheetpath")
        sheet_names = str(sexpr.value(sheet, "names", "/"))
        sheet_uuids = str(sexpr.value(sheet, "tstamps", "/"))
        stamps = sexpr.child(component, "tstamps")
        symbols = [str(token) for token in stamps[1:]] if stamps is not None else []
        fields = _fields(component)
        common = {
            "reference": reference,
            "value": str(sexpr.value(component, "value", "")),
            "footprint": str(sexpr.value(component, "footprint", "")),
            "libId": lib_id,
            "sheetPath": sheet_names,
            "fields": fields,
            "mpn": _mpn(fields),
            **_flags(component),
        }
        own = [{"uuidPath": f"{sheet_uuids}{symbol}", **common} for symbol in symbols]
        instances += own
        components.append({**common, "instances": [item["uuidPath"] for item in own]})
    nets: list[dict[str, Any]] = []
    holder = sexpr.child(tree, "nets")
    for net in sexpr.children(holder, "net") if holder is not None else []:
        nodes = []
        for node in sexpr.children(net, "node"):
            item: dict[str, str | None] = {"reference": str(sexpr.value(node, "ref", "")), "pin": str(sexpr.value(node, "pin", ""))}
            function = sexpr.value(node, "pinfunction")
            item["pinFunction"] = str(function) if function is not None else None
            kind = sexpr.value(node, "pintype")
            item["pinType"] = str(kind) if kind is not None else None
            nodes.append(item)
        nets.append(
            {
                "code": sexpr.integer(sexpr.value(net, "code")),
                "name": str(sexpr.value(net, "name", "")),
                "class": str(sexpr.value(net, "class", "")),
                "nodes": nodes,
            }
        )
    return {"instances": instances, "components": components, "nets": nets}

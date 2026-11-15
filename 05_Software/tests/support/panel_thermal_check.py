"""Independent reference for the panel-engineering thermal tests (REQ-TEST-265439fc).

Recomputes, without VERA code, the dissipation and the mean enclosure air temperature of the scenarios of
tests/fixtures/panel-engineering/pnl-plant-m.json from the fixture files, by the enclosure heat balance of the
Schneider Electric enclosure catalogue, Thermal management system, p. 8/110 (S after IEC 890, Ti = P / (K S) + Te),
and checks the catalogue's own worked example. The vitest suites hold the printed values with a 0.5 % tolerance.

Run from 05_Software:  python -I tests/support/panel_thermal_check.py
"""

import json
import pathlib

FIXTURES = pathlib.Path(__file__).resolve().parents[1] / "fixtures"


def load(path):
    return json.loads((FIXTURES / path).read_text(encoding="utf-8"))


def param(item, name, **conditions):
    """Confirmed values of `name` whose text conditions agree with the given ones."""
    found = []
    for p in item["parameters"]:
        if p["name"] != name or p["status"] != "confirmed":
            continue
        cond = p.get("conditions", {})
        if all(k not in cond or cond[k].get("text") == v for k, v in conditions.items()):
            found.append(p["value"])
    return found


def main():
    # The catalogue's example: NSYSF20840 (H 2000, W 800, D 400 mm) against a wall, 800 W, K 5.5.
    h, w, d = 2.0, 0.8, 0.4
    s_example = 1.4 * w * (h + d) + 1.8 * d * h
    print(f"example S = {s_example:.4f} m2, rise = {800 / (5.5 * s_example):.4f} K")

    catalogs = {c["id"]: c for c in (load("panel-engineering/cat-panel.json"), load("motor-drives/cat-motor-drives.json"))}
    items = {(cid, i["id"]): i for cid, c in catalogs.items() for i in c["items"]}
    panel = load("panel-engineering/pnl-plant-m.json")
    enclosure = items[(panel["enclosure"]["item"]["catalog"], panel["enclosure"]["item"]["item"])]
    hh, ww, dd = (param(enclosure, n)[0] / 1000 for n in ("height", "width", "depth"))
    assert panel["enclosure"]["installation"] == "wall"
    s = 1.4 * ww * (hh + dd) + 1.8 * dd * hh
    k = panel["thermal"]["heatTransferCoefficient"]["value"]
    te = panel["thermal"]["ambientTemperatureMax"]["value"]
    wiring = panel["thermal"]["wiringLoss"]["value"]
    print(f"fixture S = {s:.6f} m2")

    by_tag = {e["tag"]: e for e in panel["equipment"]}
    for scenario in panel["scenarios"]:
        active = scenario.get("active")
        if active is None:
            continue  # the full scenario holds devices without stated losses
        total = wiring
        for tag in active:
            e = by_tag[tag]
            item = items[(e["item"]["catalog"], e["item"]["item"])] if e["item"] else None
            consumers = [c for c in panel["equipment"] if c.get("supply") == tag and c["tag"] in active]
            if consumers:  # a supply: output power x (1 / efficiency - 1)
                out = sum(
                    max(param(items[(c["item"]["catalog"], c["item"]["item"])], "powerConsumption", expansion="none"))
                    for c in consumers
                )
                eta = min(param(item, "efficiency")) / 100
                total += out * (1 / eta - 1)
                continue
            if e.get("declared", {}).get("powerLoss"):
                total += e["declared"]["powerLoss"]["value"]
                continue
            if e.get("supply"):
                total += max(param(item, "powerConsumption", expansion="none"))
                continue
            assert item is not None
            per_pole = param(item, "powerLossPerPole", utilisationCategory="AC-3")
            poles = int(item["attributes"]["poles"].rstrip("P"))
            total += max(per_pole) * poles + sum(param(item, "coilPowerLoss")[:1])
        rise = total / (k * s)
        print(f"{scenario['tag']}: P = {total:.6f} W, rise = {rise:.6f} K, Ti = {te + rise:.6f} degC")


if __name__ == "__main__":
    main()

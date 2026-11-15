"""Independent fault-current references for the electrical-network tests (REQ-TEST-e3eb9076).

Builds a pandapower network from a plain JSON description (not from VERA's model) and prints the IEC 60909
fault currents pandapower computes. Run it with a Python that has pandapower 3.1.2 installed, outside the
repository (scratch or uv environment):

    python -I pandapower_network_check.py network.json

Input: {"un": V, "tolerance": 6|10, "transformer": {"sn": VA, "uk": %, "pk": W, "hv": V, "skMax": VA,
"skMin": VA, "rx": R/X} | "supply": absent here, "lines": [{"name", "from", "to", "length": m, "r": ohm/km,
"x": ohm/km, "rPe": ohm/km, "endTemp": degC}]}; the transformer's LV bus is "origin".
Output: {"pandapower": version, "buses": {name: {"ik3Max", "ip", "ik3Min", "ik1Min"}}} in kA.
"""

import json
import sys

import pandapower as pp
import pandapower.shortcircuit as sc


def build(spec):
    net = pp.create_empty_network(sn_mva=1.0)
    t = spec["transformer"]
    hv = pp.create_bus(net, vn_kv=t["hv"] / 1000, name="hv")
    buses = {"origin": pp.create_bus(net, vn_kv=spec["un"] / 1000, name="origin")}
    pp.create_ext_grid(
        net, hv, s_sc_max_mva=t["skMax"] / 1e6, s_sc_min_mva=t["skMin"] / 1e6, rx_max=t["rx"], rx_min=t["rx"],
        x0x_max=1.0, r0x0_max=t["rx"], x0x_min=1.0, r0x0_min=t["rx"],
    )
    vkr = t["pk"] / t["sn"] * 100
    pp.create_transformer_from_parameters(
        net, hv, buses["origin"], sn_mva=t["sn"] / 1e6, vn_hv_kv=t["hv"] / 1000, vn_lv_kv=spec["un"] / 1000,
        vk_percent=t["uk"], vkr_percent=vkr, pfe_kw=0.0, i0_percent=0.0, vector_group="Dyn",
        vk0_percent=t["uk"], vkr0_percent=vkr, mag0_percent=1e6, mag0_rx=0.0, si0_hv_partial=0.9,
    )
    for line in spec["lines"]:
        buses.setdefault(line["to"], pp.create_bus(net, vn_kv=spec["un"] / 1000, name=line["to"]))
        pp.create_line_from_parameters(
            net, buses[line["from"]], buses[line["to"]], length_km=line["length"] / 1000,
            r_ohm_per_km=line["r"], x_ohm_per_km=line["x"], c_nf_per_km=0.0, max_i_ka=1.0,
            r0_ohm_per_km=line["r"] + 3 * line["rPe"], x0_ohm_per_km=4 * line["x"], c0_nf_per_km=0.0,
            endtemp_degree=line["endTemp"], name=line["name"],
        )
    return net, buses


def main(path):
    with open(path, encoding="utf-8") as handle:
        spec = json.load(handle)
    net, buses = build(spec)
    tolerance = spec["tolerance"]
    out = {name: {} for name in buses}
    runs = [("max", "3ph", "ik3Max"), ("min", "3ph", "ik3Min"), ("min", "1ph", "ik1Min")]
    for case, fault, key in runs:
        sc.calc_sc(net, case=case, fault=fault, lv_tol_percent=tolerance, ip=case == "max", topology="radial")
        for name, bus in buses.items():
            out[name][key] = float(net.res_bus_sc.at[bus, "ikss_ka"])
            if case == "max":
                out[name]["ip"] = float(net.res_bus_sc.at[bus, "ip_ka"])
    print(json.dumps({"pandapower": pp.__version__, "buses": out}, indent=1, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv[1])

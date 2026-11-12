"""Operation `thermal` (spec REQ-DATA-3d15fdfc §5.5).

thetaJA describes the whole junction-to-ambient path on the board of its characterization. It is never added to a
junction-to-case path: the two are different descriptions of the same heat flow, not resistances in series.
"""

from __future__ import annotations

import math

from .contract import Reader, Result, shown

CASE_PATH_KEYS = ("thetaJC", "thetaCS", "thetaSA", "thetaCA")
STEADY = "Steady state with one heat source; no heat spreading to or from neighbouring parts."
SLACK = 1e-12  # Relative rounding allowance of the limit checks, as in the other models.


def _junction_limit(result: Result, junction: float, maximum: float | None) -> None:
    if maximum is None:
        result.check("junction-limit", "not-evaluated", "No maximum junction temperature was given.")
        return
    margin = maximum - junction
    if abs(margin) <= SLACK * max(abs(maximum), abs(junction)):
        margin = 0.0  # Rounding noise of a junction exactly at its limit.
    result.add("junctionMargin", margin, "temperature-difference")
    passed = margin >= 0
    result.check(
        "junction-limit",
        "pass" if passed else "fail",
        f"The junction temperature is {'at or below' if passed else 'above'} the given maximum.",
    )


def junction_ambient(reader: Reader, result: Result) -> None:
    for key in CASE_PATH_KEYS:
        if reader.has(key):
            reader.fail(
                "contradiction",
                key,
                "thetaJA already contains the junction-to-case path and the board; do not add case or heatsink "
                "resistances to it. Use model junction-case-sink for a case path.",
            )
    power = reader.value("power", "power")
    ambient = reader.value("tAmbient", "temperature", role="absolute")
    theta = reader.quantity("thetaJA", "thermal-resistance", sign="positive")
    maximum = reader.value("tJunctionMax", "temperature", required=False, role="absolute")
    reader.done()
    assert power is not None and ambient is not None and theta is not None
    rise = power * theta.si
    junction = ambient + rise
    result.add("tJunction", junction, "temperature")
    result.add("temperatureRise", rise, "temperature-difference")
    result.formulas.append("T_J = T_A + P * theta_JA")
    if theta.conditions is None:
        result.check("thetaja-conditions", "unknown", "thetaJA was given without its characterization conditions.")
        result.warn(
            "thetaJA was given without conditions (board, copper area, airflow); it depends on them and may not "
            "describe this design."
        )
    else:
        result.check("thetaja-conditions", "pass", f"thetaJA conditions declared: {theta.conditions}")
    _junction_limit(result, junction, maximum)
    result.assumptions.append("The whole power leaves through the path that thetaJA describes, into ambient air at T_A.")
    result.limits += [
        STEADY,
        "thetaJA holds only for the board, copper area and airflow of its characterization; it is a comparison "
        "metric, not a property of the package alone.",
    ]


def junction_case_sink(reader: Reader, result: Result) -> None:
    if reader.has("thetaJA"):
        reader.fail(
            "contradiction",
            "thetaJA",
            "thetaJA already contains the junction-to-case path; do not combine it with thetaJC. Use model "
            "junction-ambient for a thetaJA estimate.",
        )
    mode = reader.choice("solveFor", ("thetaSA",), required=False)
    solving = "solveFor" in reader.data
    power = reader.value("power", "power", sign="positive" if solving else "nonnegative")
    ambient = reader.value("tAmbient", "temperature", role="absolute")
    theta_jc = reader.value("thetaJC", "thermal-resistance", sign="positive")
    theta_cs = reader.value("thetaCS", "thermal-resistance", required=False)
    theta_sa = reader.value("thetaSA", "thermal-resistance", required=False, sign="positive")
    theta_ca = reader.value("thetaCA", "thermal-resistance", required=False, sign="positive")
    maximum = reader.value("tJunctionMax", "temperature", required=False, role="absolute")
    reader.close()
    has = lambda key: key in reader.data  # noqa: E731
    if not reader.problems:
        if solving:
            if has("thetaSA"):
                reader.fail("contradiction", "thetaSA", "thetaSA is the result of this mode; remove it or solveFor.")
            if has("thetaCA"):
                reader.fail("contradiction", "thetaCA", "A case-to-ambient resistance replaces the heatsink path; remove it.")
            if not has("thetaCS"):
                reader.fail("insufficient", "thetaCS", "Sizing a heatsink needs the case-to-sink (interface) resistance thetaCS.")
            if maximum is None:
                reader.fail("insufficient", "tJunctionMax", "Sizing a heatsink needs the maximum junction temperature.")
        elif has("thetaCA"):
            if has("thetaCS") or has("thetaSA"):
                reader.fail("contradiction", "thetaCA", "Give thetaCS with thetaSA (heatsink path) or thetaCA alone, not both.")
        elif not has("thetaSA") and not has("thetaCS"):
            reader.fail("insufficient", "thetaSA", "Give the path from case to ambient: thetaCS with thetaSA, or thetaCA.")
        elif not has("thetaCS"):
            reader.fail("insufficient", "thetaCS", "A heatsink path needs the case-to-sink (interface) resistance thetaCS.")
        elif not has("thetaSA"):
            reader.fail("insufficient", "thetaSA", "A heatsink path needs the sink-to-ambient resistance thetaSA.")
    reader.check()
    assert power is not None and ambient is not None and theta_jc is not None
    if mode == "thetaSA":
        assert maximum is not None and theta_cs is not None
        allowed = (maximum - ambient) / power
        largest = allowed - theta_jc - theta_cs
        if abs(largest) <= SLACK * max(abs(allowed), theta_jc + theta_cs):
            largest = 0.0
        result.add("thetaSAMax", largest, "thermal-resistance")
        result.formulas.append("theta_SA,max = (T_J,max - T_A) / P - theta_JC - theta_CS")
        passed = largest > 0
        result.check(
            "heatsink-feasible",
            "pass" if passed else "fail",
            "A heatsink at or below thetaSAMax keeps the junction at its maximum."
            if passed
            else "No heatsink can meet the limit: the junction-to-sink resistances alone exceed the allowed total.",
        )
    else:
        if theta_ca is not None:
            case = ambient + power * theta_ca
            total = theta_jc + theta_ca
            result.formulas += ["T_C = T_A + P * theta_CA", "T_J = T_C + P * theta_JC"]
        else:
            assert theta_cs is not None and theta_sa is not None
            sink = ambient + power * theta_sa
            case = sink + power * theta_cs
            total = theta_jc + theta_cs + theta_sa
            result.add("tSink", sink, "temperature")
            result.formulas += ["T_S = T_A + P * theta_SA", "T_C = T_S + P * theta_CS", "T_J = T_C + P * theta_JC"]
        junction = case + power * theta_jc
        result.add("tCase", case, "temperature")
        result.add("tJunction", junction, "temperature")
        result.add("thetaTotal", total, "thermal-resistance")
        _junction_limit(result, junction, maximum)
    result.assumptions.append("The whole power flows through the case (and the heatsink) to ambient; no heat leaves through the leads or the board.")
    result.limits += [
        STEADY,
        "Simplified heatsink: one sink-to-ambient resistance at its rated airflow and orientation; thetaJC assumes "
        "an isothermal case surface.",
    ]


def foster(reader: Reader, result: Result) -> None:
    power = reader.value("power", "power")
    reference = reader.value("tReference", "temperature", role="absolute")
    stages = reader.objects("stages", low=1, high=16)
    network: list[tuple[float, float]] = []
    for index, stage in enumerate(stages or []):
        resistance = stage.value("resistance", "thermal-resistance", sign="positive")
        tau = stage.value("tau", "time", required=False, sign="positive")
        capacitance = stage.value("capacitance", "thermal-capacitance", required=False, sign="positive")
        if "tau" in stage.data and "capacitance" in stage.data:
            reader.fail("contradiction", f"stages.{index}", "Give tau or capacitance for a stage, not both.")
        elif "tau" not in stage.data and "capacitance" not in stage.data:
            reader.fail("insufficient", f"stages.{index}", "A stage needs its time constant tau or its capacitance.")
        elif resistance is not None and (tau is not None or capacitance is not None):
            network.append((resistance, tau if tau is not None else resistance * capacitance))  # type: ignore[operator]
    times = reader.quantities("times", "time", low=1, high=64)
    reader.done()
    assert power is not None and reference is not None and times is not None
    steady = sum(resistance for resistance, _ in network)
    result.add("zthSteady", steady, "thermal-resistance")
    result.add("tSteady", reference + power * steady, "temperature")
    response = []
    for moment in times:
        impedance = sum(-resistance * math.expm1(-moment.si / tau) for resistance, tau in network)
        response.append(
            {
                "time": shown(moment.si, "time"),
                "zth": shown(impedance, "thermal-resistance"),
                "temperatureRise": shown(power * impedance, "temperature-difference"),
                "temperature": shown(reference + power * impedance, "temperature"),
            }
        )
        if len(times) == 1:
            result.add("zth", impedance, "thermal-resistance")
            result.add("temperatureAtTime", reference + power * impedance, "temperature")
    result.details["response"] = response
    result.formulas += [
        "Z_th(t) = sum(R_i * (1 - exp(-t / tau_i))), tau_i = R_i * C_i",
        "T(t) = T_ref + P * Z_th(t)",
    ]
    result.assumptions.append("A single power step applied at t = 0 from thermal equilibrium at the reference temperature.")
    result.limits += [
        "A Foster network is a fitted behavioural model as supplied: only the junction temperature is meaningful, "
        "its internal nodes are not physical temperatures.",
        "Single step only: no repetitive pulses, no superposition of different power levels; Cauer networks are not accepted.",
    ]


MODELS = {
    "thermal": {
        "junction-ambient": junction_ambient,
        "junction-case-sink": junction_case_sink,
        "foster": foster,
    }
}

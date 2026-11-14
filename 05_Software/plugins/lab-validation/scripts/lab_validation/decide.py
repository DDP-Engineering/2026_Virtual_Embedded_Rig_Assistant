"""Criteria and the verdict (spec section 7). Limits are echoed as written and never widened."""

from __future__ import annotations

from typing import Any

from . import units

ORDER = {"pass": 0, "incomplete": 1, "fail": 2}


def conditions_check(names: list[str], required: dict[str, str], sources: list[Any]) -> tuple[list[str], list[str]]:
    """Diagnostics and reasons for the request conditions a criterion names, against each involved source."""
    codes: list[str] = []
    reasons: list[str] = []
    for source in sources:
        stated = source.conditions
        for name in names:
            if name not in stated:
                if "conditions-unknown" not in codes:
                    codes.append("conditions-unknown")
                reasons.append(f"source {source.id} does not state condition {name} (required {required[name]})")
            elif not units.same_condition(stated[name], required[name]):
                if "conditions-differ" not in codes:
                    codes.append("conditions-differ")
                reasons.append(f"source {source.id} states {name} = {stated[name]}, the requirement {required[name]}")
    return codes, reasons


def decide(spec: dict[str, Any], value: float | None, status: str, diagnostics: list[str], reasons: list[str]) -> dict[str, Any]:
    """One criterion. `status` is the value's: ok, bound (a lower bound) or unknown."""
    op, limit, rule = spec["op"], spec["limitValue"], spec["rule"]
    uncertainty = spec.get("uncertaintyValue")
    if uncertainty is not None and spec.get("uncertaintyPercent") and value is not None:
        uncertainty = abs(value) * uncertainty / 100
    tolerance = spec.get("toleranceValue")
    if tolerance is not None and spec.get("tolerancePercent"):
        tolerance = abs(limit) * tolerance / 100
    reasons = list(reasons)
    outcome: str
    if value is None or status == "unknown":
        outcome = "incomplete"
        reasons.append("the value is unknown")
    elif diagnostics:
        outcome = "incomplete"
        reasons.append("a diagnostic limits the verdict: " + ", ".join(diagnostics))
    elif rule == "guarded" and uncertainty is None:
        outcome = "incomplete"
        reasons.append("the guarded rule needs an uncertainty and none was supplied (uncertainty-unknown)")
    else:
        u = uncertainty if rule == "guarded" else 0.0
        assert u is not None
        if status == "bound":
            # The true value is at least `value`.
            if op == "<=":
                outcome = "fail" if value - u > limit else "incomplete"
            elif op == ">=":
                outcome = "pass" if value - u >= limit else "incomplete"
            else:
                outcome = "fail" if value - u > limit + tolerance else "incomplete"
            if outcome == "incomplete":
                reasons.append("the value is a lower bound that does not decide the criterion")
        elif op == "<=":
            outcome = "pass" if value + u <= limit else "fail" if value - u > limit else "incomplete"
        elif op == ">=":
            outcome = "pass" if value - u >= limit else "fail" if value + u < limit else "incomplete"
        else:
            low, high = limit - tolerance, limit + tolerance
            if low <= value - u and value + u <= high:
                outcome = "pass"
            elif value + u < low or value - u > high:
                outcome = "fail"
            else:
                outcome = "incomplete"
        if outcome == "incomplete" and status != "bound":
            reasons.append("the uncertainty interval straddles the limit")
        if rule == "simple" and uncertainty is not None:
            reasons.append("simple acceptance: the uncertainty is reported, not applied")
    record = {"id": spec["id"], "value": spec["value"], "op": op, "limit": spec["limit"], "rule": rule, "measured": value,
              "unit": spec["unit"], "valueStatus": status, "status": outcome, "reasons": reasons, "diagnostics": diagnostics}
    if "tolerance" in spec:
        record["tolerance"] = spec["tolerance"]
    if "uncertainty" in spec:
        record["uncertainty"] = spec["uncertainty"]
        record["uncertaintyValue"] = uncertainty
    if spec["conditionNames"]:
        record["conditions"] = spec["conditionNames"]
    return record


def verdict(criteria: list[dict[str, Any]]) -> str:
    statuses = [criterion["status"] for criterion in criteria]
    if "fail" in statuses:
        return "fail"
    if "incomplete" in statuses:
        return "incomplete"
    return "pass"

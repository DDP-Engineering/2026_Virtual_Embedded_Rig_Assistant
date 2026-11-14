"""Diagnostic codes (spec section 7). A limiting diagnostic on a value makes every criterion on it incomplete."""

from __future__ import annotations

from typing import Any

MESSAGES = {
    "gap": "the window holds a gap without samples; nothing is interpolated across it",
    "clipped": "the window holds samples at the converter or declared clip limits; the true values are unknown",
    "source-incomplete": "the source capture itself is incomplete (for example a truncated transfer)",
    "aliasing-suspect": "fewer than 4 samples per period of the measured frequency: the frequency may be an alias",
    "aliasing-risk": "the signal was resampled below its own rate without a moving-average at least one new period wide",
    "under-sampled": "fewer than 3 samples lie inside the measured transition",
    "bandwidth-unknown": "the source states no bandwidth, so the instrument's own rise time is unknown",
    "bandwidth-limited": "the measured transition is shorter than 3 x the system rise time from bandwidth and filtering",
    "conditions-unknown": "a source does not state a condition the requirement names",
    "conditions-differ": "a source states a condition other than the requirement's",
    "lag-at-limit": "the correlation peak lies at the maxLag bound: the true lag may be larger",
    "reference-short": "the reference does not cover the whole window after the alignment",
    "lag-unjudged": "cross-correlation removed a lag that no criterion judges",
    "resampled-up": "the signal was resampled above its own rate; the added points are interpolated",
}


def entry(code: str, limits: bool, **where: Any) -> dict[str, Any]:
    return {"code": code, "limits": limits, **{k: v for k, v in where.items() if v is not None},
            "message": MESSAGES.get(code, code)}


def merge(*groups: list[str]) -> list[str]:
    out: list[str] = []
    for group in groups:
        for code in group:
            if code not in out:
                out.append(code)
    return out

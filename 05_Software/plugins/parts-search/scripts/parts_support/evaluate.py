"""Evidence, outcomes, identity, offers and ranking of a comparison (spec REQ-DATA-6b26f2a5 §3, §4)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from .request import Candidate, Constraint, Offer, Parameter, Request, fold
from .units import Quantity, meets, unit_name

STALE_AFTER = timedelta(hours=24)
# operator -> the bases that can prove it: a typical value never proves a limit.
PROVES = {"<=": ("max", "nominal", "rating"), ">=": ("min", "nominal", "rating"), "==": ("min", "typ", "max", "nominal", "rating"), "in": ("min", "typ", "max", "nominal", "rating")}


@dataclass
class Device:
    candidates: list[Candidate]
    warnings: list[str] = field(default_factory=list)

    @property
    def first(self) -> Candidate:
        return self.candidates[0]

    @property
    def parameters(self) -> list[Parameter]:
        return [parameter for candidate in self.candidates for parameter in candidate.parameters]

    @property
    def offers(self) -> list[Offer]:
        return [offer for candidate in self.candidates for offer in candidate.offers]

    def stated(self, key: str) -> dict[str, Any] | None:
        return next((getattr(c, key) for c in self.candidates if getattr(c, key) is not None), None)


def identify(candidates: list[Candidate]) -> tuple[list[Device], list[str]]:
    """One device per manufacturer, MPN and package; different MPNs always stay apart."""
    devices: list[Device] = []
    index: dict[tuple[str, str, str], Device] = {}
    warnings: list[str] = []
    for candidate in candidates:
        key = (fold(candidate.manufacturer), fold(candidate.mpn), fold(candidate.package or ""))
        if key in index:
            index[key].candidates.append(candidate)
            warnings.append(
                f"Candidates {index[key].first.index} and {candidate.index} are the same device ({candidate.manufacturer} "
                f"{candidate.mpn}, {candidate.package or 'package not stated'}); their offers and values were merged."
            )
            continue
        for other in devices:
            if fold(other.first.manufacturer) == key[0] and fold(other.first.mpn) == key[1]:
                warnings.append(
                    f"{candidate.mpn} is listed with the packages '{other.first.package or 'not stated'}' and "
                    f"'{candidate.package or 'not stated'}'; they stay separate devices - check the MPN."
                )
                break
        device = Device([candidate])
        index[key] = device
        devices.append(device)
    return devices, warnings


def _shown(value: Quantity | str) -> str:
    return value if isinstance(value, str) else value.given


def _rejection(row: Parameter, constraint: Constraint) -> str | None:
    """Why a parameter row is not evidence for the constraint, or None when it is."""
    if row.status != "confirmed":
        return "proposed, not confirmed in the datasheet"
    if row.source["kind"] != "datasheet":
        return "supplier value, not a datasheet value"
    if not row.source.get("page") and not row.source.get("table"):
        return "no datasheet page or table given"
    if row.basis not in PROVES[constraint.op]:
        return "typical value is not a guarantee" if row.basis == "typ" else f"a {row.basis} value cannot prove {constraint.op}"
    if not isinstance(constraint.value, (str, list)) and isinstance(row.value, str):
        return "a text where a quantity is needed"
    if isinstance(row.value, Quantity) and isinstance(constraint.value, Quantity) and row.value.base != constraint.value.base:
        return f"unit {unit_name(row.value)} is not comparable with {unit_name(constraint.value)}"
    for condition in constraint.conditions:
        stated = row.conditions.get(fold(condition.name))
        if stated is None:
            return f"condition {condition.name} not stated"
        holds = meets(stated[1], condition.op, condition.value)
        if holds is None:
            return f"condition {condition.name} in {unit_name(stated[1])} is not comparable with {unit_name(condition.value)}"
        if not holds:
            return f"{stated[0]} {stated[1].given} does not meet {condition.name} {condition.op} {condition.value.given}"
    return None


def _source(row: Parameter) -> dict[str, Any]:
    source = dict(row.source)
    if source["kind"] == "datasheet" and row.datasheet:
        source.update({key: value for key, value in row.datasheet.items() if value})
    return source


def check(device: Device, constraint: Constraint) -> dict[str, Any]:
    rows = [row for row in device.parameters if fold(row.name) == fold(constraint.parameter)]
    evidence: list[Parameter] = []
    reasons: list[str] = []
    for row in rows:
        why = _rejection(row, constraint)
        if why:
            reasons.append(f"{row.name} {_shown(row.value)}: {why}")
        else:
            evidence.append(row)
    if not rows:
        reasons.append(f"no value of {constraint.parameter} is given")
    status, value = "unknown", None
    if evidence:
        if isinstance(constraint.value, Quantity):
            values = [row.value for row in evidence if isinstance(row.value, Quantity)]
            if constraint.op in ("<=", ">="):
                worst = max(values, key=lambda q: q.si) if constraint.op == "<=" else min(values, key=lambda q: q.si)
                status, value = ("pass" if meets(worst, constraint.op, constraint.value) else "fail"), worst.given
            else:
                status = "pass" if all(meets(q, "==", constraint.value) for q in values) else "fail"
                value = ", ".join(q.given for q in values)
        else:
            wanted = [fold(item) for item in (constraint.value if isinstance(constraint.value, list) else [constraint.value])]
            texts = [_shown(row.value) for row in evidence]
            status = "pass" if all(fold(text) in wanted for text in texts) else "fail"
            value = ", ".join(texts)
    return {
        "constraint": constraint.id,
        "parameter": constraint.parameter,
        "requirement": _requirement(constraint),
        "status": status,
        "value": value,
        "evidence": [
            {
                "value": _shown(row.value),
                **({"unit": unit_name(row.value)} if isinstance(row.value, Quantity) else {}),
                "basis": row.basis,
                "conditions": {name: q.given for name, q in row.conditions.values()},
                "source": _source(row),
            }
            for row in evidence
        ],
        "reasons": reasons if status == "unknown" else [],
    }


def _requirement(constraint: Constraint) -> str:
    value = constraint.value
    shown = ", ".join(value) if isinstance(value, list) else _shown(value)
    condition = "; ".join(f"{c.name} {c.op} {c.value.given}" for c in constraint.conditions)
    return f"{constraint.parameter} {constraint.op} {shown}" + (f" at {condition}" if condition else "")


def qualifying(device: Device, parameter: str, goal: str) -> list[Quantity]:
    """Values of a parameter that may rank a preference: confirmed, from a datasheet page or table, with the basis
    that would prove the matching limit (max for a value to minimise, min for one to maximise). Conditions are not
    compared."""
    proves = PROVES["<="] if goal == "min" else PROVES[">="]
    return [
        row.value
        for row in device.parameters
        if fold(row.name) == fold(parameter)
        and row.status == "confirmed"
        and row.source["kind"] == "datasheet"
        and (row.source.get("page") or row.source.get("table"))
        and row.basis in proves
        and isinstance(row.value, Quantity)
    ]


def representative(device: Device, parameter: str, goal: str, base: str) -> Quantity | None:
    """The worst qualifying value in `base`, or None."""
    values = [value for value in qualifying(device, parameter, goal) if value.base == base]
    if not values:
        return None
    return max(values, key=lambda q: q.si) if goal == "min" else min(values, key=lambda q: q.si)


def price_offer(offer: Offer, quantity: int, started: datetime) -> dict[str, Any]:
    order = max(quantity, offer.moq or 0)
    if offer.multiple and order % offer.multiple:
        order += offer.multiple - order % offer.multiple
    applicable = [price for amount, price in offer.price_breaks if amount <= order]
    unit = applicable[-1] if applicable else None
    return {
        "supplier": offer.supplier,
        "sku": offer.sku,
        "packaging": offer.packaging,
        "stock": offer.stock,
        "moq": offer.moq,
        "multiple": offer.multiple,
        "currency": offer.currency,
        "region": offer.region,
        "url": offer.url,
        "orderQuantity": order,
        "unitPrice": unit,
        "extendedPrice": None if unit is None else round(unit * order, 6),
        "stockCovers": None if offer.stock is None else offer.stock >= order,
        "retrievedAt": offer.retrieved_text,
        "basis": "snapshot",
        "stale": started - offer.retrieved_at > STALE_AFTER,
    }


def drop_in(device: Device, replaces: dict[str, str] | None) -> str | None:
    if replaces is None:
        return None
    verdicts = []
    for key in ("pinout", "footprint"):
        stated = device.stated(key)
        if stated is None or not stated.get("page"):
            verdicts.append("unknown")
        else:
            verdicts.append("yes" if fold(stated["value"]) == fold(replaces[key]) else "no")
    return "no" if "no" in verdicts else "unknown" if "unknown" in verdicts else "yes"


def compare(request: Request, started: datetime) -> dict[str, Any]:
    devices, warnings = identify(request.candidates)
    rows: list[dict[str, Any]] = []
    for device in devices:
        checks = [check(device, constraint) for constraint in request.constraints]
        statuses = {item["status"] for item in checks}
        outcome = "rejected" if "fail" in statuses else "eligible" if statuses == {"pass"} else "unknown"
        offers = [price_offer(offer, request.quantity, started) for offer in device.offers]
        supplier_values = [
            {"name": row.name, "value": _shown(row.value), "status": row.status, "source": row.source}
            for row in device.parameters
            if row.source["kind"] == "supplier" or row.status != "confirmed"
        ]
        rows.append(
            {
                "rank": None,
                "outcome": outcome,
                "manufacturer": device.first.manufacturer,
                "mpn": device.first.mpn,
                "package": device.first.package,
                "mergedFrom": [candidate.index for candidate in device.candidates],
                "datasheet": device.stated("datasheet"),
                "dropIn": drop_in(device, request.replaces),
                "checks": checks,
                "unconfirmedValues": supplier_values,
                "offers": offers,
                "_device": device,
            }
        )
    eligible = [row for row in rows if row["outcome"] == "eligible"]
    currency = request.currency or _shared_currency(eligible)
    bases: dict[int, str | None] = {}
    for position, preference in enumerate(request.preferences):
        if preference.get("criterion") == "price" and currency is None and eligible:
            priced = any(offer["extendedPrice"] is not None for row in eligible for offer in row["offers"])
            warnings.append(
                "The price preference was skipped: the offers are in different currencies (give a request currency)."
                if priced
                else "The price preference was skipped: no eligible device has a priced offer."
            )
        if "parameter" in preference:
            # Values rank only within one unit: the first recognised unit stated by an eligible device, in request
            # order, or else the first unit text.
            stated = [qualifying(row["_device"], preference["parameter"], preference["goal"]) for row in eligible]
            flat = [value for values in stated for value in values]
            base = next((value.base for value in flat if not value.base.startswith("?")), flat[0].base if flat else None)
            bases[position] = base
            others = sorted(
                {value.given for values in stated if values and all(value.base != base for value in values) for value in values}
            )
            if others:
                warnings.append(
                    f"The preference on {preference['parameter']} ranks only values in {base[1:] if base and base.startswith('?') else base}; "
                    f"{', '.join(others)} cannot be compared with them and rank as unknown."
                )
    ranked = sorted(enumerate(eligible), key=lambda pair: (_rank_key(pair[1], request, currency, bases), pair[0]))
    for position, (_, row) in enumerate(ranked, 1):
        row["rank"] = position
    order = [row for _, row in ranked] + [row for row in rows if row["outcome"] == "unknown"] + [row for row in rows if row["outcome"] == "rejected"]
    for row in order:
        row.pop("_device")
    proposed = order[0] if order and order[0]["outcome"] == "eligible" else None
    stale = sum(1 for row in rows for offer in row["offers"] if offer["stale"])
    if stale:
        warnings.append(f"{stale} offer(s) were captured more than 24 hours before this run; search again for current values.")
    return {"devices": order, "proposed": proposed, "currency": currency, "warnings": warnings}


def _priced(row: dict[str, Any], currency: str | None) -> list[float]:
    """Extended prices (unit price x order quantity) of the offers in one currency: the cost of covering the quantity."""
    return [offer["extendedPrice"] for offer in row["offers"] if offer["extendedPrice"] is not None and offer["currency"] == currency]


def _shared_currency(rows: list[dict[str, Any]]) -> str | None:
    currencies = {offer["currency"] for row in rows for offer in row["offers"] if offer["unitPrice"] is not None}
    return next(iter(currencies)) if len(currencies) == 1 and None not in currencies else None


def _rank_key(row: dict[str, Any], request: Request, currency: str | None, bases: dict[int, str | None]) -> tuple[Any, ...]:
    key: list[Any] = []
    for position, preference in enumerate(request.preferences):
        if "parameter" in preference:
            base = bases.get(position)
            value = representative(row["_device"], preference["parameter"], preference["goal"], base) if base else None
            key.append((1, 0.0) if value is None else (0, value.si if preference["goal"] == "min" else -value.si))
        elif preference["criterion"] == "price" and currency is not None:
            prices = _priced(row, currency)
            key.append((0, min(prices)) if prices else (1, 0.0))
        elif preference["criterion"] == "stock":
            stocks = [offer["stock"] for offer in row["offers"] if offer["stock"] is not None]
            key.append((0, -max(stocks)) if stocks else (1, 0.0))
    return tuple(key)


def best_offer(row: dict[str, Any], currency: str | None) -> dict[str, Any] | None:
    """The proposed device's offer with the lowest extended price in the comparable currency, or None."""
    if currency is None:
        currencies = {offer["currency"] for offer in row["offers"] if offer["unitPrice"] is not None}
        currency = next(iter(currencies)) if len(currencies) == 1 else None
    priced = [offer for offer in row["offers"] if offer["unitPrice"] is not None and currency and offer["currency"] == currency]
    return min(priced, key=lambda offer: offer["extendedPrice"]) if priced else None

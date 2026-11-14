"""Reading a comparison request (spec REQ-DATA-6b26f2a5 §2): every problem of one pass is reported together."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from .units import Quantity, UnitError, quantity

TEXT_LIMIT = 500
PRICE_LIMIT = 1_000_000_000  # a unit price; with order quantities up to 1e12 the extended price stays finite
CONSTRAINT_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
CURRENCY = re.compile(r"[A-Z]{3}")
OPERATORS = ("<=", ">=", "==", "in")
BASES = ("min", "typ", "max", "nominal", "rating")
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f  ]")
_STAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})")


@dataclass
class Problem:
    code: str
    path: str
    message: str

    def json(self) -> dict[str, str]:
        return {"code": self.code, "path": self.path[:200], "message": self.message[:600]}


class Refused(Exception):
    def __init__(self, problems: list[Problem]) -> None:
        super().__init__(problems[0].message if problems else "refused")
        self.problems = problems


@dataclass
class Condition:
    name: str
    op: str
    value: Quantity


@dataclass
class Constraint:
    id: str
    parameter: str
    op: str
    value: Quantity | str | list[str]
    conditions: list[Condition]


@dataclass
class Parameter:
    name: str
    value: Quantity | str
    basis: str
    conditions: dict[str, tuple[str, Quantity]]  # folded name -> (name as written, value)
    source: dict[str, Any]
    status: str
    index: int
    datasheet: dict[str, str] | None = None


@dataclass
class Offer:
    supplier: str
    sku: str
    retrieved_at: datetime
    retrieved_text: str
    price_breaks: list[tuple[int, float | None]]
    packaging: str | None = None
    stock: int | None = None
    moq: int | None = None
    multiple: int | None = None
    currency: str | None = None
    region: str | None = None
    url: str | None = None


@dataclass
class Candidate:
    index: int
    manufacturer: str
    mpn: str
    package: str | None
    datasheet: dict[str, str] | None
    pinout: dict[str, Any] | None
    footprint: dict[str, Any] | None
    parameters: list[Parameter] = field(default_factory=list)
    offers: list[Offer] = field(default_factory=list)


@dataclass
class Request:
    title: str
    quantity: int
    currency: str | None
    constraints: list[Constraint]
    preferences: list[dict[str, str]]
    replaces: dict[str, str] | None
    candidates: list[Candidate]


def fold(text: str) -> str:
    """Names and identities compare without letter case and with runs of spaces as one."""
    return " ".join(text.split()).casefold()


def load_json(text: str) -> dict[str, Any]:
    """One JSON object with unique keys and finite numbers."""

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise Refused([Problem("json", "", f"The key '{key[:60]}' appears twice in one object.")])
            result[key] = value
        return result

    def constant(name: str) -> Any:
        raise Refused([Problem("json", "", f"{name} is not a finite number.")])

    def number(literal: str) -> float:
        value = float(literal)
        if not math.isfinite(value):
            raise Refused([Problem("json", "", f"The number {literal[:40]} is not finite.")])
        return value

    try:
        data = json.loads(text, object_pairs_hook=pairs, parse_constant=constant, parse_float=number)
        json.dumps(data, ensure_ascii=False).encode("utf-8")
    except json.JSONDecodeError as error:
        raise Refused([Problem("json", "", f"The request is not valid JSON: {error.msg} at line {error.lineno}, column {error.colno}.")]) from error
    except RecursionError as error:
        raise Refused([Problem("json", "", "The request is nested too deeply.")]) from error
    except UnicodeEncodeError as error:
        raise Refused([Problem("json", "", "The request holds a lone surrogate, which is not valid Unicode text.")]) from error
    except ValueError as error:
        raise Refused([Problem("json", "", "The request holds a number that is too long to read.")]) from error
    if not isinstance(data, dict):
        raise Refused([Problem("json", "", "The request must be one JSON object.")])
    return data


class _Reader:
    def __init__(self, started: datetime) -> None:
        self.problems: list[Problem] = []
        self.started = started

    def fail(self, code: str, path: str, message: str) -> None:
        self.problems.append(Problem(code, path, message))

    def keys(self, node: Any, path: str, required: tuple[str, ...], optional: tuple[str, ...] = ()) -> bool:
        if not isinstance(node, dict):
            self.fail("schema", path, "This must be a JSON object.")
            return False
        for key in node:
            if key not in required + optional:
                self.fail("schema", f"{path}.{key}".lstrip("."), f"Unknown field; use {', '.join(required + optional)}.")
        for key in required:
            if key not in node:
                self.fail("schema", f"{path}.{key}".lstrip("."), "This field is required.")
        return True

    def text(self, value: Any, path: str, limit: int = TEXT_LIMIT) -> str | None:
        if not isinstance(value, str) or not value.strip() or len(value) > limit or _CONTROL.search(value):
            self.fail("schema", path, f"Use a text of 1..{limit} characters on one line, without control characters.")
            return None
        return value.strip()

    def optional_text(self, node: dict[str, Any], key: str, path: str, limit: int = TEXT_LIMIT) -> str | None:
        value = node.get(key)
        return None if value is None else self.text(value, f"{path}.{key}".lstrip("."), limit)

    def integer(self, value: Any, path: str, low: int, high: int, nullable: bool = False) -> int | None:
        if value is None and nullable:
            return None
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            self.fail("schema", path, f"Use a whole number from {low} to {high}{' or null' if nullable else ''}.")
            return None
        return value

    def quantity(self, value: Any, path: str) -> Quantity | None:
        try:
            return quantity(value)
        except UnitError as error:
            self.fail("unit", path, str(error))
            return None

    def array(self, value: Any, path: str, low: int, high: int) -> list[Any]:
        if not isinstance(value, list) or not low <= len(value) <= high:
            self.fail("schema", path, f"Use a list of {low} to {high} items.")
            return []
        return value

    def stamp(self, value: Any, path: str) -> datetime | None:
        if not isinstance(value, str) or not _STAMP.fullmatch(value):
            self.fail("schema", path, "Use an ISO 8601 date and time with a zone, such as 2026-11-13T10:00:00Z.")
            return None
        try:
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            self.fail("schema", path, "This is not a valid date and time.")
            return None
        if moment > self.started + timedelta(minutes=5):
            self.fail("schema", path, "The capture time lies in the future; give the time the supplier answered.")
            return None
        return moment


def read(document: dict[str, Any], started: datetime) -> Request:
    r = _Reader(started)
    r.keys(document, "", ("title", "quantity", "constraints", "candidates"), ("currency", "preferences", "replaces"))
    title = r.text(document.get("title"), "title")
    amount = r.integer(document.get("quantity"), "quantity", 1, 1_000_000_000)
    currency = document.get("currency")
    if currency is not None and (not isinstance(currency, str) or not CURRENCY.fullmatch(currency)):
        r.fail("schema", "currency", "Use an ISO 4217 code of three capital letters, such as EUR.")
        currency = None
    constraints = _constraints(r, document.get("constraints"))
    preferences = _preferences(r, document.get("preferences", []))
    replaces = None
    if document.get("replaces") is not None:
        node = document["replaces"]
        if r.keys(node, "replaces", ("manufacturer", "mpn", "pinout", "footprint")):
            replaces = {key: r.text(node.get(key), f"replaces.{key}") or "" for key in ("manufacturer", "mpn", "pinout", "footprint")}
    candidates = [
        candidate
        for index, node in enumerate(r.array(document.get("candidates"), "candidates", 1, 64))
        if (candidate := _candidate(r, node, index)) is not None
    ]
    if r.problems:
        raise Refused(r.problems)
    assert title is not None and amount is not None
    return Request(title, amount, currency, constraints, preferences, replaces, candidates)


def _constraints(r: _Reader, raw: Any) -> list[Constraint]:
    result: list[Constraint] = []
    seen: set[str] = set()
    for index, node in enumerate(r.array(raw, "constraints", 1, 64)):
        path = f"constraints.{index}"
        if not r.keys(node, path, ("id", "parameter", "op", "value"), ("conditions",)):
            continue
        ident = node.get("id")
        if not isinstance(ident, str) or not CONSTRAINT_ID.fullmatch(ident):
            r.fail("schema", f"{path}.id", "Use lower-case letters, digits and hyphens, starting with a letter or digit (at most 64).")
            ident = None
        elif ident in seen:
            r.fail("schema", f"{path}.id", "This id is used twice.")
        else:
            seen.add(ident)
        parameter = r.text(node.get("parameter"), f"{path}.parameter", 80)
        op = node.get("op")
        if op not in OPERATORS:
            r.fail("schema", f"{path}.op", "Use <=, >=, == or in.")
            op = None
        value: Quantity | str | list[str] | None = None
        raw_value = node.get("value")
        if op == "in":
            items = r.array(raw_value, f"{path}.value", 1, 32)
            texts = [r.text(item, f"{path}.value.{i}", 120) for i, item in enumerate(items)]
            value = [text for text in texts if text is not None] if all(texts) else None
        elif op == "==" and isinstance(raw_value, str) and not raw_value.strip().lstrip("+-.")[:1].isdigit():
            value = r.text(raw_value, f"{path}.value", 120)
        elif op is not None:
            value = r.quantity(raw_value, f"{path}.value")
        conditions: list[Condition] = []
        raw_conditions = node.get("conditions", {})
        if not isinstance(raw_conditions, dict) or not 0 <= len(raw_conditions) <= 8:
            r.fail("schema", f"{path}.conditions", "Use an object of at most 8 conditions, name -> {op, value}.")
            raw_conditions = {}
        for name, condition in raw_conditions.items():
            where = f"{path}.conditions.{name}"
            if not isinstance(name, str) or not 1 <= len(name) <= 40 or _CONTROL.search(name):
                r.fail("schema", where, "A condition name is 1..40 characters.")
                continue
            if not r.keys(condition, where, ("op", "value")):
                continue
            if condition.get("op") not in ("<=", ">=", "=="):
                r.fail("schema", f"{where}.op", "Use <=, >= or ==.")
                continue
            bound = r.quantity(condition.get("value"), f"{where}.value")
            if bound is not None:
                conditions.append(Condition(name, condition["op"], bound))
        if ident and parameter and op and value is not None:
            result.append(Constraint(ident, parameter, op, value, conditions))
    return result


def _preferences(r: _Reader, raw: Any) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for index, node in enumerate(r.array(raw, "preferences", 0, 16)):
        path = f"preferences.{index}"
        if isinstance(node, dict) and "criterion" in node:
            if r.keys(node, path, ("criterion",)) and node.get("criterion") in ("price", "stock"):
                result.append({"criterion": node["criterion"]})
            elif node.get("criterion") not in ("price", "stock"):
                r.fail("schema", f"{path}.criterion", "Use price or stock.")
        elif r.keys(node, path, ("parameter", "goal")):
            parameter = r.text(node.get("parameter"), f"{path}.parameter", 80)
            if node.get("goal") not in ("min", "max"):
                r.fail("schema", f"{path}.goal", "Use min or max.")
            elif parameter:
                result.append({"parameter": parameter, "goal": node["goal"]})
    return result


def _page_value(r: _Reader, node: Any, path: str) -> dict[str, Any] | None:
    if node is None:
        return None
    if not r.keys(node, path, ("value",), ("page",)):
        return None
    value = r.text(node.get("value"), f"{path}.value", 200)
    page = r.integer(node.get("page"), f"{path}.page", 1, 100_000, nullable=True) if "page" in node else None
    return None if value is None else {"value": value, "page": page}


def _candidate(r: _Reader, node: Any, index: int) -> Candidate | None:
    path = f"candidates.{index}"
    if not r.keys(node, path, ("manufacturer", "mpn"), ("package", "datasheet", "pinout", "footprint", "parameters", "offers")):
        return None
    manufacturer = r.text(node.get("manufacturer"), f"{path}.manufacturer", 120)
    mpn = r.text(node.get("mpn"), f"{path}.mpn", 64)
    package = r.optional_text(node, "package", path, 80)
    datasheet = None
    if node.get("datasheet") is not None and r.keys(node["datasheet"], f"{path}.datasheet", ("url",), ("revision",)):
        url = r.text(node["datasheet"].get("url"), f"{path}.datasheet.url", 2048)
        revision = r.optional_text(node["datasheet"], "revision", f"{path}.datasheet", 80)
        datasheet = {"url": url or "", **({"revision": revision} if revision else {})}
    pinout = _page_value(r, node.get("pinout"), f"{path}.pinout")
    footprint = _page_value(r, node.get("footprint"), f"{path}.footprint")
    parameters = [
        parameter
        for i, item in enumerate(r.array(node.get("parameters", []), f"{path}.parameters", 0, 128))
        if (parameter := _parameter(r, item, f"{path}.parameters.{i}", i)) is not None
    ]
    offers = [
        offer
        for i, item in enumerate(r.array(node.get("offers", []), f"{path}.offers", 0, 32))
        if (offer := _offer(r, item, f"{path}.offers.{i}")) is not None
    ]
    if manufacturer is None or mpn is None:
        return None
    for parameter in parameters:
        parameter.datasheet = datasheet
    return Candidate(index, manufacturer, mpn, package, datasheet, pinout, footprint, parameters, offers)


def _parameter(r: _Reader, node: Any, path: str, index: int) -> Parameter | None:
    if not r.keys(node, path, ("name", "value", "basis", "source", "status"), ("conditions",)):
        return None
    name = r.text(node.get("name"), f"{path}.name", 80)
    raw = node.get("value")
    value: Quantity | str | None
    if isinstance(raw, str) and not raw.strip().lstrip("+-.")[:1].isdigit():
        value = r.text(raw, f"{path}.value", 120)
    else:
        value = r.quantity(raw, f"{path}.value")
    basis = node.get("basis")
    if basis not in BASES:
        r.fail("schema", f"{path}.basis", "Use min, typ, max, nominal or rating.")
    status = node.get("status")
    if status not in ("confirmed", "proposed"):
        r.fail("schema", f"{path}.status", "Use confirmed (checked in the datasheet) or proposed.")
    conditions: dict[str, tuple[str, Quantity]] = {}
    raw_conditions = node.get("conditions", {})
    if not isinstance(raw_conditions, dict) or len(raw_conditions) > 8:
        r.fail("schema", f"{path}.conditions", "Use an object of at most 8 conditions, name -> quantity.")
        raw_conditions = {}
    for key, item in raw_conditions.items():
        if not isinstance(key, str) or not 1 <= len(key) <= 40 or _CONTROL.search(key):
            r.fail("schema", f"{path}.conditions", "A condition name is 1..40 characters.")
            continue
        q = r.quantity(item, f"{path}.conditions.{key}")
        if q is not None:
            conditions[fold(key)] = (key, q)
    source = _source(r, node.get("source"), f"{path}.source")
    if name is None or value is None or basis not in BASES or status not in ("confirmed", "proposed") or source is None:
        return None
    return Parameter(name, value, basis, conditions, source, status, index)


def _source(r: _Reader, node: Any, path: str) -> dict[str, Any] | None:
    if not isinstance(node, dict) or node.get("kind") not in ("datasheet", "supplier"):
        r.fail("schema", f"{path}.kind", "Use {\"kind\": \"datasheet\", page?, table?, figure?} or {\"kind\": \"supplier\", supplier, sku?}.")
        return None
    if node["kind"] == "datasheet":
        if not r.keys(node, path, ("kind",), ("page", "table", "figure")):
            return None
        page = r.integer(node["page"], f"{path}.page", 1, 100_000) if "page" in node else None
        table = r.optional_text(node, "table", path, 120)
        figure = r.optional_text(node, "figure", path, 120)
        return {"kind": "datasheet", **({"page": page} if page else {}), **({"table": table} if table else {}), **({"figure": figure} if figure else {})}
    if not r.keys(node, path, ("kind", "supplier"), ("sku",)):
        return None
    supplier = r.text(node.get("supplier"), f"{path}.supplier", 40)
    sku = r.optional_text(node, "sku", path, 64)
    return {"kind": "supplier", "supplier": supplier or "", **({"sku": sku} if sku else {})}


def _offer(r: _Reader, node: Any, path: str) -> Offer | None:
    optional = ("packaging", "stock", "moq", "multiple", "currency", "region", "url")
    if not r.keys(node, path, ("supplier", "sku", "retrievedAt", "priceBreaks"), optional):
        return None
    supplier = r.text(node.get("supplier"), f"{path}.supplier", 40)
    sku = r.text(node.get("sku"), f"{path}.sku", 64)
    moment = r.stamp(node.get("retrievedAt"), f"{path}.retrievedAt")
    breaks: list[tuple[int, float | None]] = []
    for i, item in enumerate(r.array(node.get("priceBreaks"), f"{path}.priceBreaks", 0, 32)):
        where = f"{path}.priceBreaks.{i}"
        if not r.keys(item, where, ("quantity", "unitPrice")):
            continue
        amount = r.integer(item.get("quantity"), f"{where}.quantity", 1, 1_000_000_000_000)
        price = item.get("unitPrice")
        if price is not None and (isinstance(price, bool) or not isinstance(price, (int, float)) or not 0 <= price <= PRICE_LIMIT):
            r.fail("schema", f"{where}.unitPrice", f"Use a number from 0 to {PRICE_LIMIT}, or null when the price is unknown.")
            continue
        if amount is not None and any(amount == known for known, _ in breaks):
            r.fail("schema", f"{where}.quantity", "Each break quantity appears once in an offer.")
            continue
        if amount is not None:
            breaks.append((amount, None if price is None else float(price)))
    currency = node.get("currency")
    if currency is not None and (not isinstance(currency, str) or not CURRENCY.fullmatch(currency)):
        r.fail("schema", f"{path}.currency", "Use three capital letters, such as EUR, or null.")
        currency = None
    counts = {key: r.integer(node.get(key), f"{path}.{key}", 0, 10**15, nullable=True) for key in ("stock", "moq", "multiple")}
    if supplier is None or sku is None or moment is None:
        return None
    return Offer(
        supplier,
        sku,
        moment,
        node["retrievedAt"],
        sorted(breaks, key=lambda entry: entry[0]),
        packaging=r.optional_text(node, "packaging", path, 80),
        stock=counts["stock"],
        moq=counts["moq"],
        multiple=counts["multiple"] or None,
        currency=currency,
        region=r.optional_text(node, "region", path, 64),
        url=r.optional_text(node, "url", path, 2048),
    )

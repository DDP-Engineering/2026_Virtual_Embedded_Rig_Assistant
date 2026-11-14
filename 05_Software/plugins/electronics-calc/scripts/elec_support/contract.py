"""Request reading and result documents (spec REQ-DATA-3d15fdfc §2 and §4)."""

from __future__ import annotations

import dataclasses
import json
import math
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

from . import FORMAT, TOOL, VERSION
from .quantities import (
    NAMES,
    TEXT_RULE,
    ZERO_CELSIUS,
    Quantity,
    QuantityError,
    display,
    nonzero_literal,
    parse_quantity,
    quantity_json,
    round_significant,
    valid_text,
)
from .workspace import utf16_length

MISSING = object()
# VERA's runner returns the last 12 000 characters of a run, counted as UTF-16 code units; a longer document
# would arrive cut and unparseable. Every limit below is in that unit.
STDOUT_LIMIT = 11_000
PATH_LIMIT = 200  # Characters of a problem's path and
MESSAGE_LIMIT = 600  # of a message, a warning or a check detail: request text is echoed there.
NOT_FINITE = (
    "The values of this request overflow, underflow or divide by zero in this model; no finite result exists."
)


def clipped(text: str, limit: int = MESSAGE_LIMIT) -> str:
    """Text of at most `limit` UTF-16 units; a longer one is cut between characters and ends in an ellipsis."""
    if utf16_length(text) <= limit:
        return text
    kept: list[str] = []
    used = 0
    for character in text:
        size = 2 if ord(character) > 0xFFFF else 1
        if used + size > limit - 3:
            break
        kept.append(character)
        used += size
    return "".join(kept) + "..."


@dataclasses.dataclass(frozen=True)
class Problem:
    """One refusal: `code` of the spec's list, the request path it concerns and a message for the caller."""

    code: str
    path: str
    message: str

    def json(self) -> dict[str, str]:
        return {"code": self.code, "path": clipped(self.path, PATH_LIMIT), "message": clipped(self.message)}

    def under(self, prefix: str, note: str = "") -> "Problem":
        path = f"{prefix}.{self.path}" if self.path else prefix
        return Problem(self.code, path, f"{note}{self.message}")


class CalcError(Exception):
    """A refused request (exit code 2)."""

    def __init__(self, problems: Sequence[Problem]) -> None:
        super().__init__("; ".join(f"{p.path or '<request>'}: {p.message}" for p in problems))
        self.problems = list(problems)


def refuse(code: str, path: str, message: str) -> CalcError:
    return CalcError([Problem(code, path, message)])


def now() -> datetime:
    return datetime.now(timezone.utc)


def stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def load_json(text: str) -> dict[str, Any]:
    """One JSON object with unique keys, finite numbers and text that UTF-8 can carry (spec §2)."""

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise refuse("json", "", f"The key '{key[:60]}' appears twice in one object.")
            result[key] = value
        return result

    def constant(name: str) -> Any:
        raise refuse("json", "", f"{name} is not a finite number.")

    def number(literal: str) -> float:
        value = float(literal)
        if not math.isfinite(value):
            raise refuse("json", "", f"The number {literal[:40]} is not finite.")
        if value == 0 and nonzero_literal(literal):
            raise refuse("json", "", f"The number {literal[:40]} is too small to represent.")
        return value

    try:
        data = json.loads(text, object_pairs_hook=pairs, parse_constant=constant, parse_float=number)
        # A lone surrogate (an escape such as \\ud800) cannot be written back as UTF-8.
        json.dumps(data, ensure_ascii=False).encode("utf-8")
    except json.JSONDecodeError as error:
        raise refuse(
            "json", "", f"The request is not valid JSON: {error.msg} at line {error.lineno}, column {error.colno}."
        ) from error
    except RecursionError as error:
        raise refuse("json", "", "The request is nested too deeply.") from error
    except UnicodeEncodeError as error:
        raise refuse("json", "", "The request holds a character that is not valid Unicode text (a lone surrogate).") from error
    except ValueError as error:  # An integer literal beyond Python's digit limit.
        raise refuse("json", "", "The request holds a number that is too long to read.") from error
    if not isinstance(data, dict):
        raise refuse("json", "", "The request must be one JSON object.")
    return data


class Reader:
    """Reads the fields of one request object: exact keys, typed values, every problem collected (spec §2).

    With `record` off (the repeated evaluations of a tolerance analysis) the input list is not kept."""

    def __init__(
        self,
        data: dict[str, Any],
        path: str = "",
        problems: list[Problem] | None = None,
        inputs: list[dict[str, Any]] | None = None,
        record: bool = True,
    ) -> None:
        self.data = data
        self.path = path
        self.problems: list[Problem] = [] if problems is None else problems
        self.inputs: list[dict[str, Any]] = [] if inputs is None else inputs
        self.record = record
        self._known: set[str] = set()
        self._children: list[Reader] = []

    def at(self, key: str | int) -> str:
        if key == "":
            return self.path
        return f"{self.path}.{key}" if self.path else str(key)

    def fail(self, code: str, key: str | int, message: str) -> None:
        self.problems.append(Problem(code, self.at(key), message))

    def has(self, key: str) -> bool:
        self._known.add(key)
        return key in self.data

    def mark(self, *keys: str) -> None:
        self._known.update(keys)

    def raw(self, key: str) -> Any:
        self._known.add(key)
        return self.data.get(key, MISSING)

    def forget_input(self) -> None:
        """Drops the record of the quantity read last, when it turns out to be refused."""
        if self.record and self.inputs:
            self.inputs.pop()

    # --- quantities ---------------------------------------------------------------------------------

    def quantity(
        self,
        key: str,
        dimension: str | tuple[str, ...],
        *,
        required: bool = True,
        sign: str = "nonnegative",
        role: str = "plain",
        value: Any = MISSING,
        path: str | None = None,
    ) -> Quantity | None:
        """A quantity of `dimension`. `sign`: nonnegative, positive or any; `role` of a temperature: absolute or
        difference. `value` and `path` read a list item instead of the key."""
        raw = self.raw(key) if value is MISSING else value
        where = self.at(key) if path is None else path
        if raw is MISSING:
            if required:
                self.problems.append(Problem("schema", where, "This field is required."))
            return None
        allowed = (dimension,) if isinstance(dimension, str) else dimension
        try:
            parsed = parse_quantity(raw)
        except QuantityError as error:
            self.problems.append(Problem(error.code, f"{where}.{error.sub}" if error.sub else where, error.message))
            return None
        if parsed.dimension not in allowed:
            expected = " or ".join(NAMES[name] for name in allowed)
            if parsed.bare or (parsed.dimension == "ratio" and "%" not in parsed.given):
                message = f"Expected {expected}; '{parsed.given[:60]}' has no unit."
            else:
                message = f"Expected {expected}; got '{parsed.given[:60]}'."
            self.problems.append(Problem("unit", where, message))
            return None
        si = parsed.scaled
        kind = parsed.dimension
        if kind == "temperature":
            if role == "absolute":
                si = parsed.scaled + ZERO_CELSIUS if parsed.celsius else parsed.scaled
                if si < 0:
                    self.problems.append(Problem("domain", where, f"'{parsed.given}' is below absolute zero."))
                    return None
            else:
                kind = "temperature-difference"
        if sign == "positive" and not si > 0:
            self.problems.append(Problem("domain", where, f"'{parsed.given}' must be greater than zero."))
            return None
        if sign == "nonnegative" and si < 0 and not (parsed.dimension == "temperature" and role == "absolute"):
            self.problems.append(Problem("domain", where, f"'{parsed.given}' must not be negative."))
            return None
        if self.record:
            shown_value, unit = display(si, kind)
            self.inputs.append(
                {
                    "name": where,
                    "given": parsed.given,
                    "value": round_significant(shown_value),
                    "unit": unit,
                    **parsed.metadata(),
                }
            )
        return dataclasses.replace(parsed, si=si)

    def value(self, key: str, dimension: str | tuple[str, ...], **options: Any) -> float | None:
        found = self.quantity(key, dimension, **options)
        return None if found is None else found.si

    def ratio(
        self,
        key: str,
        *,
        required: bool = True,
        low: float = 0.0,
        high: float | None = 1.0,
        low_open: bool = False,
        high_open: bool = False,
    ) -> float | None:
        found = self.quantity(key, "ratio", required=required, sign="any")
        if found is None:
            return None
        value = found.si
        below = value <= low if low_open else value < low
        above = high is not None and (value >= high if high_open else value > high)
        if below or above:
            lower = f"{'above' if low_open else 'at least'} {low:g}"
            upper = "" if high is None else f" and {'below' if high_open else 'at most'} {high:g}"
            self.forget_input()
            self.fail("domain", key, f"'{found.given}' must be {lower}{upper}.")
            return None
        return value

    def quantities(
        self, key: str, dimension: str, *, low: int, high: int, sign: str = "nonnegative", role: str = "plain"
    ) -> list[Quantity] | None:
        items = self.array(key, low=low, high=high)
        if items is None:
            return None
        found = [
            self.quantity(key, dimension, sign=sign, role=role, value=item, path=self.at(f"{key}.{index}"))
            for index, item in enumerate(items)
        ]
        return None if any(item is None for item in found) else found  # type: ignore[return-value]

    # --- other values -------------------------------------------------------------------------------

    def choice(
        self, key: str, options: Iterable[str], *, required: bool = True, default: str | None = None
    ) -> str | None:
        raw = self.raw(key)
        names = list(options)
        if raw is MISSING:
            if required:
                self.fail("schema", key, f"This field is required: one of {', '.join(names)}.")
            return default
        if not isinstance(raw, str) or raw not in names:
            self.fail("schema", key, f"Use one of {', '.join(names)}.")
            return None
        return raw

    def boolean(self, key: str) -> bool | None:
        raw = self.raw(key)
        if raw is MISSING:
            return None
        if not isinstance(raw, bool):
            self.fail("schema", key, "Use true or false.")
            return None
        return raw

    def integer(self, key: str, *, low: int, high: int, missing: str = "schema", outside: str = "limit") -> int | None:
        raw = self.raw(key)
        if raw is MISSING:
            self.fail(missing, key, "This field is required.")
            return None
        if isinstance(raw, bool) or not isinstance(raw, int):
            self.fail("schema", key, "Use a whole number.")
            return None
        if not low <= raw <= high:
            self.fail(outside, key, f"Use a whole number from {low} to {high}.")
            return None
        return raw

    def text(self, key: str, *, required: bool = True, value: Any = MISSING, path: str | None = None) -> str | None:
        raw = self.raw(key) if value is MISSING else value
        where = self.at(key) if path is None else path
        if raw is MISSING:
            if required:
                self.problems.append(Problem("schema", where, "This field is required."))
            return None
        if not valid_text(raw):
            self.problems.append(Problem("schema", where, TEXT_RULE))
            return None
        return raw

    def obj(self, key: str, *, required: bool = False, value: Any = MISSING, path: str | None = None) -> "Reader | None":
        raw = self.raw(key) if value is MISSING else value
        where = self.at(key) if path is None else path
        if raw is MISSING:
            if required:
                self.problems.append(Problem("schema", where, "This field is required."))
            return None
        if not isinstance(raw, dict):
            self.problems.append(Problem("schema", where, "Use a JSON object."))
            return None
        child = Reader(raw, where, self.problems, self.inputs, self.record)
        self._children.append(child)
        return child

    def array(self, key: str, *, low: int, high: int, required: bool = True) -> list[Any] | None:
        raw = self.raw(key)
        if raw is MISSING:
            if required:
                self.fail("schema", key, "This field is required.")
            return None
        if not isinstance(raw, list):
            self.fail("schema", key, "Use a JSON list.")
            return None
        if not low <= len(raw) <= high:
            self.fail("limit", key, f"Use a list of {low} to {high} items.")
            return None
        return raw

    def objects(self, key: str, *, low: int, high: int) -> list["Reader"] | None:
        items = self.array(key, low=low, high=high)
        if items is None:
            return None
        readers = [self.obj(key, value=item, path=self.at(f"{key}.{index}")) for index, item in enumerate(items)]
        if any(reader is None for reader in readers):
            # The model will not read the valid siblings; their fields are not unknown.
            for reader in readers:
                if reader is not None:
                    reader.mark(*reader.data)
            return None
        return readers  # type: ignore[return-value]

    # --- completion ---------------------------------------------------------------------------------

    def close(self) -> None:
        """Reports the keys no getter asked for, here and in every nested object."""
        for key in self.data:
            if key not in self._known:
                self.fail("schema", key, "Unknown field.")
        self._known.update(self.data)
        for child in self._children:
            child.close()

    def check(self) -> None:
        if self.problems:
            raise CalcError(self.problems)

    def done(self) -> None:
        self.close()
        self.check()


@dataclasses.dataclass(frozen=True)
class Shown:
    """A quantity of a detail table; it is formatted only when the document is written."""

    value: float
    unit: str


def shown(si: float, kind: str) -> Shown:
    value, unit = display(si, kind)
    if not math.isfinite(value):
        raise refuse("domain", "", NOT_FINITE)
    return Shown(value, unit)


def _rendered(node: Any) -> Any:
    if isinstance(node, Shown):
        return quantity_json(node.value, node.unit)
    if isinstance(node, dict):
        return {key: _rendered(value) for key, value in node.items()}
    if isinstance(node, list):
        return [_rendered(value) for value in node]
    return node


class Result:
    """What a model returns: assumptions, formulas, scalar results, detail tables, checks, warnings and limits."""

    def __init__(self, operation: str, model: str | None) -> None:
        self.operation = operation
        self.model = model
        self.inputs: list[dict[str, Any]] = []
        self.assumptions: list[str] = []
        self.formulas: list[str] = []
        self.values: dict[str, tuple[float, str]] = {}
        self.details: dict[str, Any] = {}
        self.checks: list[dict[str, str]] = []
        self.warnings: list[str] = []
        self.limits: list[str] = []

    def add(self, name: str, si: float, kind: str) -> None:
        """A scalar result from its SI value; `kind` is a dimension, `temperature-difference`, `angle` or `decibel`."""
        self.put(name, *display(si, kind))

    def put(self, name: str, value: float, unit: str) -> None:
        """A scalar result already in its result unit. A result that is not finite refuses the request."""
        if not math.isfinite(value):
            raise refuse("domain", "", NOT_FINITE)
        self.values[name] = (value, unit)

    def check(self, identifier: str, status: str, detail: str) -> None:
        self.checks.append({"id": identifier, "status": status, "detail": clipped(detail)})

    def warn(self, message: str) -> None:
        message = clipped(message)
        if message not in self.warnings:
            self.warnings.append(message)

    def body(self) -> dict[str, Any]:
        return {
            "inputs": self.inputs,
            "assumptions": self.assumptions,
            "formulas": self.formulas,
            "results": {name: quantity_json(value, unit) for name, (value, unit) in self.values.items()},
            "details": _rendered(self.details),
            "checks": self.checks,
            "warnings": self.warnings,
            "limits": self.limits,
        }


def header(
    kind: str,
    operation: str,
    model: str | None,
    run_id: str,
    started: datetime,
    status: str,
    request: dict[str, Any] | None,
) -> dict[str, Any]:
    """The leading fields every document shares; `finishedAt` is taken now."""
    document: dict[str, Any] = {
        "format": FORMAT,
        "kind": kind,
        "tool": {"name": TOOL, "version": VERSION},
        "operation": operation,
    }
    if model is not None:
        document["model"] = model
    document.update(runId=run_id, startedAt=stamp(started), finishedAt=stamp(now()), status=status)
    if request is not None:
        document["request"] = request
    return document


def result_document(result: Result, run_id: str, started: datetime, request: dict[str, Any]) -> dict[str, Any]:
    document = header("elec-calc-result", result.operation, result.model, run_id, started, "ok", request)
    document.update(result.body())
    document["artifacts"] = []
    return document


def error_document(
    kind: str,
    operation: str,
    run_id: str,
    started: datetime,
    request: dict[str, Any] | None,
    problems: Sequence[Problem],
) -> dict[str, Any]:
    document = header(kind, operation, None, run_id, started, "error", request)
    document["errors"] = [problem.json() for problem in problems]
    return document


# --- writing a document ---------------------------------------------------------------------------------


def _line(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(", ", ": "))


def _block(value: Any) -> str:
    if isinstance(value, list) and value:
        return "[\n" + ",\n".join(f"    {_line(item)}" for item in value) + "\n  ]"
    if isinstance(value, dict) and value and all(isinstance(item, (dict, list)) for item in value.values()):
        return "{\n" + ",\n".join(f"    {_line(key)}: {_line(item)}" for key, item in value.items()) + "\n  }"
    return _line(value)


def dumps(document: dict[str, Any]) -> str:
    """JSON with one top-level field per line and one list item or map entry per line."""
    fields = [f"  {_line(key)}: {_block(value)}" for key, value in document.items()]
    return "{\n" + ",\n".join(fields) + "\n}\n"


def fitted(document: dict[str, Any], limit: int = STDOUT_LIMIT) -> str:
    """The document as text of at most `limit` UTF-16 units (spec §4).

    Shed in this order, each with a warning: detail tables, the input list, then formulas, assumptions and
    limits (per-calculation results in a report summary); an error list is cut to the problems that fit.
    Results and checks are never dropped, and every text a document repeats from its request is bounded, so
    what remains always fits."""
    text = dumps(document)
    if utf16_length(text) <= limit:
        return text
    document = dict(document)
    warnings = list(document.get("warnings", []))

    def shed(key: str, empty: Any, message: str) -> str:
        document[key] = empty
        warnings.append(message)
        document["warnings"] = warnings
        return dumps(document)

    if "errors" in document:
        problems = list(document["errors"])
        kept = len(problems)
        while utf16_length(text) > limit and kept > 1:
            kept //= 2
            cut = {"code": "limit", "path": "", "message": f"{len(problems) - kept} more problems are not shown."}
            document["errors"] = [*problems[:kept], cut]
            text = dumps(document)
        return text
    if document.get("details"):
        text = shed(
            "details",
            {},
            "The detail tables were left out to keep this document within the output limit; run the request "
            "through `elec-calc report` to get them in report.json.",
        )
    if utf16_length(text) > limit and document.get("inputs"):
        text = shed(
            "inputs",
            [],
            f"The list of {len(document['inputs'])} inputs was left out to keep this document within the output "
            "limit; `elec-calc report` writes it to report.json.",
        )
    if utf16_length(text) > limit and "results" in document:
        for key in ("formulas", "assumptions", "limits"):
            document[key] = []
        warnings.append(
            "Formulas, assumptions and limits were left out to keep this document within the output limit; "
            "`elec-calc report` writes them to report.json."
        )
        document["warnings"] = warnings
        text = dumps(document)
    if utf16_length(text) > limit and document.get("calculations"):
        document["calculations"] = [
            {key: value for key, value in entry.items() if key != "results"} for entry in document["calculations"]
        ]
        warnings.append("The result values were left out of this summary to keep it within the output limit; they are in report.json.")
        document["warnings"] = warnings
        text = dumps(document)
    return text

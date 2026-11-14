"""Dispatch of an operation to its model (spec REQ-DATA-3d15fdfc §5). The model set is finite: a request names a
model, it never supplies an expression."""

from __future__ import annotations

from typing import Any, Callable

from . import electrical, losses, thermal, tolerance
from .contract import NOT_FINITE, Reader, Result, refuse

MODELS: dict[str, dict[str, Callable[[Reader, Result], None]]] = {
    **electrical.MODELS,
    **losses.MODELS,
    **thermal.MODELS,
}
MODEL_OPERATIONS = tuple(MODELS)
OPERATIONS = (*MODEL_OPERATIONS, "tolerance")


def run_model(operation: str, document: dict[str, Any], record: bool = True) -> Result:
    """Validates and computes one `dc`, `divider`, `rc`, `losses` or `thermal` request; refusals raise CalcError.

    `record` off skips the input list (the repeated evaluations of a tolerance analysis)."""
    reader = Reader(document, record=record)
    model = reader.choice("model", MODELS[operation])
    reader.check()
    assert model is not None
    result = Result(operation, model)
    try:
        MODELS[operation][model](reader, result)
    except ArithmeticError as error:
        # Magnitudes beyond floating point: an overflow or a division by an underflowed zero. Other exceptions
        # are programming errors and stay visible.
        raise refuse("domain", "", NOT_FINITE) from error
    result.inputs = reader.inputs
    return result


def run_operation(operation: str, document: dict[str, Any]) -> Result:
    """One calculation of any operation except `report`."""
    if operation != "tolerance":
        return run_model(operation, document)
    try:
        return tolerance.run(document, MODEL_OPERATIONS, run_model)
    except ArithmeticError as error:
        raise refuse("domain", "", NOT_FINITE) from error

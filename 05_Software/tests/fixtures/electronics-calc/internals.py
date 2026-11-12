"""Checks of the plugin's support package that no command line can arrange (test fixture).

Usage: internals.py <scripts folder of the plugin> swap <outside folder>
       internals.py <scripts folder of the plugin> fit
       internals.py <scripts folder of the plugin> escape
       internals.py <scripts folder of the plugin> change <arguments of elec-calc report>

`swap` runs `report.run` in the current working directory and, while the first calculation is computed, puts a
link to <outside folder> where the results directory is going to be: the report must be discarded. This is the
state a command line can only reach by racing a slow report, so the link is made from inside the computation.
`fit` hands `contract.fitted` documents that are too long and prints what it left out.
`escape` lets `os.path.realpath` resolve a link in the current working directory to names a Linux file system
may hold (quotation marks, control characters) and prints which of them `report.read_input`'s path check admits,
with the UTF-16 length of the admitted relative path as JSON writes it.
Each of these prints one JSON object.
`change` runs the real command line (`cli.main`) with the given arguments and, while the first calculation is
computed, appends a space to the `--input` file: whenever the run reads it first, it reads it again after the
computation, so the report must be discarded. It prints what the command line prints and exits with its code.
"""

import json
import os
import sys

sys.dont_write_bytecode = True  # The plugin folder is the repository's source tree.
sys.path.insert(0, sys.argv[1])

from pathlib import Path  # noqa: E402

from elec_support import cli, contract, engine, report  # noqa: E402
from elec_support.workspace import utf16_length  # noqa: E402

QUANTITY = {"value": 1.0, "unit": "V", "text": "1.000 V"}
REQUEST = {"origin": "inline", "sha256": "0" * 64}


def swap(outside: str) -> dict[str, object]:
    cwd = Path(os.path.realpath(os.getcwd()))
    results = report.results_directory(cwd, report.DEFAULT_RESULTS)
    linked: list[bool] = []

    def evaluate(operation: str, body: dict) -> contract.Result:
        if not linked:
            if os.name == "nt":
                import _winapi

                _winapi.CreateJunction(outside, str(results))
            else:
                os.symlink(outside, results, target_is_directory=True)
            linked.append(True)
        return engine.run_operation(operation, body)

    document = {
        "title": "Swapped results directory",
        "calculations": [{"id": "a", "operation": "dc", "input": {"model": "ohm", "voltage": "5 V", "current": "1 A"}}],
    }
    failure = None
    try:
        report.run(
            document,
            cwd=cwd,
            results_dir=results,
            run_id="r1",
            started=contract.now(),
            request=REQUEST,
            operations=engine.OPERATIONS,
            evaluate=evaluate,
            unchanged=lambda: True,
            finished=contract.now,
        )
    except report.OutputFailure as error:
        failure = str(error)
    return {"failure": failure, "outside": sorted(os.listdir(outside)), "here": sorted(os.listdir(cwd))}


def fit() -> dict[str, object]:
    # The largest result a tolerance run can have (78 entries) with long request text everywhere it may appear.
    header = contract.header(
        "elec-calc-result", "tolerance", None, "r" * 64, contract.now(), "ok", {**REQUEST, "origin": "file", "path": "p" * 1024}
    )
    large = {
        **header,
        "inputs": [{"name": "vin", "given": "5 V", "value": 5.0, "unit": "V"}],
        "assumptions": ["a" * 300] * 6,
        "formulas": ["f" * 100] * 12,
        "results": {f"output{index}.sampleMaximum": QUANTITY for index in range(78)},
        "details": {"table": [QUANTITY] * 10},
        "checks": [{"id": "monotonic", "status": "fail", "detail": "d" * 600}],
        "warnings": ["w" * 300, "x" * 300],
        "limits": ["l" * 300] * 6,
        "artifacts": [],
    }
    text = contract.fitted(large)
    printed = json.loads(text)
    # Characters beyond the Basic Multilingual Plane count twice for the runner.
    emoji = "\U0001f600" * 500
    wide = {
        **contract.header("elec-calc-result", "thermal", "junction-ambient", "r1", contract.now(), "ok", REQUEST),
        "inputs": [
            {"name": f"q{index}", "given": "1 V", "value": 1.0, "unit": "V", "source": emoji, "conditions": emoji, "note": emoji}
            for index in range(4)
        ],
        "assumptions": ["a"],
        "formulas": ["f"],
        "results": {"tJunction": QUANTITY},
        "details": {},
        "checks": [],
        "warnings": [],
        "limits": ["l"],
        "artifacts": [],
    }
    wide_text = contract.fitted(wide)
    cut = contract.clipped("\U0001f600" * 400, 600)
    return {
        "limit": contract.STDOUT_LIMIT,
        "units": utf16_length(text),
        "results": len(printed["results"]),
        "checks": len(printed["checks"]),
        "emptied": [key for key in ("details", "inputs", "formulas", "assumptions", "limits") if not printed[key]],
        "warnings": printed["warnings"],
        "wideUnits": utf16_length(wide_text),
        "wideInputs": len(json.loads(wide_text)["inputs"]),
        "clippedUnits": utf16_length(cut),
        "clippedEnd": cut[-3:],
    }


def escape() -> dict[str, object]:
    cwd = Path(os.path.realpath(os.getcwd()))
    names = {"plain": "p" * 1024, "quotes": '"' * 512, "longQuotes": '"' * 600, "control": "ab"}
    real = os.path.realpath
    outcome: dict[str, object] = {}
    for key, name in names.items():
        os.path.realpath = lambda path, *args, name=name, **kwargs: str(cwd / name)  # type: ignore[assignment]
        try:
            resolved = report._confined(cwd, "link", "--input")
        except contract.CalcError as error:
            assert [problem.code for problem in error.problems] == ["path"], error.problems
            outcome[key] = {"admitted": False}
        else:
            shown = json.dumps(report._relative(cwd, resolved), ensure_ascii=False)[1:-1]
            outcome[key] = {"admitted": True, "units": utf16_length(shown)}
        finally:
            os.path.realpath = real
    return outcome


def change(arguments: list[str]) -> int:
    request = Path(arguments[arguments.index("--input") + 1])
    original = engine.run_operation
    changed: list[bool] = []

    def evaluate(operation: str, body: dict) -> contract.Result:
        if not changed:
            request.write_bytes(request.read_bytes() + b" ")
            changed.append(True)
        return original(operation, body)

    engine.run_operation = evaluate  # type: ignore[assignment]
    return cli.main(arguments)


if sys.argv[2] == "change":
    sys.exit(change(sys.argv[3:]))
COMMANDS = {"swap": lambda: swap(sys.argv[3]), "fit": fit, "escape": escape}
print(json.dumps(COMMANDS[sys.argv[2]]()))

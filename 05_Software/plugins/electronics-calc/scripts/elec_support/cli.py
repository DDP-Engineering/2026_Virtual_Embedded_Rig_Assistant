"""Command line of `elec-calc` (spec REQ-DATA-3d15fdfc §1). Exit codes: 0 result, 2 refused, 3 input/output failure."""

from __future__ import annotations

import argparse
import hashlib
import os
import secrets
import sys
from pathlib import Path
from typing import Any

from . import TOOL, VERSION, contract, engine, report, workspace

DESCRIPTION = """Deterministic electrical and thermal calculations with units, assumptions and limits.

Every operation reads one JSON request (--json TEXT or --input FILE) and prints one JSON result document.
`elec-calc <operation> --help` lists the models of an operation and their fields.
"""
OPERATION_HELP = {
    "dc": "Ohm's law and power; series, parallel and shunt resistors",
    "divider": "loaded resistive divider and resistor sizing",
    "rc": "RC time constant, first-order filter, peak/RMS/average of a waveform",
    "losses": "regulator, resistor, MOSFET, diode, capacitor and inductor losses; power budget",
    "thermal": "junction temperature from thetaJA, a heatsink path or a Foster network",
    "tolerance": "worst-case corners and seeded Monte Carlo over one of the operations above",
    "report": "run a list of calculations and write report.json and report.md into a new run folder",
}
QUANTITY = """
A quantity is "<number> <unit>" such as "3.3 V", "50 mOhm", "100 nF", "40 °C", or
{"value": 50, "unit": "K/W", "source"?: text, "conditions"?: text, "note"?: text}.
Prefixes f p n u m k M G are case-sensitive; a ratio is a number (0.25) or a percentage ("25 %").
A field marked ? is optional.
"""
CURRENT = """
A current is one of:
  {"rms": Q, "average"?: Q}                         values over the whole period
  {"dc": Q}                                         constant current
  {"shape": "pulse", "peak": Q, "duty": ratio}      rectangular pulses from 0 to the peak
  {"shape": "sine"|"triangle"|"square", "peak": Q}  symmetric about zero
A duty cycle belongs to a peak only; with rms or dc it is refused.
"""
FIELDS = {
    "dc": """
Request: {"model": <model>, <fields>}

  ohm       exactly two of voltage, current, resistance, power; signal? "dc" | "rms"
  series    resistances [1..64]; voltage? or current?; signal? "dc" | "rms"
  parallel  resistances [1..64]; voltage? or current? (total); signal? "dc" | "rms"
  shunt     resistance, current; gain? (ratio); ratedPower?
""",
    "divider": """
Request: {"model": "resistive", <fields>}

  resistive  vin, rTop, rBottom; rLoad? (across the bottom resistor);
             solveFor? "vout" (default) | "rTop" | "rBottom" - a solve mode takes the target vout
             and leaves the solved resistor out
""",
    "rc": """
Request: {"model": <model>, <fields>}

  time-constant  resistance, capacitance; step response: vInitial, vFinal and one of time, vTarget
  filter         type "lowpass" | "highpass", resistance, capacitance, frequency;
                 amplitude? (voltage) with amplitudeKind "peak" | "rms" | "peak-to-peak"
  waveform       shape "sine" | "square" | "triangle" | "pulse" | "dc";
                 exactly one of peak, rms, average (voltage or current); duty (pulse only)
""",
    "losses": """
Request: {"model": <model>, <fields>}

  linear-regulator  vin, vout, iout; iq or neglectIq: true (exactly one); dropout?
  resistor          resistance; current (descriptor) or voltageRms; ratedPower?;
                    derating? {fullPowerUpTo, zeroPowerAt} with tAmbient
  mosfet            current (descriptor), rdsOn; frequency?;
                    switching? {method: "energy", eOn, eOff}
                             | {method: "linear-overlap", vds, id, tRise, tFall};
                    gateDrive? {qg, vDrive}
  diode             vf, current (descriptor with an average); rd?; qrr, vr, frequency (all or none)
  capacitor         esr, current (descriptor)
  inductor          dcr, current (descriptor); coreLoss?
  power-budget      loads [1..64 {name, power | voltage and current}]; efficiency? (ratio);
                    sourceVoltage? (needs efficiency)
"""
    + CURRENT,
    "thermal": """
Request: {"model": <model>, <fields>}

  junction-ambient    power, tAmbient, thetaJA; tJunctionMax?
  junction-case-sink  power, tAmbient, thetaJC; thetaCS and thetaSA, or thetaCA; tJunctionMax?;
                      solveFor? "thetaSA" (needs tJunctionMax and thetaCS, no thetaSA)
  foster              power, tReference, stages [1..16 {resistance, tau | capacitance}], times [1..64]

thetaJA is never combined with thetaJC, thetaCS, thetaSA or thetaCA.
""",
    "tolerance": """
Request:
  target       {operation: "dc" | "divider" | "rc" | "losses" | "thermal", input: <that request>}
  outputs      [1..6 result names of the target]
  parameters   {<dot path into target.input, such as rTop, current.peak, resistances.0>:
                  {tolerance (ratio) | min and max; distribution? "uniform" | "normal"; sigmas?}}   1..12
  monteCarlo?  {samples 100..100000, seed 0..2^63-1}; then every parameter needs a distribution,
               and a normal one its sigmas
  limits?      {<output>: {min?, max?}}   with monteCarlo: the fraction of samples inside

The corners are always evaluated; a temperature parameter takes min and max, not a tolerance.
""",
    "report": """
Request:
  title         text
  notes?        [0..16 texts]
  calculations  [1..32 {id (lower-case letters, digits, hyphens), operation, input, note?}]

Writes <results-dir>/<run-id>/report.json and report.md; the run folder must not exist.
The calculations of one report run at most 1000000 Monte Carlo samples in total.
""",
}


class _Once(argparse.Action):
    """Stores one value and refuses the option a second time."""

    def __call__(self, parser, namespace, values, option_string=None):  # type: ignore[no-untyped-def]
        if getattr(namespace, f"_seen_{self.dest}", False):
            parser.error(f"{option_string} was given more than once")
        setattr(namespace, f"_seen_{self.dest}", True)
        setattr(namespace, self.dest, values)


def _run_id(value: str) -> str:
    if not report.valid_run_id(value):
        raise argparse.ArgumentTypeError(
            "use 1..64 letters, digits, '.', '_' or '-', starting and ending with a letter or digit; "
            "device names such as NUL are not accepted"
        )
    return value


def _parser() -> argparse.ArgumentParser:
    formatter = argparse.RawDescriptionHelpFormatter
    parser = argparse.ArgumentParser(prog=TOOL, description=DESCRIPTION, allow_abbrev=False, formatter_class=formatter)
    parser.add_argument("--version", action="version", version=f"{TOOL} {VERSION}")
    commands = parser.add_subparsers(dest="operation", metavar="operation", required=True)
    for name, text in OPERATION_HELP.items():
        command = commands.add_parser(
            name,
            help=text,
            description=text,
            epilog=FIELDS[name] + QUANTITY,
            allow_abbrev=False,
            formatter_class=formatter,
        )
        source = command.add_mutually_exclusive_group(required=True)
        source.add_argument("--json", action=_Once, metavar="TEXT", help="the request as one JSON object")
        source.add_argument(
            "--input", action=_Once, metavar="FILE", help="a UTF-8 JSON request file inside the working directory"
        )
        command.add_argument(
            "--run-id",
            action=_Once,
            type=_run_id,
            metavar="ID",
            help="identifier of this run (default: UTC time and random hex)",
        )
        if name == "report":
            command.add_argument(
                "--results-dir",
                action=_Once,
                default=report.DEFAULT_RESULTS,
                metavar="DIR",
                help=f"folder for run folders, inside the working directory (default: {report.DEFAULT_RESULTS})",
            )
    return parser


_entered_directory = workspace.entered_directory  # The rule lives in the shared path module.


def _emit(document: dict[str, Any]) -> None:
    sys.stdout.write(contract.fitted(document))
    sys.stdout.flush()


def main(argv: list[str]) -> int:
    # The document is UTF-8 with LF line ends whatever the console code page or platform.
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")  # type: ignore[union-attr]
    args = _parser().parse_args(argv)
    started = contract.now()
    operation: str = args.operation
    run_id: str = args.run_id or f"{started.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}"
    kind = "elec-calc-report-summary" if operation == "report" else "elec-calc-result"
    spelled = _entered_directory()
    cwd = Path(os.path.realpath(spelled))
    request: dict[str, Any] | None = None
    try:
        results_dir = report.results_directory(cwd, args.results_dir, spelled) if operation == "report" else None
        if args.input is not None:
            data, relative = report.read_input(cwd, args.input, spelled)
            request = {"origin": "file", "path": relative, "sha256": hashlib.sha256(data).hexdigest()}
        else:
            # The exact argument bytes: UTF-8 on Windows, the original bytes elsewhere.
            data = os.fsencode(args.json)
            request = {"origin": "inline", "sha256": hashlib.sha256(data).hexdigest()}
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as error:
            raise contract.refuse("json", "", "The request is not UTF-8 text.") from error
        document = contract.load_json(text.removeprefix("﻿"))
        if operation != "report":
            result = engine.run_operation(operation, document)
            _emit(contract.result_document(result, run_id, started, request))
            return 0
        assert results_dir is not None
        digest = request["sha256"]

        def unchanged() -> bool:
            if args.input is None:
                return True
            try:
                return hashlib.sha256(report.read_input(cwd, args.input, spelled)[0]).hexdigest() == digest
            except contract.CalcError:
                return False

        summary = report.run(
            document,
            cwd=cwd,
            results_dir=results_dir,
            run_id=run_id,
            started=started,
            request=request,
            operations=engine.OPERATIONS,
            evaluate=engine.run_operation,
            unchanged=unchanged,
            finished=contract.now,
        )
        output = contract.header(kind, operation, None, run_id, started, "ok", request)
        output.update(summary)
        _emit(output)
        return 0
    except contract.CalcError as error:
        _emit(contract.error_document(kind, operation, run_id, started, request, error.problems))
        return 2
    except report.OutputFailure as error:
        _emit(contract.error_document(kind, operation, run_id, started, request, [error.problem]))
        return 3

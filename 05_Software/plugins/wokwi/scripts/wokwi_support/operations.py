"""The offline operations of wokwi-tool: capabilities, inspect-project, validate-diagram and prepare-job (spec
REQ-DATA-d985bb3d sections 3-5)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from . import CLI_SHA, CLI_VERSION, ENDPOINT, USAGE, diagram, engine, job as jobs, project, scenario, workspace
from .report import Ended, Refused, check_run_id, new_run_id, problem, refused, run_folder

REFERENCE = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?")
TEXT_LIMIT = 256


def capabilities(_args: Any, document: dict[str, Any], _cwd: Path, _spelled: Path) -> None:
    cli = engine.executable()
    document.update({
        "cli": {**engine.check_version(cli), "pinned": {"version": CLI_VERSION, "sha": CLI_SHA}},
        "endpoint": ENDPOINT,
        "firmwareForms": [*project.FORMS.values(), "esp-idf-flasher-args"],
        "scenarioCommands": list(scenario.SUPPORTED),
        "unsupportedScenarioCommands": list(scenario.UNSUPPORTED),
        "boardPrefixes": list(diagram.BOARD_PREFIXES),
        "limits": {
            "virtualTimeoutMs": list(jobs.VIRTUAL_RANGE),
            "realBudgetS": list(jobs.REAL_RANGE),
            "fileBytes": project.FILE_LIMIT,
            "totalBytes": project.TOTAL_LIMIT,
            "serialLogBytes": 16 * 1024 * 1024,
            "attempts": 1,
        },
        "usage": USAGE,
    })


def inspect_project(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> None:
    """Facts and problems of a project; refuses only a path it may not read (REQ-FUNC-447f33d6)."""
    folder = project.project_folder(cwd, spelled, args.project)
    facts: dict[str, Any] = {"path": workspace.relative(cwd, folder), "candidates": project.candidates(cwd, folder)}
    problems: list[dict[str, Any]] = []
    try:
        found = project.inputs(cwd, spelled, folder, args.firmware, args.elf)
        facts.update({"config": found["config"], "firmware": found["firmware"], "elf": found["elf"] if found["elf"] is not found["firmware"] else None, "buildMatch": found["buildMatch"]})
    except Refused as error:
        problems += project.problems_of(error)
        try:
            facts["config"] = project.load_config(folder)
        except Refused:
            facts["config"] = None
    diagram_path = folder / "diagram.json"
    if diagram_path.is_file():
        found_diagram = diagram.structure(diagram_path)
        facts["diagram"] = {"path": workspace.relative(cwd, diagram_path), "parts": found_diagram["parts"], "boards": found_diagram["boards"], "issues": found_diagram["issues"]}
        if len(found_diagram["boards"]) != 1:
            problems.append(problem("unsupported-input", f"The diagram has {len(found_diagram['boards'])} boards; a job needs exactly one."))
    else:
        problems.append(problem("diagram-missing", "The project has no diagram.json."))
    facts["scenarios"] = sorted(workspace.relative(cwd, path) for path in folder.glob("*.yaml"))[:20]
    document["project"] = facts
    document["errors"] = problems
    if problems:
        document["status"] = "fail"


def validate_diagram(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> None:
    path = diagram.locate(cwd, spelled, args.diagram)
    found = diagram.validate(cwd, path, engine.executable())
    document["diagram"] = found
    if found["errors"]:
        document["status"] = "fail"
        document["errors"] = [problem("diagram-invalid", f"{found['errors']} error(s) in {found['path']}.")]


def _text(value: str | None, option: str) -> str | None:
    if value is None:
        return None
    if not 1 <= len(value) <= TEXT_LIMIT or any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise refused("usage", f"{option} takes 1-{TEXT_LIMIT} characters without control characters.")
    return value


def prepare_job(args: Any, document: dict[str, Any], cwd: Path, spelled: Path) -> None:
    """Every input checked, then a new run folder of exact copies (REQ-DATA-14b295ed); the project is not changed."""
    check_run_id(args.run_id)
    if not REFERENCE.fullmatch(args.account or ""):
        raise refused("usage", "--account takes the Wokwi token reference: 1-64 lowercase letters, digits and dashes.")
    low, high = jobs.VIRTUAL_RANGE
    if not low <= args.virtual_timeout_ms <= high:
        raise refused("usage", f"--virtual-timeout-ms takes {low}-{high} simulated milliseconds.")
    budget = args.real_budget_s if args.real_budget_s is not None else jobs.default_budget(args.virtual_timeout_ms)
    if not jobs.REAL_RANGE[0] <= budget <= jobs.REAL_RANGE[1]:
        raise refused("usage", f"--real-budget-s takes {jobs.REAL_RANGE[0]}-{jobs.REAL_RANGE[1]} seconds.")
    expect_text = _text(args.expect_text, "--expect-text")
    fail_text = _text(args.fail_text, "--fail-text")
    if (args.screenshot_part is None) != (args.screenshot_ms is None):
        raise refused("usage", "--screenshot-part and --screenshot-ms go together.")
    if args.screenshot_ms is not None and not 0 <= args.screenshot_ms <= args.virtual_timeout_ms:
        raise refused("usage", "--screenshot-ms must lie within the virtual timeout.")
    if args.scenario is None and expect_text is None:
        raise refused("assertion-missing", "A job needs --scenario or --expect-text: without one, it could only end by timeout.")
    if args.scenario is not None and expect_text is not None:
        raise refused("unsupported-input", "Use --scenario or --expect-text, not both: wokwi-cli ends the run at whichever finishes first.", input="--scenario with --expect-text")
    folder = project.project_folder(cwd, spelled, args.project)
    found = project.inputs(cwd, spelled, folder, args.firmware, args.elf)
    diagram_path = diagram.locate(cwd, spelled, args.diagram) if args.diagram else folder / "diagram.json"
    if not diagram_path.is_file():
        raise refused("diagram-missing", "The project has no diagram.json; name one with --diagram.")
    try:
        diagram_path = workspace.regular_file(cwd, str(diagram_path), "--diagram", spelled)
    except workspace.PathRefused as error:
        raise refused("path", str(error)) from error
    # Hashed before it is checked: job.write copies exactly these bytes or refuses.
    diagram_sha = project.sha256_file(diagram_path)
    structure = diagram.structure(diagram_path)
    if len(structure["boards"]) != 1 and not structure["issues"]:
        raise refused("unsupported-input", f"The diagram has {len(structure['boards'])} boards; a job needs exactly one.", input="diagram boards")
    part_ids = {part["id"] for part in structure["parts"]}
    loaded = scenario.load(cwd, spelled, args.scenario, part_ids) if args.scenario is not None else None
    if args.screenshot_part is not None and args.screenshot_part not in part_ids:
        raise refused("usage", f"--screenshot-part {args.screenshot_part[:80]} is not a part of the diagram.")
    checked = diagram.validate(cwd, diagram_path, engine.executable())
    if checked["errors"]:
        raise Refused([problem("diagram-invalid", f"{checked['errors']} error(s) in {checked['path']}; run validate-diagram for the list.")], diagram=checked)
    if len(structure["boards"]) != 1:
        raise refused("unsupported-input", f"The diagram has {len(structure['boards'])} boards; a job needs exactly one.", input="diagram boards")
    run_id = args.run_id or new_run_id("prepare-job")
    run = run_folder(cwd, spelled, args.results_dir, run_id)
    plan = {
        "account": args.account,
        "project": workspace.relative(cwd, folder),
        "board": structure["boards"][0],
        "firmware": found["firmware"],
        "elf": found["elf"],
        "buildMatch": found["buildMatch"],
        "diagramPath": diagram_path,
        "diagramSha256": diagram_sha,
        "scenario": loaded,
        "expectText": expect_text,
        "failText": fail_text,
        "virtualTimeoutMs": args.virtual_timeout_ms,
        "realBudgetS": budget,
        "vcd": bool(args.vcd),
        "screenshot": {"part": args.screenshot_part, "ms": args.screenshot_ms} if args.screenshot_part is not None else None,
    }
    try:
        job = jobs.write(cwd, run, plan)
    except (OSError, Refused) as error:
        raise Ended("error", "job-write-failed", f"The job folder {workspace.relative(cwd, run)} could not be written: {error}") from error
    if loaded is not None and loaded["delayNs"] > args.virtual_timeout_ms * 1_000_000:
        document["warnings"].append(problem("delay-exceeds-timeout", "The scenario's delays add up to more than the virtual timeout; it will end virtual-timeout."))
    document.update({"runId": run_id, "jobPath": workspace.relative(cwd, run / "job.json"), "job": job})

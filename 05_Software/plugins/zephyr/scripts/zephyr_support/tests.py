"""test-build through Twister (build-only) and test-run from a real execution record (spec REQ-DATA-d8ecee6a
sections 3 and 7, REQ-FUNC-889949fc, REQ-FUNC-36e3ecdd, REQ-FUNC-ba432613).

Twister only builds here. Whatever status Twister gives a build-only suite, its cases are `not-run` and the run is
`incomplete` with evidence `build-only`. A verdict exists only through test-run, from a renode-sim run (virtual) or a
HIL run (hardware) of exactly the ELF the test build made.
"""

from __future__ import annotations

import json
import sys
import re
from pathlib import Path
from typing import Any
from xml.sax.saxutils import quoteattr

from . import builddir, environment, ztest
from .errors import Refused
from .ops import context, describe, evidence_run, module_folders, posix, require_clean
from .result import Run, sha256

NOT_COVERED_VIRTUAL = [
    "peripherals the virtual profile does not model, and the board's other hardware",
    "real electrical timing, clock accuracy and interrupt latency of the real chip",
    "power consumption, EMI and the analog circuit around the microcontroller",
]


def junit(path: Path, name: str, suites: list[dict[str, Any]]) -> None:
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', f"<testsuites name={quoteattr(name)}>"]
    for suite in suites:
        cases = suite.get("cases", [])
        failures = sum(1 for case in cases if case["status"] == "fail")
        skipped = sum(1 for case in cases if case["status"] != "pass" and case["status"] != "fail")
        parts.append(f"  <testsuite name={quoteattr(suite['scenario'])} tests=\"{len(cases)}\" failures=\"{failures}\" skipped=\"{skipped}\">")
        for case in cases:
            parts.append(f"    <testcase classname={quoteattr(suite['scenario'])} name={quoteattr(case['name'])}>")
            if case["status"] == "fail":
                parts.append("      <failure message=\"failed\"/>")
            elif case["status"] != "pass":
                parts.append(f"      <skipped message={quoteattr(case['status'] + (': ' + case['reason'] if case.get('reason') else ''))}/>")
            parts.append("    </testcase>")
        parts.append("  </testsuite>")
    parts.append("</testsuites>")
    path.write_text("\n".join(parts) + "\n", encoding="utf-8")


def _twister_command(ctx: Any, outdir: Path) -> list[str]:
    request = ctx.request
    script = ctx.workspace.zephyr / "scripts" / "twister"
    command = [sys.executable, str(script), "--build-only", "-T", posix(request.tests_root), "-p", request.board,
               "--outdir", posix(outdir), "--clobber-output", "-v", "--inline-logs",
               "-x", f"ZEPHYR_MODULES={';'.join(posix(p) for p in module_folders(ctx))}"]
    for scenario in request.scenarios:
        command += ["-s", scenario]
    return command


def _suites(outdir: Path, request: Any) -> list[dict[str, Any]]:
    try:
        data = json.loads((outdir / "twister.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    found: list[dict[str, Any]] = []
    for suite in data.get("testsuites", []) if isinstance(data, dict) else []:
        name = str(suite.get("name", ""))
        scenario = next((s for s in request.scenarios if name == s or name.endswith("/" + s) or name.endswith("." + s)), None)
        if scenario is None:
            continue
        status = str(suite.get("status", ""))
        built = status not in ("error", "failed", "filtered", "skipped", "")
        elf_entry = None
        for candidate in sorted(outdir.rglob("zephyr.elf")):
            if candidate.parent.name == "zephyr" and candidate.parent.parent.name == scenario:
                elf_entry = {"path": str(candidate), "sha256": sha256(candidate), "size": candidate.stat().st_size}
                break
        cases = [{"name": str(case.get("identifier", "")), "status": "not-run", "twister": case.get("status")}
                 for case in suite.get("testcases", []) if isinstance(case, dict)]
        found.append({"scenario": scenario, "id": name, "platform": suite.get("platform"),
                      "status": "built" if built and elf_entry else ("filtered" if status == "filtered" else "build-error"),
                      "twister": status, "reason": suite.get("reason"), "elf": elf_entry, "cases": cases})
    return found


def test_build(cwd: Path, spelled: Path, raw: str, pristine: bool, results: str | None) -> int:
    ctx = context(cwd, spelled, raw, "test-build")
    require_clean(ctx)
    builddir.precheck(ctx.request, "test-build", pristine)
    run = Run("test-build", "build-only")
    run.document.update(describe(ctx))
    run.create_folder(cwd, spelled, results)
    assert run.folder is not None and ctx.sdk is not None
    builddir.claim(ctx.request, "test-build", pristine, run["runId"])
    builddir.mark_running(ctx.request, run["runId"])
    env = environment.build(run.folder, ctx.workspace.zephyr)
    env["ZEPHYR_TOOLCHAIN_VARIANT"] = "zephyr"
    env["ZEPHYR_SDK_INSTALL_DIR"] = str(ctx.sdk.path)
    outdir = ctx.request.build_dir / "twister"
    code, log = run.step("twister", _twister_command(ctx, outdir), ctx.request.tests_root, env)
    suites = _suites(outdir, ctx.request)
    for suite in suites:
        for case in suite["cases"]:
            case["reason"] = "build-only: not executed"
    run["tests"] = suites
    from . import diagnostics  # noqa: PLC0415

    run["diagnostics"] = diagnostics.analyse(log)
    missing = [s for s in ctx.request.scenarios if s not in {suite["scenario"] for suite in suites}]
    if code != 0 or any(suite["status"] == "build-error" for suite in suites):
        run.set_status("fail", "build-failed", f"Twister exited {code}; see twister.log and the suites' status.")
    elif missing:
        run.set_status("error", "scenario-missing", f"Twister reported no result for {', '.join(missing)}.")
    else:
        run.set_status("incomplete", "build-only", "Built only: no test case was executed, so none passed.")
    junit(run.folder / "junit.xml", "zephyr test-build", suites)
    builddir.record(ctx.request, run["runId"], "pass" if run["code"] == "build-only" else run["status"], [])
    exit_code = run.finish({"tests": [{k: s.get(k) for k in ("scenario", "status", "twister", "elf")} for s in suites]})
    return 0 if run["code"] == "build-only" else exit_code


def _config_value(config: Path, name: str) -> str | None:
    try:
        for line in config.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        return None
    return None


def differences(board: dict[str, Any] | None, elf_path: Path | None, folder: Path, document: dict[str, Any]) -> list[dict[str, Any]]:
    """What differs between the build's target and the execution's model or setup (REQ-FUNC-ba432613)."""
    found: list[dict[str, Any]] = []
    target = (board or {}).get("target")
    if document.get("kind") == "renode-result":
        profile = document.get("profile") or {}
        profile_id = profile.get("id") if isinstance(profile, dict) else profile
        found.append({"kind": "target", "detail": f"Built for {target}; executed on the virtual profile {profile_id}."})
        configured = _config_value(elf_path.parent / ".config", "CONFIG_SYS_CLOCK_HW_CYCLES_PER_SEC") if elf_path else None
        model = None
        for repl in sorted((folder / "profile").glob("*.repl")):
            match = re.search(r"systickFrequency:\s*(\d+)", repl.read_text(encoding="utf-8", errors="replace"))
            if match:
                model = match.group(1)
        if configured and model and configured != model:
            ratio = int(model) / int(configured)
            found.append({"kind": "clock", "firmware": int(configured), "model": int(model),
                          "detail": f"The firmware assumes a {int(configured)} Hz SysTick clock, the model runs it at "
                          f"{int(model)} Hz: kernel time advances {ratio:.2f}x of virtual time."})
        for access in document.get("unmodeled") or []:
            if isinstance(access, dict):
                found.append({"kind": "unmodeled", "address": access.get("address"), "access": access.get("access"),
                              "detail": f"{access.get('access')} of {access.get('address')} has no model; the firmware "
                              "continued without the register's effect."})
    elif document.get("kind") == "hil-test-result":
        setup = document.get("setup") or {}
        found.append({"kind": "target", "detail": f"Built for {target}; executed on the HIL board {setup.get('board')} "
                      f"revision {setup.get('revision')}."})
    return found


def _uart_text(folder: Path, document: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    """The console text of an execution record, its evidence class and its setup."""
    if document.get("kind") == "renode-result":
        uart = document.get("uart") or {}
        lines = [str(line.get("text", "")) for line in uart.get("lines") or [] if isinstance(line, dict)]
        name = uart.get("file") or uart.get("log")
        if isinstance(name, str) and (folder / name).is_file():
            text = (folder / name).read_text(encoding="utf-8", errors="replace")
        else:
            text = "\n".join(lines)
        profile = document.get("profile") or {}
        return text, "virtual", {"profile": profile.get("id") if isinstance(profile, dict) else profile,
                                 "engine": document.get("engine")}
    if document.get("kind") == "hil-test-result":
        texts: list[str] = []
        for log in sorted((folder / "steps").glob("*.log")):
            texts.append(log.read_text(encoding="utf-8", errors="replace"))
        return "\n".join(texts), "hardware", {"setup": document.get("setup")}
    raise Refused("evidence", "The evidence run is neither a renode-sim nor a HIL run.")


def test_run(cwd: Path, spelled: Path, build_raw: str, scenario: str, evidence_raw: str, results: str | None) -> int:
    _, build_doc = evidence_run(cwd, build_raw)
    if build_doc.get("kind") != "zephyr-result" or build_doc.get("operation") != "test-build":
        raise Refused("evidence", "--test-build must name a zephyr test-build run.")
    suite = next((s for s in build_doc.get("tests") or [] if s.get("scenario") == scenario), None)
    if suite is None or not suite.get("elf"):
        raise Refused("evidence", f"The test-build run has no built scenario {scenario}.")
    folder, document = evidence_run(cwd, evidence_raw)
    firmware = document.get("firmware") or {}
    if firmware.get("sha256") != suite["elf"]["sha256"]:
        raise Refused("evidence-mismatch", f"The evidence run executed firmware {str(firmware.get('sha256'))[:16]}..., "
                      f"not the ELF of {scenario} ({suite['elf']['sha256'][:16]}...).")
    text, evidence, setup = _uart_text(folder, document)
    run = Run("test-run", evidence)
    run["board"] = build_doc.get("board")
    run["testBuild"] = {"runId": build_doc.get("runId"), "scenario": scenario, "elf": suite["elf"]}
    run["execution"] = {"runId": document.get("runId"), "kind": document.get("kind"), "status": document.get("status"),
                        "folder": str(folder), **setup}
    run.create_folder(cwd, spelled, results)
    assert run.folder is not None
    parsed = ztest.parse(text)
    expected = [case["name"] for case in suite.get("cases") or []]
    status, code, cases = ztest.verdict(parsed, expected)
    # An unmodeled register makes a virtual run incomplete; that is a declared difference, not a test outcome.
    if document.get("status") in ("stopped", "error", "blocked", "timeout") and status == "pass":
        status, code = "incomplete", "execution-" + str(document.get("status"))
    run.set_status(status, code, None if status == "pass" else f"ztest outcome {code}; end marker {parsed.end or 'missing'}.")
    run["tests"] = [{"scenario": scenario, "status": status, "end": parsed.end,
                     "cases": [{"name": name, "status": value} for name, value in cases.items()]}]
    run["coverage"] = {"evidence": evidence, "board": (build_doc.get("board") or {}).get("target"), **setup,
                       "notCovered": NOT_COVERED_VIRTUAL if evidence == "virtual" else [],
                       "statement": "Virtual evidence: the firmware ran on a simulated model, not on the board."
                       if evidence == "virtual" else "Hardware evidence from the HIL run's serial capture."}
    run["differences"] = differences(build_doc.get("board"), Path(suite["elf"]["path"]), folder, document)
    junit(run.folder / "junit.xml", "zephyr test-run", run["tests"])
    return run.finish({"tests": run["tests"], "coverage": {k: run["coverage"][k] for k in ("evidence", "board")},
                       "differences": [d["detail"] for d in run["differences"]][:8]})


def differences_op(cwd: Path, spelled: Path, build_raw: str, evidence_raw: str, results: str | None) -> int:
    """Declares the differences between a build's target and a virtual or HIL execution of its ELF."""
    _, build_doc = evidence_run(cwd, build_raw)
    if build_doc.get("kind") != "zephyr-result" or build_doc.get("operation") != "build":
        raise Refused("evidence", "--build must name a zephyr build run.")
    elf_entry = next((a for a in build_doc.get("artifacts") or [] if a.get("role") == "elf"), None)
    if elf_entry is None:
        raise Refused("evidence", "The build run has no ELF.")
    folder, document = evidence_run(cwd, evidence_raw)
    firmware = document.get("firmware") or {}
    if firmware.get("sha256") != elf_entry.get("sha256"):
        raise Refused("evidence-mismatch", "The evidence run executed another firmware than this build's ELF.")
    run = Run("differences", "virtual" if document.get("kind") == "renode-result" else "hardware")
    run["board"] = build_doc.get("board")
    run["execution"] = {"runId": document.get("runId"), "kind": document.get("kind"), "status": document.get("status"),
                        "cases": [{k: c.get(k) for k in ("id", "status", "code")} for c in document.get("cases") or []]}
    run.create_folder(cwd, spelled, results)
    source = Path(str(elf_entry.get("source", "")))
    run["differences"] = differences(build_doc.get("board"), source if source.is_file() else None, folder, document)
    run.set_status("pass" if document.get("status") == "pass" else "incomplete", None if document.get("status") == "pass"
                   else "execution-" + str(document.get("status")), None)
    return run.finish({"execution": run["execution"], "differences": [d["detail"] for d in run["differences"]][:8]})


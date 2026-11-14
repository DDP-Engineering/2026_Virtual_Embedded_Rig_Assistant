"""test-host, test-device and test-run (spec REQ-DATA-865c8fbd sections 3 and 7, REQ-FUNC-427ebd28,
REQ-FUNC-a98ab34c).

test-host runs only the named suites of a `native` environment on this computer and reads PlatformIO's own JSON
report. test-device only builds the named suites' firmware (`--without-uploading --without-testing`): each suite is
`built` with no case reported as executed, and the run is `incomplete`, never `pass`. A device verdict exists only through test-run, from a renode-sim
run (virtual) or a HIL run (hardware) of exactly the ELF test-device made - PlatformIO's own uploader and serial reader
are not a second programming or reading path beside HIL.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any
from xml.sax.saxutils import quoteattr

from . import artifacts, builddir, diagnostics, environment, packages, unity
from .errors import Refused
from .ops import Context, changed, context, describe, evidence_run, needed_for, project_files, require_clean, run_env, \
    summary, toolchain_for
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
        errors = sum(1 for case in cases if case["status"] == "error")
        skipped = sum(1 for case in cases if case["status"] not in ("pass", "fail", "error"))
        parts.append(f"  <testsuite name={quoteattr(suite['suite'])} tests=\"{len(cases)}\" failures=\"{failures}\" "
                     f"errors=\"{errors}\" skipped=\"{skipped}\">")
        for case in cases:
            parts.append(f"    <testcase classname={quoteattr(suite['suite'])} name={quoteattr(case['name'])}>")
            message = quoteattr(str(case.get("message") or case["status"]))
            if case["status"] == "fail":
                parts.append(f"      <failure message={message}/>")
            elif case["status"] == "error":
                parts.append(f"      <error message={message}/>")
            elif case["status"] != "pass":
                parts.append(f"      <skipped message={message}/>")
            parts.append("    </testcase>")
        parts.append("  </testsuite>")
    parts.append("</testsuites>")
    path.write_text("\n".join(parts) + "\n", encoding="utf-8")


def _suites_exist(ctx: Context) -> None:
    test_dir = ctx.config.folders["test_dir"]
    for suite in ctx.request.tests:
        if not (test_dir / suite).is_dir():
            raise Refused("input", f"The test folder has no suite {suite}.")


def _prepare(ctx: Context, family: str, pristine: bool) -> packages.Needed:
    require_clean(ctx)
    _suites_exist(ctx)
    found = needed_for(ctx, tests=True)
    builddir.precheck(ctx.request, pristine)
    packages.require(found)
    return found


def test_host(cwd: Path, spelled: Path, raw: str, pristine: bool, results: str | None) -> int:
    ctx = context(cwd, spelled, raw, "test-host", needs_tests=True)
    if not summary(ctx, ctx.request.env())["native"]:
        raise Refused("environment", f"test-host runs only environments of the native platform; {ctx.request.env()} "
                      "is built for a device: use test-device.")
    toolchain = toolchain_for(ctx)
    found = _prepare(ctx, "test-host", pristine)
    command = environment.pio_command()
    request = ctx.request
    name = request.env()
    run = Run("test-host", "host")
    run.document.update(describe(ctx, found))
    run.create_folder(cwd, spelled, results)
    assert run.folder is not None
    run["buildFolder"] = builddir.claim(request, "test-host", pristine, run["runId"])
    before = project_files(request.project)
    run["inputs"] = {"before": before, "after": None}
    report_path = run.folder / "platformio-report.json"
    argv = [*command, "test", "-d", str(request.project), "-e", name, "-v",
            "--json-output-path", str(report_path), "--junit-output-path", str(run.folder / "platformio-junit.xml")]
    for suite in request.tests:
        argv += ["--filter", suite]
    code, log = run.step("test", argv, request.project, run_env(ctx, "test-host", toolchain, run.folder))
    run["diagnostics"] = diagnostics.analyse(log)
    suites = unity.report(report_path, name)
    listed: list[dict[str, Any]] = []
    for suite in request.tests:
        entry = next((s for s in suites if s["suite"] == suite), None)
        if entry is None:
            listed.append({"suite": suite, "status": "error", "code": "suite-missing", "cases": []})
            continue
        status, why = unity.suite_status(entry["cases"])
        listed.append({**entry, "status": status, "code": why})
    run["tests"] = listed
    statuses = [suite["status"] for suite in listed]
    if not report_path.is_file():
        run.set_status("error", "report-missing", f"PlatformIO exited {code} without a test report; see test.log.")
    elif "fail" in statuses:
        run.set_status("fail", "case-failed", "At least one test case failed.")
    elif "error" in statuses:
        run.set_status("error", "case-error", "A suite is missing from the report or a case errored.")
    elif "incomplete" in statuses:
        run.set_status("incomplete", "not-all-passed", "Not every case passed (skipped or none ran).")
    elif code != 0:
        run.set_status("error", "test-exit", f"PlatformIO exited {code} although every reported case passed.")
    after = project_files(request.project)
    run["inputs"]["after"] = after
    moved = changed(before, after)
    if moved:
        run.set_status("error", "input-changed", f"Project files changed during the test run: {', '.join(moved[:4])}.")
    found_artifacts, _ = artifacts.collect(artifacts.output_dir(request.workspace("test-host"), name), run.folder)
    run["artifacts"] = found_artifacts
    junit(run.folder / "junit.xml", "platformio test-host", listed)
    builddir.record(request, "test-host", run["runId"], run["status"])
    return run.finish({"tests": [{k: s.get(k) for k in ("suite", "status", "code")} for s in listed],
                       "cases": sum(len(s.get("cases", [])) for s in listed)})


def test_device(cwd: Path, spelled: Path, raw: str, pristine: bool, results: str | None) -> int:
    ctx = context(cwd, spelled, raw, "test-device", needs_tests=True)
    if summary(ctx, ctx.request.env())["native"]:
        raise Refused("environment", f"{ctx.request.env()} is a native environment: use test-host.")
    toolchain_for(ctx)
    found = _prepare(ctx, "test-device", pristine)
    command = environment.pio_command()
    request = ctx.request
    name = request.env()
    run = Run("test-device", "build-only")
    run.document.update(describe(ctx, found))
    run.create_folder(cwd, spelled, results)
    assert run.folder is not None
    run["buildFolder"] = builddir.claim(request, "test-device", pristine, run["runId"])
    before = project_files(request.project)
    run["inputs"] = {"before": before, "after": None}
    env = run_env(ctx, "test-device", None, run.folder)
    output = artifacts.output_dir(request.workspace("test-device"), name)
    listed: list[dict[str, Any]] = []
    for suite in request.tests:
        argv = [*command, "test", "-d", str(request.project), "-e", name, "-v", "--filter", suite,
                "--without-uploading", "--without-testing"]
        step = "test-build-" + suite.replace("/", "-")
        code, log = run.step(step, argv, request.project, env)
        run["diagnostics"].extend(diagnostics.analyse(log))
        elf_path = output / "firmware.elf"
        entry: dict[str, Any] = {"suite": suite, "status": "build-error", "cases": [], "elf": None, "log": log.name}
        if code == 0 and elf_path.is_file():
            target = run.folder / "artifacts" / suite.replace("/", "-")
            target.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(elf_path, target / "firmware.elf")
            entry["status"] = "built"
            entry["elf"] = {"path": f"artifacts/{suite.replace('/', '-')}/firmware.elf",
                            "sha256": sha256(target / "firmware.elf"), "size": elf_path.stat().st_size}
        listed.append(entry)
    run["tests"] = listed
    if any(suite["status"] != "built" for suite in listed):
        run.set_status("fail", "build-failed", "A test suite did not build; see its step log.")
    else:
        run.set_status("incomplete", "build-only", "Built only: no test case was executed, so none passed.")
    after = project_files(request.project)
    run["inputs"]["after"] = after
    moved = changed(before, after)
    if moved:
        run.set_status("error", "input-changed", f"Project files changed during the test build: {', '.join(moved[:4])}.")
    junit(run.folder / "junit.xml", "platformio test-device", listed)
    builddir.record(request, "test-device", run["runId"], "pass" if run["code"] == "build-only" else run["status"])
    exit_code = run.finish({"tests": [{k: s.get(k) for k in ("suite", "status", "elf")} for s in listed]})
    return 0 if run["code"] == "build-only" else exit_code


def _console(folder: Path, document: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
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
        texts = [log.read_text(encoding="utf-8", errors="replace") for log in sorted((folder / "steps").glob("*.log"))]
        return "\n".join(texts), "hardware", {"setup": document.get("setup")}
    raise Refused("evidence", "The evidence run is neither a renode-sim nor a HIL run.")


def test_run(cwd: Path, spelled: Path, device_raw: str, suite_name: str, evidence_raw: str, results: str | None) -> int:
    _, device_doc = evidence_run(cwd, device_raw)
    if device_doc.get("kind") != "platformio-result" or device_doc.get("operation") != "test-device":
        raise Refused("evidence", "--test-device must name a platformio test-device run.")
    suite = next((s for s in device_doc.get("tests") or [] if s.get("suite") == suite_name), None)
    if suite is None or not suite.get("elf"):
        raise Refused("evidence", f"The test-device run has no built suite {suite_name}.")
    folder, document = evidence_run(cwd, evidence_raw)
    firmware = document.get("firmware") or {}
    if firmware.get("sha256") != suite["elf"]["sha256"]:
        raise Refused("evidence-mismatch", f"The evidence run executed firmware {str(firmware.get('sha256'))[:16]}..., "
                      f"not the ELF of {suite_name} ({suite['elf']['sha256'][:16]}...).")
    text, evidence, setup = _console(folder, document)
    run = Run("test-run", evidence)
    run["environment"] = device_doc.get("environment")
    run["testDevice"] = {"runId": device_doc.get("runId"), "suite": suite_name, "elf": suite["elf"]}
    run["execution"] = {"runId": document.get("runId"), "kind": document.get("kind"), "status": document.get("status"),
                        "folder": str(folder), **setup}
    run.create_folder(cwd, spelled, results)
    assert run.folder is not None
    parsed = unity.parse(text)
    status, code = unity.verdict(parsed)
    if document.get("status") != "pass" and status == "pass":
        # The execution itself did not pass (stopped, timeout, unmodeled access, a failed HIL step...): never a pass.
        status, code = "incomplete", "execution-" + str(document.get("status"))
    run.set_status(status, code, None if status == "pass" else f"Unity outcome {code}.")
    run["tests"] = [{"suite": suite_name, "status": status, "code": code, "summaries": parsed.summaries,
                     "cases": list(parsed.cases.values())}]
    environment_block = device_doc.get("environment") or {}
    run["coverage"] = {"evidence": evidence, "board": environment_block.get("board"), **setup,
                       "notCovered": NOT_COVERED_VIRTUAL if evidence == "virtual" else [],
                       "statement": "Virtual evidence: the firmware ran on a simulated model, not on the board."
                       if evidence == "virtual" else "Hardware evidence from the HIL run's serial capture."}
    junit(run.folder / "junit.xml", "platformio test-run", run["tests"])
    return run.finish({"tests": [{k: t[k] for k in ("suite", "status", "code")} for t in run["tests"]],
                       "cases": len(parsed.cases), "coverage": {k: run["coverage"][k] for k in ("evidence", "board")}})

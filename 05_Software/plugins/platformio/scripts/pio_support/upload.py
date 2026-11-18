"""`platformio-upload`: upload an owned build through the verified protocol (spec REQ-DATA-865c8fbd section 8,
REQ-FUNC-26fb0ed6).

Only `upload_protocol = stlink` (PlatformIO's OpenOCD upload of the ststm32 platform) is verified. Before the probe is
opened: the request's preflight is clean, the environment has no upload_flags of its own, the build run is a passed
build of the same project, environment and build folder, the owned folder's firmware equals that run's by SHA-256,
the uploader package is installed, and the probe alias is a declared `probe` resource. PlatformIO then runs only its
`nobuild` and `upload` targets (no rebuild), with the probe's serial passed to OpenOCD explicitly; the physical state
is `unknown` from the moment the upload starts.
"""

from __future__ import annotations

import argparse
import os
import sys
import traceback
from pathlib import Path

from . import VERSION, artifacts, builddir, environment, packages, registry
from .errors import Refused
from .lifecycle import Lifecycle
from .ops import context, evidence_run, needed_for, require_clean, run_env, summary, tools_block
from .result import Run, emit, refuse, sha256
from .workspace import entered_directory

PROTOCOLS = {"stlink": "tool-openocd"}


def upload(cwd: Path, spelled: Path, raw: str, build_raw: str, alias: str, effect: str, lifecycle: Lifecycle,
           results: str | None) -> int:
    ctx = context(cwd, spelled, raw, "build")
    require_clean(ctx)
    request = ctx.request
    name = request.env()
    identity = summary(ctx, name)
    protocol = str(identity.get("uploadProtocol") or "")
    if protocol not in PROTOCOLS:
        raise Refused("protocol", f"upload_protocol {protocol or 'unknown'} is not verified; VERA uploads only with "
                      f"{', '.join(sorted(PROTOCOLS))}.")
    if ctx.config.listed(name, "upload_flags"):
        raise Refused("upload-flags", "The environment sets upload_flags; VERA composes the uploader's arguments itself.")
    builddir.check_owned(request)
    _, build_doc = evidence_run(cwd, build_raw)
    if build_doc.get("kind") != "platformio-result" or build_doc.get("operation") != "build" or build_doc.get("status") != "pass":
        raise Refused("evidence", "--build must name a passed platformio build run.")
    if (build_doc.get("environment") or {}).get("name") != name or \
            str(build_doc.get("buildDir") or "").casefold() != str(request.build_dir).casefold():
        raise Refused("evidence", "The build run built another environment or folder than this request.")
    output = artifacts.output_dir(request.workspace("build"), name)
    for role, file_name in (("elf", "firmware.elf"), ("bin", "firmware.bin")):
        expected = next((a for a in build_doc.get("artifacts") or [] if a.get("role") == role), None)
        if role == "elf" and expected is None:
            raise Refused("image-changed", "The build run recorded no firmware.elf.")
        if expected is not None and (not (output / file_name).is_file() or sha256(output / file_name) != expected.get("sha256")):
            raise Refused("image-changed", f"The build folder's {file_name} is missing or differs from the build run's.")
    found = needed_for(ctx, tests=False)
    installed = {p.name for p in packages.tools(request.core)}
    if found.platform is not None:
        # PlatformIO makes every uploader of the platform required for an upload target, not only the protocol's.
        for spec in packages.uploaders(found.platform, protocol):
            name_of = packages.split_spec(spec)[1]
            if name_of not in installed:
                found.missing.append(f"package {name_of} (an uploader; prepare-packages with upload: true installs it)")
    packages.require(found)
    probe, registry_sha = registry.read(alias)

    run = Run("upload", "hardware")
    run["tools"] = tools_block()
    run["request"] = request.described()
    run["environment"] = identity
    run["buildDir"] = str(request.build_dir)
    elf_sha = sha256(output / "firmware.elf")
    # Outside VERA no approved hash exists and the registry is read unchecked; the result says which it was.
    run["upload"] = {"protocol": protocol, "probe": {"alias": probe.alias, "resource": probe.resource},
                     "registrySha256": registry_sha, "registryVerified": bool(os.environ.get("VERA_REGISTRY_SHA256")),
                     "build": build_doc.get("runId"),
                     "image": {"path": str(output / "firmware.elf"), "sha256": elf_sha},
                     "firmwareEffect": effect, "physical": "unchanged"}
    run.create_folder(cwd, spelled, results)
    lifecycle.report("uploading", "unknown")
    run["upload"]["physical"] = "unknown"
    env = run_env(ctx, "build", None, run.folder)
    env["PLATFORMIO_UPLOAD_FLAGS"] = f'-c "adapter serial {probe.serial}"'
    command = [*environment.pio_command(), "run", "-d", str(request.project), "-e", name, "-t", "nobuild", "-t", "upload"]
    code, _ = run.step("upload", command, request.project, env, lifecycle.stop_requested)
    if lifecycle.stop_requested():
        run.set_status("stopped", "stop-requested", "VERA asked the run to stop; the target's flash content is unknown.")
    if code != 0:
        run.set_status("fail", "upload-failed", f"PlatformIO's upload exited {code}; the target's flash content is unknown.")
    lifecycle.report("done", "unknown")
    return run.finish({"upload": run["upload"]})


def release(alias: str, lifecycle: Lifecycle) -> int:
    if not registry.ALIAS.fullmatch(alias):
        raise Refused("request", f"--probe {alias[:40]!r} is not a registry alias.")
    lifecycle.report("cleaning", "unknown")
    lifecycle.report("released", "unknown")
    emit({"format": 1, "kind": "platformio-upload-release", "probe": alias, "physical": "unknown",
          "note": "No process was started and the target was not touched; an interrupted upload leaves its content unknown."})
    return 0


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise Refused("usage", message)


def main(argv: list[str] | None = None) -> int:
    operation = "upload"
    lifecycle = Lifecycle()
    try:
        root = Parser(prog="platformio-upload")
        root.add_argument("--version", action="store_true")
        sub = root.add_subparsers(dest="operation", parser_class=Parser)
        sub.add_parser("tools")
        rel = sub.add_parser("release")
        rel.add_argument("--probe", required=True)
        up = sub.add_parser("upload")
        up.add_argument("--request", required=True)
        up.add_argument("--build", required=True)
        up.add_argument("--probe", required=True)
        up.add_argument("--firmware-effect", required=True, choices=["none", "actuates"])
        up.add_argument("--results-dir")
        args = root.parse_args(argv)
        if args.version:
            print(f"platformio-upload {VERSION}")
            return 0
        operation = args.operation or "upload"
        if args.operation == "tools":
            emit({"format": 1, "kind": "platformio-upload-tools", **tools_block(), "protocols": sorted(PROTOCOLS)})
            return 0
        if args.operation == "release":
            return release(args.probe, lifecycle)
        if args.operation != "upload":
            raise Refused("usage", "Name an operation: tools, upload, release.")
        spelled = entered_directory()
        return upload(Path(spelled).resolve(), spelled, args.request, args.build, args.probe, args.firmware_effect,
                      lifecycle, args.results_dir)
    except Refused as error:
        return refuse(error, operation)
    except Exception as error:  # noqa: BLE001 - every failure ends in one JSON document
        emit({"format": 1, "kind": "platformio-result", "operation": operation, "status": "error", "code": "internal",
              "reason": f"{type(error).__name__}: {str(error)[:300]}", "trace": traceback.format_exc(limit=6)[-1500:]})
        return 3


if __name__ == "__main__":
    sys.exit(main())

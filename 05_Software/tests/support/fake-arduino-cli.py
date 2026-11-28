"""A scripted stand-in for arduino-cli 1.6.0, for tests/plugins/arduino-cli.test.ts.

The test launches it through a generated wrapper named arduino-cli(.cmd). VERA_FAKE_ARDUINO names a scenario JSON file;
every call is appended to `<scenario>.calls.jsonl` with its argv and the text of the configuration it received, so a
test can check what arduino-tool asked for. Output shapes follow the real arduino-cli 1.6.0 `--json` documents.
"""

import json
import os
import sys
import time
from pathlib import Path


def out(document, code=0):
    sys.stdout.write(json.dumps(document))
    sys.stdout.flush()
    sys.exit(code)


def main(argv):
    scenario_path = Path(os.environ["VERA_FAKE_ARDUINO"])
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    config_text = ""
    if argv[:1] == ["--config-file"]:
        try:
            config_text = Path(argv[1]).read_text(encoding="utf-8")
        except OSError:
            config_text = "<unreadable>"
        argv = argv[2:]
    # The recorded argv leaves out --json and the end-of-options separator, wherever arduino-tool put them.
    argv = [value for value in argv if value not in ("--json", "--")]
    record = {"argv": argv, "config": config_text}
    if argv[:1] == ["upload"] and Path(argv[-1]).is_dir():
        record["sketchFiles"] = sorted(os.listdir(argv[-1]))
    with open(str(scenario_path) + ".calls.jsonl", "a", encoding="utf-8") as log:
        log.write(json.dumps(record) + "\n")
    state_path = Path(str(scenario_path) + ".state")
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    command = argv[:2]
    sleep = scenario.get("sleep", {}).get(" ".join(command)) or scenario.get("sleep", {}).get(argv[0] if argv else "")
    if sleep:
        marker = {"pid": os.getpid(), "ppid": os.getppid()}
        Path(str(scenario_path) + ".sleeping").write_text(json.dumps(marker), encoding="utf-8")
        time.sleep(float(sleep))
    if state.get("uploaded") and " ".join(argv[:2]) in scenario.get("failAfterUpload", []):
        out({"error": "scripted failure after the upload"}, 1)
    if " ".join(argv[:2]) in scenario.get("fail", []):
        out({"error": "scripted failure"}, 1)
    # Installs of this scenario add to what the lists show.
    cores = {**scenario.get("cores", {}), **state.get("cores", {})}
    libraries = {**scenario.get("libraries", {}), **state.get("libraries", {})}
    latest = scenario.get("latest", {})

    def remember(kind, name, version):
        state.setdefault(kind, {})[name] = version
        state_path.write_text(json.dumps(state), encoding="utf-8")

    if argv[:1] == ["monitor"]:
        spec = scenario.get("monitor", {})
        if spec.get("error"):
            sys.stderr.write(spec["error"])
            sys.exit(1)
        # The board's bytes as they are, without the text mode's line-end translation.
        sys.stdout.buffer.write(spec.get("text", "").encode("utf-8"))
        sys.stdout.buffer.flush()
        # Like arduino-cli, the monitor ends when its standard input ends.
        sys.stdin.read()
        sys.exit(0)
    if argv[:1] == ["version"]:
        out({"Application": "arduino-cli", "VersionString": scenario.get("version", "1.6.0")})
    if command == ["core", "list"]:
        out({"platforms": [{"id": key, "installed_version": value, "latest_version": value} for key, value in cores.items()]})
    if command == ["core", "search"]:
        out({"platforms": [{"id": key, "latest_version": value} for key, value in cores.items() if argv[2] in key]})
    if command == ["lib", "list"]:
        out({"installed_libraries": [{"library": {"name": key, "version": value, "location": "user"}} for key, value in libraries.items()]})
    if command == ["lib", "search"]:
        out({"libraries": [{"name": "Servo", "latest": {"version": "1.3.0", "sentence": "Servo control.", "architectures": ["*"]}}]})
    if command == ["lib", "examples"]:
        out({"examples": scenario.get("examples", [])})
    if command == ["lib", "deps"]:
        out({"dependencies": scenario.get("deps", [])})
    if command in (["core", "update-index"], ["lib", "update-index"]):
        if "proxy" in config_text:
            out({"error": "Some indexes could not be updated."}, 1)
        out({"updated_indexes": [{"index_url": "https://downloads.arduino.cc/packages/package_index.tar.bz2", "status": "updated"}]})
    if command in (["core", "install"], ["lib", "install"]):
        if "proxy" in config_text:
            out({"error": "network unreachable"}, 1)
        kind = "cores" if command[0] == "core" else "libraries"
        for item in [value for value in argv[2:] if not value.startswith("--")]:
            name, _, version = item.partition("@")
            remember(kind, name, version or latest.get(name, "1.0.0"))
        if kind == "libraries" and "--no-deps" not in argv:
            for dependency in scenario.get("deps", []):
                if not dependency.get("version_installed"):
                    remember(kind, dependency["name"], dependency.get("version_required") or "1.0.0")
        out({})
    if command == ["board", "attach"]:
        folder = Path(argv[-1])
        values = {"default_fqbn": argv[argv.index("--fqbn") + 1] if "--fqbn" in argv else None, "default_port": argv[argv.index("--port") + 1] if "--port" in argv else None}
        target = folder / "sketch.yaml"
        kept = [line for line in (target.read_text(encoding="utf-8").splitlines() if target.exists() else []) if not any(line.startswith(key + ":") for key, value in values.items() if value)]
        target.write_text("\n".join([*kept, *[f"{key}: {value}" for key, value in values.items() if value]]) + "\n", encoding="utf-8")
        out({"fqbn": values["default_fqbn"], "port": {"address": values["default_port"], "protocol": "serial"}})
    if command == ["board", "details"]:
        fqbn = argv[argv.index("--fqbn") + 1]
        details = scenario.get("boards", {}).get(fqbn)
        if details is None:
            out({"error": f"Error getting board details: Unknown FQBN: board {fqbn} not found"}, 1)
        out({"fqbn": fqbn, **details})
    if command == ["board", "listall"]:
        out({"boards": [{"name": value.get("name"), "fqbn": key, "platform": {"metadata": {"id": ":".join(key.split(":")[:2])}, "release": {"version": "1.8.8"}}} for key, value in scenario.get("boards", {}).items()]})
    if command == ["board", "list"]:
        ports = scenario.get("portsAfter") if state.get("uploaded") and "portsAfter" in scenario else scenario.get("ports", [])
        out({"detected_ports": ports})
    if argv[:1] == ["compile"]:
        spec = scenario.get("compile", {})
        sketch = Path(argv[-1])
        output = Path(argv[argv.index("--output-dir") + 1])
        libraries = [argv[index + 1] for index, value in enumerate(argv) if value == "--library"]
        text_out = spec.get("compiler_out", "").replace("{sketch}", str(sketch))
        text_err = spec.get("compiler_err", "").replace("{sketch}", str(sketch))
        used = []
        for item in spec.get("used_libraries", []):
            entry = dict(item)
            if entry.get("location") == "unmanaged" and libraries:
                entry["install_dir"] = next((path for path in libraries if Path(path).name == entry["name"]), libraries[0])
            used.append(entry)
        builder = {
            "build_path": argv[argv.index("--build-path") + 1],
            "used_libraries": used,
            "executable_sections_size": spec.get("sizes", [{"name": "text", "size": 1880, "max_size": 32256}, {"name": "data", "size": 190, "max_size": 2048}]),
            "board_platform": {"id": spec.get("platform", "arduino:avr"), "version": spec.get("platformVersion", "1.8.8")},
            "build_platform": {"id": spec.get("platform", "arduino:avr"), "version": spec.get("platformVersion", "1.8.8")},
            "build_properties": spec.get("build_properties", ["recipe.c.o.pattern=avr-gcc -c {source_file}"]),
        }
        # Like arduino-cli, the build path holds the compilation database and, once the program linked, its ELF.
        build_path = Path(builder["build_path"])
        build_path.mkdir(parents=True, exist_ok=True)
        if spec.get("database") is not None:
            (build_path / "compile_commands.json").write_text(json.dumps(spec["database"]), encoding="utf-8")
        if spec.get("success", True) or spec.get("linked"):
            (build_path / f"{sketch.name}.ino.elf").write_text("ELF", encoding="utf-8")
        if not spec.get("success", True):
            if spec.get("linked"):
                builder["executable_sections_size"] = None
            out({"compiler_out": text_out, "compiler_err": text_err, "builder_result": builder, "upload_result": {}, "success": False, "error": spec.get("error", "Error during build: exit status 1")}, 1)
        output.mkdir(parents=True, exist_ok=True)
        for suffix, content in spec.get("binaries", {"hex": ":00000001FF\n", "elf": "ELF"}).items():
            (output / f"{sketch.name}.ino.{suffix}").write_text(content, encoding="utf-8")
        profile = {"profile_out": spec.get("profile", "profiles:\n  board:\n    fqbn: " + argv[argv.index("--fqbn") + 1] + "\n")} if "--dump-profile" in argv else {}
        out({"compiler_out": text_out, "compiler_err": text_err, "builder_result": builder, "upload_result": {}, "success": True, **profile})
    if argv[:1] == ["upload"]:
        spec = scenario.get("upload", {})
        state["uploaded"] = True
        state_path.write_text(json.dumps(state), encoding="utf-8")
        if spec.get("error"):
            out({"error": spec["error"]}, 1)
        out({"stdout": "avrdude done.\n", "stderr": "", "updated_upload_port": spec.get("updated")})
    out({"error": f"fake arduino-cli: unknown command {argv}"}, 1)


if __name__ == "__main__":
    main(sys.argv[1:])

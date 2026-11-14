# TASK-287329c3 diagrams

Illustrates `## Design` in `TASK-287329c3.md`. The Design text is authoritative.

Node map: added - zephyr program (zephyr_tool.py), zephyr-flash program, stm32_programmer_cli find program, request,
workspace_model, boards/sdk, preflight, environment, builddir, build/diagnostics/artifacts, twister, tests/ztest,
prepare, flash, result; unchanged - VERA runner, leases, provisioner, renode-sim, HIL executor, lab/resources.json.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    agent["run_program"] ==> runner["ProgramRunner"]
    runner ==> tool["zephyr (zephyr_tool.py)"]:::added
    runner ==> flashp["zephyr-flash (zephyr_flash.py)"]:::added
    runner -.-> leases["ResourceLeases (probe)"]
    flashp -.-> cli["stm32_programmer_cli (find)"]:::added
    tool ==> req["request.py"]:::added
    req ==> model["workspace_model.py (west Manifest, .git heads)"]:::added
    req ==> checks["boards.py / sdk.py"]:::added
    model ==> pre["preflight.py (findings, hooks by sha256)"]:::added
    pre ==> bdir["builddir.py (marker, safe delete)"]:::added
    bdir ==> build["build.py (cmake + ninja)"]:::added
    bdir ==> tw["twister.py (build-only)"]:::added
    tool ==> prep["prepare.py (west init -l / update)"]:::added
    build ==> env["environment.py (scrubbed env)"]:::added
    tw ==> env
    build ==> diag["diagnostics.py / artifacts.py"]:::added
    tool ==> tr["tests.py / ztest.py (test-run)"]:::added
    renode["renode-sim run folder"] -.-> tr
    hil["HIL run folder"] -.-> tr
    flashp ==> fl["flash.py (west flash, allowlists)"]:::added
    diag ==> res["result.py (progressive result.json)"]:::added
    tr ==> res
    fl ==> res
    res ==> folder[("embedded-lab-results/run-id")]
```

## Sequence

```mermaid
sequenceDiagram
    participant R as VERA runner
    participant H as zephyr helper
    participant W as workspace and app files
    participant C as CMake / Ninja / SDK
    participant F as run folder
    R->>H: build --request zephyr/board-demo.json
    H->>W: read request, west.yml, .west/config, .git heads, board.yml, sdk_version
    H->>H: preflight findings, build folder marker check
    alt refused
        H-->>R: exit 2, refusal JSON, nothing written
    else accepted
        H->>F: create run folder, result.json running
        H->>C: cmake -S app -B buildDir -G Ninja -DBOARD ... -DZEPHYR_MODULES ...
        C-->>H: configure log
        H->>C: cmake --build buildDir
        C-->>H: build log, exit code
        H->>F: artifacts copied with sha256, diagnostics, final result.json
        H-->>R: exit 0 pass or 1 fail
    end
```

## State

```mermaid
stateDiagram-v2
    [*] --> absent
    absent --> owned: build creates folder and marker
    owned --> owned: same fingerprint (incremental)
    owned --> owned: other fingerprint with --pristine (delete, recreate)
    owned --> refused_mismatch: other fingerprint without --pristine
    owned --> absent: clean (marker re-checked)
    foreign --> refused_foreign: build, --pristine or clean
    refused_mismatch --> owned: next request matches
    refused_foreign --> foreign
```

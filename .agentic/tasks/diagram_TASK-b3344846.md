# TASK-b3344846 diagrams

Illustrates `## Design` in `TASK-b3344846.md`. The Design text is authoritative.

Node map: added - platformio program (pio_tool.py), platformio-upload program, request, config (ProjectConfig),
preflight, packages, environment, builddir, ops/tests/prepare, unity, upload, result; unchanged - VERA runner, leases,
renode-sim, HIL executor, lab/resources.json, PlatformIO Core.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    agent["run_program"] ==> runner["ProgramRunner"]
    runner ==> tool["platformio (pio_tool.py)"]:::added
    runner ==> up["platformio-upload (pio_upload.py)"]:::added
    runner -.-> leases["ResourceLeases (probe)"]
    tool ==> req["request.py"]:::added
    up ==> req
    req ==> cfg["config.py (PlatformIO ProjectConfig, scrubbed env)"]:::added
    cfg ==> pre["preflight.py (findings, hooks by sha256)"]:::added
    pre ==> pk["packages.py (offline package check)"]:::added
    pk ==> bdir["builddir.py (marker, families, safe delete)"]:::added
    bdir ==> ops["ops.py / tests.py / prepare.py"]:::added
    ops ==> env["environment.py (scrubbed env, closed proxy)"]:::added
    env ==> pio["PlatformIO Core 6.2.0 (python -m platformio)"]
    ops ==> res["result.py (progressive result.json)"]:::added
    tool ==> tr["tests.test_run + unity.py"]:::added
    renode["renode-sim run folder"] -.-> tr
    hil["HIL run folder"] -.-> tr
    up ==> upl["upload.py (hash, protocol, probe serial)"]:::added
    upl ==> env
    res ==> folder[("embedded-lab-results/run-id")]
```

## Sequence

```mermaid
sequenceDiagram
    participant R as VERA runner
    participant H as platformio helper
    participant P as project files
    participant C as PlatformIO Core (SCons, compiler)
    participant F as run folder
    R->>H: build --request R
    H->>P: ProjectConfig read + raw scan (preflight)
    H->>H: package check, build folder claim
    H->>F: result.json (state running)
    H->>C: python -m platformio run -e ENV -t buildprog (scrubbed env, closed proxy)
    C-->>H: exit code, build.log
    H->>P: input hashes after
    H->>F: artifacts + SHA-256, versions, diagnostics, result.json (done)
    H-->>R: one JSON line (status, result path)
```

## State

```mermaid
stateDiagram-v2
    [*] --> refused: request, preflight or package check fails (exit 2, nothing written)
    [*] --> running: run folder created
    running --> done: PlatformIO finished (pass, fail, incomplete, error)
    running --> stopped: Stop or timeout tree kill, heartbeat older than 90 s
    done --> [*]
    stopped --> [*]
```

# TASK-239a7379 diagrams

Illustrates `## Design` in `TASK-239a7379.md`. The Design text is authoritative.

Node map: added - plugin.yaml, arduino_tool.py, cli, environment, sketch, boards, compile, upload, report,
skills, fake arduino-cli; changed - runner (serial guard); unchanged - approval gate, provisioner, arduino-cli,
serial-monitor.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    agent["agent run_program"] --> gate["approval gate"]
    gate --> runner["ProgramRunner serial guard"]:::changed
    prov["provisioner"] --> manifest["arduino-cli plugin.yaml"]:::added
    runner --> tool["arduino_tool.py"]:::added
    tool --> cli["cli"]:::added
    cli --> sketch["sketch"]:::added
    cli --> boards["boards"]:::added
    cli --> compile["compile"]:::added
    cli --> upload["upload"]:::added
    cli --> report["report + workspace"]:::added
    compile --> env["environment configs, staging, clean"]:::added
    upload --> env
    boards --> env
    env --> acli["arduino-cli 1.6.0"]
    upload -. "re-bind port by identity" .-> serial["serial-monitor capture"]
    skills["skills x3"]:::added -.-> agent
```

## Sequence

```mermaid
sequenceDiagram
    participant A as Agent
    participant G as Approval gate
    participant R as Runner
    participant T as arduino-tool
    participant C as arduino-cli (offline config)
    A->>G: compile --sketch S --fqbn F --core P@V
    G->>R: approved (device-read)
    R->>T: spawn (VERA_PROGRAM_ARDUINO_CLI)
    T->>C: board details, core list, lib list
    T->>T: copy sketch to run folder, hash
    T->>C: compile copy, build in staging
    T-->>A: result.json (binaries, sizes, libraries, hashes)
    A->>G: upload --build run/result.json --port P --identity K
    G->>G: hash result.json (bound)
    G->>R: approved (device-write)
    R->>T: spawn (BUSY if P held)
    T->>T: re-hash sources and binaries, copy to staging
    T->>C: board list (identity, board match)
    T->>C: upload staging copy
    T->>C: board list (port after)
    T-->>A: result.json (port before/after)
```

## State

```mermaid
stateDiagram-v2
    [*] --> Refused: option, sketch, FQBN, core, library or identity check fails (exit 2)
    [*] --> Staged: checks pass, run folder and staging created
    Staged --> Pass: arduino-cli succeeds and no undeclared library (exit 0)
    Staged --> Fail: compiler or upload error, undeclared library (exit 3)
    Staged --> Killed: Stop or timeout (runner kills the tree)
    Killed --> Cleaned: arduino-tool clean removes staging of ended owners
    Pass --> [*]
    Fail --> [*]
    Refused --> [*]
    Cleaned --> [*]
```

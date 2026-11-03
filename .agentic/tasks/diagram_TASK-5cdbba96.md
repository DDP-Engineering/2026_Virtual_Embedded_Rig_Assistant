# TASK-5cdbba96 diagrams

Illustrates `## Design` in `TASK-5cdbba96.md`. The Design text is authoritative.

Node map: added = plugin.yaml, serial_monitor.py, skills, fake pyserial, integration test; no class = run_program,
ApprovalGate, ProgramRunner, Provisioner, uv, pyserial (reused unchanged).

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    manifest["plugins/serial-monitor/plugin.yaml<br/>program serial, rules"]:::added
    skills["skills serial-console, esp32-identify"]:::added
    script["scripts/serial_monitor.py<br/>list / capture / send"]:::added
    tool["run_program"]
    gate["ApprovalGate"]
    runner["ProgramRunner + serial-port guard"]
    prov["Provisioner (script kind)"]
    uv["uv run --offline --script"]
    pyserial["pyserial 3.5"]
    fake["tests/fixtures/serial-monitor/fake-pyserial"]:::added
    test["tests/integration/serial-monitor.test.ts"]:::added
    manifest --> tool
    skills --> tool
    tool --> gate --> runner
    prov --> uv
    tool --> prov
    runner --> uv --> script --> pyserial
    test --> manifest
    test --> script
    script -.-> fake
```

## Sequence

```mermaid
sequenceDiagram
    participant A as Agent
    participant T as run_program
    participant G as ApprovalGate
    participant R as ProgramRunner
    participant S as serial_monitor.py
    participant P as pyserial port
    A->>T: serial list
    T->>G: risk safe
    G-->>T: approved, no record
    T->>R: start
    R->>S: uv run ... list
    S->>P: comports()
    S-->>A: JSON ports with families
    A->>T: serial capture --port COM7 --reset --until main_task
    T->>G: risk device-read (ask)
    G-->>T: waits for the user, approved
    T->>R: start (guard checks COM7)
    R->>S: uv run ... capture
    S->>P: open with DTR/RTS released, RTS pulse 200 ms
    P-->>S: boot log bytes
    S-->>A: boot log, summary "stopped by until"
```

## State

Not drawn: the script keeps no state between runs and the design adds no lifecycle or status field.

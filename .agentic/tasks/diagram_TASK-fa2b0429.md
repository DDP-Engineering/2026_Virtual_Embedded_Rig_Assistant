# TASK-fa2b0429 diagrams

Illustrates `## Design` in `TASK-fa2b0429.md`. The Design text is authoritative.

Node map: added - micropython plugin.yaml, micropython_tool.py, cli, ports, remote, device, deploy, operations, report +
workspace, skills, fake-serial board, fake-mpremote client; changed - ProgramRunner (serial-port leases); unchanged -
approval gate, ResourceLeases, provisioner/uv, mpremote 1.29.0, arduino-cli/serial-monitor/esptool packages.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    agent["agent run_program"] --> gate["approval gate (argument files hashed)"]
    gate --> runner["ProgramRunner serial guard + serial-port leases"]:::changed
    runner --> leases[("ResourceLeases folder")]
    prov["provisioner / uv"] --> manifest["micropython plugin.yaml"]:::added
    runner --> tool["micropython_tool.py"]:::added
    tool --> cli["cli"]:::added
    cli --> ports["ports"]:::added
    cli --> remote["remote"]:::added
    cli --> ops["operations"]:::added
    cli --> deploy["deploy"]:::added
    cli --> report["report + workspace"]:::added
    ops --> device["device"]:::added
    deploy --> device
    device --> mpremote["mpremote SerialTransport 1.29.0"]
    mpremote --> board["MicroPython board"]
    other["arduino-cli / serial-monitor / esptool runs"] --> runner
    skills["skills x2"]:::added -.-> agent
    fakeS["fake-serial board"]:::added -. tests .-> mpremote
    fakeM["fake-mpremote client"]:::added -. offline tests .-> device
```

## Sequence

```mermaid
sequenceDiagram
    participant A as Agent
    participant G as Approval gate
    participant R as Runner
    participant L as Leases
    participant T as micropython-tool
    participant B as Board
    A->>G: run_program micropython-tool deploy-file --port COM5 ...
    G->>G: classify device-write, hash --source
    G->>R: start (re-hash before spawn)
    R->>L: acquire serial:COM5 (BUSY if another process holds it)
    R->>T: spawn
    T->>T: ports: COM5 has --identity? copy + hash source
    T->>B: Ctrl-C, raw REPL, firmware check
    T->>B: stat + hash target, statvfs
    T->>T: result.json incomplete (phase transfer)
    T->>B: write <target>.vera-part, hash it
    T->>B: re-hash target, rename (or remove + rename)
    T->>B: hash target, Ctrl-B, close
    T-->>R: JSON document, exit 0
    R->>L: release serial:COM5
```

## State

```mermaid
stateDiagram-v2
    [*] --> checked: port, identity, paths, source
    checked --> blocked: refusal (exit 2)
    checked --> opened: raw REPL, firmware ok
    opened --> blocked: incompatible / conflict / no-space
    opened --> transfer: result.json incomplete
    transfer --> failed: ENOSPC / hash-mismatch / conflict (part removed)
    transfer --> lost: disconnected / device-reset / no-response
    transfer --> replace: part verified, target unchanged
    replace --> lost
    replace --> passed: target hash verified
    replace --> failed: verify-failed
    passed --> [*]
    failed --> [*]
    lost --> [*]
    blocked --> [*]
```

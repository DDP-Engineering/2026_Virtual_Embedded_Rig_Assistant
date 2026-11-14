# TASK-a5a839c7 diagrams

Illustrates `## Design` in `TASK-a5a839c7.md`. The Design text is authoritative.

Node classes: added - lab-resources (shared), ResourceLeases, scpi-instruments package (scpi helper, profiles), lease
folder; changed - plugin manifest schema, program-request, program-tools, ProgramRunner, approval card / CLI prompt,
desktop and CLI composition; unchanged - ApprovalGate, ProcessHost, Provisioner.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    reg[("lab/resources.json")] --> res["shared lab-resources (schema, VISA keys)"]:::added
    manifest["plugins.ts manifest: program.resources"]:::changed --> tools
    res --> tools["program-tools (alias -> claims, cleanup args)"]:::changed
    tools --> req["program-request (resources, registry hash)"]:::changed
    req --> gate["ApprovalGate"]
    gate --> card["approval card / CLI prompt"]:::changed
    tools --> runner["ProgramRunner (in-process BUSY, stop request, cleanup, physical)"]:::changed
    runner --> leases["ResourceLeases (lease files, stale, unknown markers)"]:::added
    leases --> folder[("per-user lease folder")]:::added
    apps["desktop main / CLI run"]:::changed --> leases
    runner --> host["ProcessHost"]
    host --> scpi["scpi helper (PEP 723, PyVISA)"]:::added
    scpi --> profiles["profiles/*.json"]:::added
    scpi --> results[("embedded-lab-results/<run-id>")]
    scpi -- "state.json / stop" --> folder
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent
    participant Tools as program-tools
    participant Runner as ProgramRunner
    participant Leases as ResourceLeases
    participant Helper as scpi helper
    participant Inst as instrument
    Agent->>Tools: run_program scpi output --instrument psu ...
    Tools->>Tools: read lab/resources.json, keys, request + approval (typed "output")
    Tools->>Runner: start(lease: claims, grace, cleanup)
    Runner->>Runner: in-process holders / serial ports
    Runner->>Leases: acquire keys (BUSY if held)
    Runner->>Helper: spawn (VERA_RUN_CONTROL, VERA_RESOURCE_STATE)
    Helper->>Inst: *IDN?, readback off, set-points, OUTP ON
    Agent->>Runner: Stop
    Runner->>Helper: write control/stop
    Helper->>Inst: OUTP OFF, readback
    Helper-->>Runner: state.json released/confirmed, exit
    alt helper did not confirm
        Runner->>Helper: cleanup run "close --instrument psu" (timeout)
    end
    Runner->>Leases: mark unknown or clear, release
    Runner-->>Agent: result with physical state
```

## State

```mermaid
stateDiagram-v2
    [*] --> claimed: keys free (else BUSY)
    claimed --> running: spawn
    running --> stopping: Stop / timeout / close (stop file)
    stopping --> exited: helper exits within grace
    stopping --> exited: tree kill after grace
    running --> exited: helper exits (done or crash)
    exited --> released: read-only, or helper reported released + confirmed/unchanged
    exited --> cleanup: actuating and not confirmed
    cleanup --> released: cleanup confirmed
    cleanup --> unknown: cleanup failed / timed out
    unknown --> released: marker written for each key
    released --> [*]: lease files removed
```

# TASK-324b8162 diagrams

Illustrates `## Design` in `TASK-324b8162.md`. The Design text is authoritative.

Node map: added = can-python package (can_bus.py), can-dbc package (cantools pip, can_decode.py), CAN fixtures,
integration test; changed = catalog.yaml/packs.yaml; unchanged = Provisioner, ProgramRunner, ApprovalGate, rule matcher.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    cp["plugins/can-python<br/>can_bus.py + skills"]:::added
    cd["plugins/can-dbc<br/>cantools (pip) + can_decode.py + skill"]:::added
    catalog["catalog.yaml / packs.yaml"]:::changed
    prov["Provisioner (uv script / pip)"]
    rules["classifyCommand"]
    gate["ApprovalGate (typed confirmation)"]
    runner["ProgramRunner"]
    pycan["python-can 4.6.1 backends<br/>pcan, vector, kvaser, slcan, gs_usb, socketcan, udp_multicast"]
    fixture["fixtures/can<br/>board.dbc, frames.log, fake python-can"]:::added
    test["integration can.test"]:::added
    catalog --> cp
    catalog --> cd
    prov --> cp
    prov --> cd
    rules --> gate
    gate --> runner
    runner --> cp
    runner --> cd
    cp --> pycan
    test --> fixture
    test --> gate
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent as Agent (replay)
    participant Gate as ApprovalGate
    participant Cap as can capture (background)
    participant Bus as udp_multicast bus
    participant Tx as can send / replay
    participant Dec as can-decode
    Agent->>Gate: can capture ... --duration 12 --output captures/bus.asc
    Gate-->>Agent: device-read approved
    Gate->>Cap: start background run
    Agent->>Gate: can send --id 0x100 ...
    Gate-->>Agent: waits for typed "send"
    Gate->>Tx: start after the word
    Tx->>Bus: frames
    Bus->>Cap: frames written to bus.asc
    Cap-->>Agent: stopped by duration
    Agent->>Dec: can-decode --dbc board.dbc --input captures/bus.asc (safe)
    Dec-->>Agent: decoded signals and unknown-ID counts
```

## State

Not drawn: no new lifecycle; background runs reuse the existing run states.

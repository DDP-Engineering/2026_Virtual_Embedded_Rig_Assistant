# TASK-b0622500 diagrams

Illustrates `## Design` in `TASK-b0622500.md`. The Design text is authoritative.

Node classes: added = plugin ble-tools, ble_support modules, fake Bleak; changed = lab-resources.ts (kind ble-device),
scpi registry.py; unchanged = program-tools, ProgramRunner, ResourceLeases, approval gate.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    reg[("lab/resources.json ble-device")] --> labres["lab-resources.ts kind + key ble:addr"]:::changed
    labres --> tools["run_program claimedResources"]
    manifest["ble-tools plugin.yaml resources --device"]:::added --> tools
    tools --> runner["ProgramRunner + ResourceLeases"]
    runner --> cli["ble_support.cli"]:::added
    cli --> ops["operations / scan / device / notify / write"]:::added
    ops --> prof["profile + payload"]:::added
    ops --> backend["backend (Bleak 3.1.0 check)"]:::added
    backend --> bleak[("Bleak WinRT / BlueZ")]
    ops --> results[("arduino-iot-results/&lt;run-id&gt;")]
    reg --> scpi["scpi registry.py skips ble-device"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant A as Agent
    participant R as Runner (lease ble:addr)
    participant H as ble-tool
    participant B as Bleak
    participant D as BLE device
    A->>R: subscribe-notifications --device thermo --profile p.json
    R->>H: spawn (registry hash, control folder)
    H->>H: registry, profile, request checks
    H->>B: find_device_by_address (connectTimeoutS)
    B->>D: connect (pair=False)
    H->>B: GATT check, identity read
    H->>B: start_notify
    D-->>H: notifications -> bounded queue -> jsonl/csv
    H->>B: stop_notify, disconnect
    H-->>R: state.json released / confirmed
    R-->>A: result, lease released
```

## State

```mermaid
stateDiagram-v2
    [*] --> unchanged
    unchanged --> pending: connected
    pending --> confirmed: subscriptions stopped and disconnected
    pending --> unknown: stop_notify failed, link lost while subscribed, killed
    unknown --> confirmed: release finds no held connection
```

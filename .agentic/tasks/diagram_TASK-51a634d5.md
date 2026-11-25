# TASK-51a634d5 diagrams

The design in [TASK-51a634d5](TASK-51a634d5.md) defines the implementation.

## Structure

Node map: added = capture-files, packet index, transforms, exports; changed = tools and managed storage; reused = write queue and external Wireshark tools.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    tools["Wireshark tools"]:::changed ==> files["capture-files"]:::added
    files ==> index["capture-file-index"]:::added
    files ==> transform["capture-file-transform"]:::added
    files ==> export["capture-file-export"]:::added
    files ==> storage["Managed capture storage"]:::changed
    storage --> queue["Workbench WriteQueue"]
    transform ==> native["External Wireshark tools"]
    export ==> native
```

## Sequence

```mermaid
sequenceDiagram
    participant Tool as Wireshark tool
    participant Host as capture-files
    participant Native as External Wireshark tools
    participant Storage as Managed storage
    Tool->>Host: Typed offline operation
    Host->>Host: Snapshot sources and validate bounds
    Host->>Native: Host-owned arguments and bounded stdout
    Native-->>Host: Staged result
    Host->>Host: Verify payload, timestamps and lineage
    Host->>Storage: Admit and reverify all completed outputs
    Storage-->>Tool: Managed capture references
```

## State

```mermaid
stateDiagram-v2
    [*] --> Snapshot
    Snapshot --> Staged
    Staged --> Verified
    Verified --> Published
    Snapshot --> Rejected
    Staged --> Rejected
    Verified --> Rejected
    Rejected --> [*]
    Published --> [*]
```

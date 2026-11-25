# TASK-5dd935de diagrams

Illustrates the [design](TASK-5dd935de.md).

## Structure

SessionService and ProgramRunner change. The capture tool, analysis service and capture storage
are added. TShark and the resolver are reused.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    session["SessionService"]:::changed --> tool["Capture tool"]:::added
    tool --> analysis["Offline analysis"]:::added
    analysis --> store["Capture storage"]:::added
    analysis --> resolver["ProgramResolver"]
    analysis --> runner["ProgramRunner"]:::changed
    runner --> tshark["TShark"]
```

## Sequence

```mermaid
sequenceDiagram
    participant Session
    participant Analysis
    participant Storage
    participant TShark
    Session->>Analysis: Query packets
    Analysis->>Storage: Snapshot and hash the verified capture
    Storage-->>Analysis: Capture identity and private snapshot
    Analysis->>TShark: Decode bounded selection
    TShark-->>Analysis: Selected metadata
    Analysis-->>Session: Coverage, frame references and continuation
```

## State

```mermaid
stateDiagram-v2
    [*] --> PrivateSnapshot
    PrivateSnapshot --> Validated: Complete native validation
    PrivateSnapshot --> Discarded: Invalid or incomplete
    Validated --> Published: Quota and identity checks pass
    Validated --> Discarded: Publication refused
    Published --> [*]
    Discarded --> [*]
```

# TASK-26d89670 diagrams

Illustrates the design in [TASK-26d89670.md](TASK-26d89670.md).

## Structure

Added: ModelCalibrationStore. Changed: SessionService and the CLI and desktop composition. Reused: ContextCompactor and FileAccess.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    hosts["CLI run / SessionsHost"]:::changed --> service["SessionService"]:::changed
    hosts ==> cache["ModelCalibrationStore"]:::added
    service ==> cache
    service --> compactor["ContextCompactor"]
    cache ==> files["FileAccess"]
```

## Sequence

```mermaid
sequenceDiagram
    participant S as SessionService
    participant C as ModelCalibrationStore
    participant R as ReferenceRuntime
    S->>R: Start fresh session turn
    R->>S: Prepare model before budgeting
    S->>C: Read matching model ratio
    C-->>S: Ratio or empty
    S-->>R: Prepared compactor
    R-->>S: Accepted calibration usage event
    S->>C: Save ratio after storing event
    C-->>S: Atomic save completed or cache unavailable
```

## State

Not drawn: application cache records add no session lifecycle or status.

# TASK-b6bdee40 diagrams

Illustrates the Design in TASK-b6bdee40.md.

## Structure

SessionService and ToolRegistry change. DelegationsRepository is added. ReferenceRuntime and the gateway are reused.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    service["SessionService"]:::changed ==> delegation["DelegationsRepository"]:::added
    service --> runtime["ReferenceRuntime"]
    service --> registry["ToolRegistry"]:::changed
    service --> gateway["LlmGateway"]
```

## Sequence

```mermaid
sequenceDiagram
    participant Parent
    participant SessionService
    participant LlmGateway
    participant ReferenceRuntime
    participant DelegationsRepository
    Parent->>SessionService: Launch child
    SessionService->>LlmGateway: Prepare model and validate reasoning
    SessionService->>ReferenceRuntime: Start child and admit first turn
    SessionService->>DelegationsRepository: Record child and request identity
    SessionService-->>Parent: Return original launch identifiers
    ReferenceRuntime->>LlmGateway: Stream child turn after admission
```

## State

```mermaid
stateDiagram-v2
    [*] --> Validating
    Validating --> Rejected: invalid or full
    Validating --> Running: atomic admission
    Running --> Idle: completes, stops, or recovers
    Running --> Error: turn fails
    Idle --> Archived: archive
    Error --> Archived: archive
    Archived --> Idle: restore idle child
    Idle --> Deleted: delete child
    Error --> Deleted: delete child
    Archived --> Deleted: delete archived child
```

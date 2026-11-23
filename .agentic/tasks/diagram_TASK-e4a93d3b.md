# TASK-e4a93d3b diagrams

Illustrates the Design in TASK-e4a93d3b.md.

## Structure

Added nodes: QuestionCard, Questions. Changed nodes: SessionService. Unchanged nodes: SessionHub.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    card["QuestionCard"]:::added ==> service["SessionService"]:::changed
    service ==> registry["Questions"]:::added
    service --> hub["SessionHub"]
```

## Sequence

```mermaid
sequenceDiagram
    participant Runtime as ReferenceRuntime
    participant Questions
    participant Card as QuestionCard
    Runtime->>Questions: Open question
    Questions-->>Card: Publish question event
    Card->>Questions: Submit explicit answer
    Questions-->>Runtime: Return settled outcome
```

## State

```mermaid
stateDiagram-v2
    [*] --> Pending
    Pending --> Answered: User response
    Pending --> Automatic: Eligible expiry
    Pending --> Cancelled: Cancel or stop
```

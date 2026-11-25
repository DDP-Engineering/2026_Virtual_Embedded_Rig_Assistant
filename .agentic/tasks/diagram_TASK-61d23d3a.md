# TASK-61d23d3a diagrams

Illustrates [the task design](TASK-61d23d3a.md).

## Structure

Changed: inspectWireshark. Added: traffic-native and traffic projection. Reused: TShark.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    service["inspectWireshark"]:::changed ==> native["traffic-native"]:::added
    native ==> tshark["TShark"]
    native ==> projection["traffic projection"]:::added
```

## Sequence

```mermaid
sequenceDiagram
    participant Tool as inspectWireshark
    participant Adapter as traffic-native
    participant Native as TShark
    Tool->>Adapter: Analyze verified saved capture
    Adapter->>Native: Read fixed packet fields and optional follow tap
    Native-->>Adapter: Bounded native evidence
    Adapter-->>Tool: Validated facts without payload
```

## State

Not drawn because the operations are read-only requests without a new lifecycle.

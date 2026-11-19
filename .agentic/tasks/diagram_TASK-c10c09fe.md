# TASK-c10c09fe diagrams

Illustrates `## Design` in `TASK-c10c09fe.md`. The Design text is authoritative.

## Structure

Added nodes are delegated-sessions and delegation-monitor. Changed nodes are ReferenceRuntime, ToolRegistry, SessionService and SessionHub.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    runtime["ReferenceRuntime"]:::changed --> registry["ToolRegistry"]:::changed
    service["SessionService"]:::changed --> registry
    registry ==> tools["delegated-sessions"]:::added
    tools ==> service
    tools ==> monitor["delegation-monitor"]:::added
    monitor ==> service
    service --> hub["SessionHub"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant runtime as ReferenceRuntime
    participant tool as delegated-sessions
    participant service as SessionService
    participant hub as SessionHub
    runtime->>tool: session_launch with invocation identity
    tool->>service: launchDelegated with scoped request key
    service-->>runtime: session and initial turn IDs
    runtime->>runtime: Continue parent work
    runtime->>tool: session_wait
    tool->>service: inspectDelegated
    service-->>tool: Initial turn and revision
    tool->>service: subscribeDelegated from revision
    service->>hub: Follow replay and live events
    hub-->>tool: Child turn finishes
    tool->>service: Inspect tracked outcome
    tool-->>runtime: Bounded, masked reply
```

## State

```mermaid
stateDiagram-v2
    [*] --> Inspect
    Inspect --> Returned: Already settled or approval pending
    Inspect --> Waiting: Initial turn running and time remains
    Waiting --> Returned: Terminal or approval event
    Waiting --> Returned: Deadline with current progress
    Waiting --> Rejected: Abort or observation failure
    Returned --> [*]: Dispose
    Rejected --> [*]: Dispose
```

# TASK-5f92b089 diagrams

Illustrates the Design section of [TASK-5f92b089.md](TASK-5f92b089.md).

## Structure

Changed nodes are SessionService, ReferenceRuntime and ContextCompactor. Session images is added. SQLite and the provider gateway are reused.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    service["SessionService"]:::changed ==> reader["Session images"]:::added
    service --> db[("SQLite paths")]
    service --> runtime["ReferenceRuntime"]:::changed
    runtime --> compact["ContextCompactor"]:::changed
    service ==> gateway["Provider gateway"]
```

## Sequence

```mermaid
sequenceDiagram
    participant IPC as session.send
    participant Session as SessionService
    participant Images as Session images
    participant Runtime as ReferenceRuntime and ContextCompactor
    participant Model as Provider gateway
    IPC->>Session: Text and relative paths
    Session->>Images: Validate image files
    Images-->>Session: Valid attachment references
    Session->>Runtime: Admit initial or queued prompt
    Runtime->>Session: Dispatch budgeted request
    Session->>Images: Load images for vision dispatch
    Session->>Model: Text with image or path parts
```

## State

Not drawn because chat admission and turn states are reused.

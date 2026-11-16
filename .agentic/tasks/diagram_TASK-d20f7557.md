# TASK-d20f7557 diagrams

Illustrates the authoritative Design in TASK-d20f7557.md.

## Structure

Node map: IPC, SessionService and reducer changed; SessionHub, events store and agent reused unchanged.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    ipc["session.bookmark IPC"]:::changed ==> service["SessionService.bookmark"]:::changed
    service ==> hub["SessionHub"]
    hub --> db[("events")]
    hub ==> reducer["session-state reducer"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant Renderer
    participant IPC
    participant Service as SessionService
    participant Hub as SessionHub
    participant DB as SQLite
    Renderer->>IPC: session.bookmark
    IPC->>Service: bookmark(sessionId,messageId,bookmarked)
    Service->>Service: writable, archive and user ownership checks
    Service->>DB: begin transaction
    Service->>Hub: record message.bookmarked
    Hub->>DB: append event
    Service->>DB: commit
    Service->>Hub: publish committed event
    Hub-->>Renderer: sequenced message.bookmarked
    IPC-->>Renderer: {}
```

## State

```mermaid
stateDiagram-v2
    [*] --> Unbookmarked
    Unbookmarked --> Bookmarked: known user / bookmarked true
    Bookmarked --> Unbookmarked: known user / bookmarked false
    Bookmarked --> Bookmarked: bookmarked true
    Unbookmarked --> Unbookmarked: unknown or non-user target
```

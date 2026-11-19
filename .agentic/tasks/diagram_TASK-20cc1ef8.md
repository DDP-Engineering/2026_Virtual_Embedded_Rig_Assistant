# TASK-20cc1ef8 diagrams

Illustrates Design in [TASK-20cc1ef8.md](TASK-20cc1ef8.md).

## Structure

Changed: SessionService, App. Added: DelegationLinks. Reused: session transcript and Stop.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    svc["SessionService"]:::changed ==> app["App"]:::changed
    app ==> links["DelegationLinks"]:::added
    links ==> transcript["SessionWorkspace transcript and Stop"]
```

## Sequence

```mermaid
sequenceDiagram
    participant Core as SessionService
    participant App
    participant View as SessionWorkspace
    Core-->>App: Workbench notification after commit
    App->>Core: Refresh session.list
    Core-->>App: Scoped metadata and outcome
    App->>View: Render links and status
    View->>App: Open linked Chat
    View->>Core: Existing session.get, event subscription and session.stop
```

## State

```mermaid
stateDiagram-v2
    [*] --> Running
    Running --> Approval
    Approval --> Running
    Running --> Completed
    Running --> Failed
    Running --> Limited
    Running --> Stopped
    Running --> Interrupted
    Approval --> Stopped
    Approval --> Interrupted
```

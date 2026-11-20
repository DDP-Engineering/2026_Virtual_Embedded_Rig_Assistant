# TASK-30c92716 diagrams

Illustrates the Design in TASK-30c92716.md.

## Structure

New: agent browser port and Desktop adapter. Changed: SessionService,
ToolRegistry and ReferenceRuntime. Changed in build: BrowserHost (close signal), policy (grant signal) and proxy (document refusal).

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    session["SessionService"]:::changed ==> registry["ToolRegistry"]:::changed
    registry ==> agent["Agent browser port and Desktop adapter"]:::added
    runtime["ReferenceRuntime"]:::changed ==> registry
    agent ==> host["BrowserHost"]:::changed
    host --> policy["BrowserAccessPolicy"]:::changed
    policy --> proxy["Public browser proxy"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant A as ReferenceRuntime
    participant T as Desktop browser port
    participant H as BrowserHost
    participant P as Public browser proxy
    A->>T: Open authorized page
    T->>H: Resolve own browser lease and tab
    H->>P: Navigate through public policy
    T-->>A: Tab and final URL
    A->>T: Snapshot, then follow its link reference
    T->>P: Navigate to authorized link
    T-->>A: Final citation URL
```

## State

```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Reading: Authorized open
    Reading --> Referenced: Snapshot
    Referenced --> Reading: Navigation or scroll
    Referenced --> Referenced: Replace snapshot revision
    Referenced --> Closed: Close, revoke, active cancellation
    Reading --> Closed: Close, revoke, active cancellation
```

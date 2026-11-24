# TASK-be584c0e diagrams

Illustrates the design in TASK-be584c0e.md.

## Structure

SessionService, SessionsHost, App and WorkbenchRuntimes are changed. SessionNotifications is added. SessionHub and Electron Notification are reused.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    hub["SessionHub"] --> core["SessionService"]:::changed
    core ==> host["SessionsHost"]:::changed
    host ==> notices["SessionNotifications"]:::added
    notices ==> native["Notification"]
    notices ==> app["App"]:::changed
    app ==> workbenches["WorkbenchRuntimes"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant Host as "SessionsHost"
    participant Notices as "SessionNotifications"
    participant Native as "Notification"
    participant App as "App"
    participant Runtimes as "WorkbenchRuntimes"
    Host->>Notices: Committed activity
    Notices->>Host: Recheck pending approval after publication
    Notices->>Native: Show generic text
    Native-->>Notices: Native click
    Notices->>App: One-shot activation
    App->>App: Check editor guard
    App->>Runtimes: Redeem activation and validate before promotion
    Runtimes-->>App: Verified workbench and session
```

## State

```mermaid
stateDiagram-v2
    [*] --> Candidate: Committed activity
    Candidate --> [*]: Suppressed or already settled
    Candidate --> Submitted: Eligible
    Submitted --> [*]: Failed or resolved
    Submitted --> Clicked: Native click
    Clicked --> [*]: Redeemed, canceled or stale
```

# TASK-9dd57a7c diagrams

Illustrates Design in TASK-9dd57a7c.md.

## Structure

Changed: SessionNotifications, NotificationSettings, App and SessionWorkspace.
Reused: SessionService, native presenter, settings service.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#1b7837
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed fill:#f9dddd,stroke:#a00000
    service["SessionService"] --> notices["SessionNotifications"]:::changed
    form["NotificationSettings"]:::changed --> settings["SettingsService"]
    settings --> notices
    notices --> native["Electron Notification"]
    notices --> app["App"]:::changed
    app --> card["SessionWorkspace"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant S as SessionService
    participant N as SessionNotifications
    participant E as Electron Notification
    participant A as App
    participant W as WorkbenchRuntimes
    S->>N: Live pending question
    N->>E: Present eligible generic alert
    E->>N: Click
    N->>A: Opaque token
    A->>W: Resolve token after editor confirmation
    W-->>A: Verified session and still-pending question ID
    A->>W: Read live Activity before focusing
    W-->>A: Current question status
    S->>N: Settlement invalidates token and dismisses notice
```

## State

```mermaid
stateDiagram-v2
    [*] --> Observed
    Observed --> Suppressed: Ineligible or settled
    Observed --> Presenting: Pending and eligible
    Presenting --> Clicked: Current native click
    Presenting --> Settled: Answer, cancel, or timeout
    Clicked --> Settled: Settlement invalidates activation
    Settled --> Dismissed: Presenter supplies live notice
```

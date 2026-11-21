# TASK-8983b2e8 diagrams

Illustrates the design in [TASK-8983b2e8.md](TASK-8983b2e8.md).

## Structure

Added: Settings and Chat browser controls, typed IPC. Changed: BrowserRuntime, AgentBrowser.
Reused: BrowserAccessPolicy, workbench config, app settings.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    settings[Settings browser controls]:::added --> ipc[Typed browser IPC]:::added
    chat[Chat browser controls]:::added --> ipc
    ipc --> runtime[BrowserRuntime]:::changed
    ipc --> agent[AgentBrowser]:::changed
    agent --> policy[BrowserAccessPolicy]
    settings --> config[Settings and workbench config]
```

## Sequence

```mermaid
sequenceDiagram
    participant Chat
    participant Main
    participant Policy
    participant Chromium
    Chat->>Main: Grant origin for this owner
    Main->>Policy: Grant after ownership check
    Chat->>Main: Send turn
    Main->>Chromium: Open through owned lease
    Chat->>Main: Read current owner state
    Main-->>Chat: Activity and authorized location
    Chat->>Main: Revoke access
    Main->>Policy: Release grant
    Main->>Chromium: Dispose owned browser
```

## State

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Granted: Explicit origin grant
    Granted --> Browsing: Agent opens a page
    Browsing --> Browsing: Navigate within live grants
    Browsing --> Closed: External window closes
    Granted --> Idle: Revoke
    Browsing --> Idle: Close or revoke
    Closed --> Granted: New grant
```

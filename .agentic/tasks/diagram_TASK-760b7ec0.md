# TASK-760b7ec0 diagrams

Illustrates the Design in TASK-760b7ec0.md.

## Structure

Added: UnreadCompletions, ActivityView. Changed: App, SessionsHost, sessionActivityOpen.
Reused: successfulOrdinaryTurn, WorkbenchRuntimes.open, pendingQuestionFocus.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    success["successfulOrdinaryTurn"] ==> unread["UnreadCompletions"]:::added
    host["SessionsHost.activity"]:::changed --> app["App"]:::changed
    unread ==> app
    app ==> view["ActivityView"]:::added
    view ==> opener["session.activity.open"]:::changed
    opener ==> runtime["WorkbenchRuntimes.open"]
    app --> focus["pendingQuestionFocus"]
```

## Sequence

```mermaid
sequenceDiagram
    participant View as ActivityView
    participant App
    participant Main as session.activity.open
    participant Runtime as WorkbenchRuntimes.open
    View->>App: Activate row
    App->>App: Confirm leaving dirty editor
    App->>Main: Open exact target
    Main->>Runtime: Guard before promotion
    Runtime-->>Main: Verified owner
    Main-->>App: Workbench and session
    App->>View: Close and show transcript
```

## State

```mermaid
stateDiagram-v2
    [*] --> Unread: Successful live reply
    Unread --> [*]: Successful open or mark all
    Unread --> [*]: Eviction or unavailable owner
```

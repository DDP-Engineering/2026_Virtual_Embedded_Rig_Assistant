# TASK-da9a680b diagrams

Illustrates `## Design` in `TASK-da9a680b.md`. The Design text is authoritative.

Node classes from the Design: added = useSessionActivity, WorkbenchActivity, capacity count;
changed = WorkbenchNavigation, SessionList, App, browser mock; unchanged = main session.activity,
session.capacity, session.stop, workbench.open, useTurnCapacity, SessionWorkspace composer alert (text only).

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    app["App.tsx openSession / stopSession"]:::changed
    nav["WorkbenchNavigation"]:::changed
    act["WorkbenchActivity (heading control + menu)"]:::added
    cap["capacity count (title row)"]:::added
    hook["useSessionActivity"]:::added
    turns["useTurnCapacity"]
    list["SessionList row icons"]:::changed
    mock["browser mock (activity events)"]:::changed
    main["main: session.activity / session.capacity / session.stop / workbench.open"]
    app --> nav
    nav --> act
    nav --> cap
    nav --> hook
    cap --> turns
    app --> list
    hook -->|invoke + app event| main
    turns -->|invoke + app event| main
    act -->|Open / Stop callbacks| app
    app -->|workbench.open, session.stop| main
    hook -. browser mode .-> mock
```

## Sequence

```mermaid
sequenceDiagram
    actor U as User
    participant N as Sidebar (WorkbenchActivity)
    participant A as App
    participant M as Desktop main
    U->>N: open A's activity control (B shown)
    N-->>U: menu: "Edit the board" awaiting approval
    U->>N: Open
    N->>A: openSession(folder A, session id)
    A->>M: workbench.open {folder A}
    M-->>A: snapshot A (retained runtime promoted)
    A->>A: benchChanged(A), select session, focus request
    A-->>U: chat of A's session with its approval card
    M-->>N: app event session.activity
    N->>M: session.activity
    M-->>N: rows (A foreground, B background)
```

## State

```mermaid
stateDiagram-v2
    [*] --> Hidden
    Hidden --> Running: turn.started (activity lists a running session)
    Running --> Awaiting: approval.requested
    Awaiting --> Running: approval.decided
    Running --> Hidden: turn.done / Stop (no session listed)
    Awaiting --> Hidden: Stop (approval aborted, turn ends)
    note right of Awaiting: heading icon ShieldAlert while any listed session awaits approval
```

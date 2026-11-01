# TASK-c99ca08c diagrams

Illustrates `## Design` in `TASK-c99ca08c.md`. The Design text is authoritative.

Node classes (from the Design):

| Node | Class |
|---|---|
| main session-order.ts, session.move channel | added |
| WorkbenchService.recent/open, shared settings/ipc, main session.list, workbench-navigation, session-list, App | changed |
| settings service, sessions host | unchanged (reused) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    nav["workbench-navigation.tsx menu + keys"]:::changed
    list["session-list.tsx menu + keys"]:::changed
    app["App.tsx onMove"]:::changed
    recentIpc["workbench.recent move"]:::changed
    moveIpc["session.move"]:::added
    service["WorkbenchService.recent / open"]:::changed
    order["main session-order.ts"]:::added
    listIpc["main session.list"]:::changed
    settings[("user settings: recentWorkbenches, sessionOrder")]
    nav ==> recentIpc ==> service ==> settings
    list ==> app ==> moveIpc ==> order ==> settings
    listIpc ==> order
```

## Sequence

```mermaid
sequenceDiagram
    participant Row as session row
    participant App
    participant Main as session.move
    participant Order as session-order.ts
    participant Settings
    Row->>App: Move up (menu or Alt+Shift+Up)
    App->>Main: {workbenchId, sessionId, offset: -1}
    Main->>Order: moveSession(list, order, id, -1)
    Order-->>Main: new id order
    Main->>Settings: update sessionOrder[workbenchId]
    App->>Main: session.list (ordered)
    App->>Row: refocus moved row
```

## State

Not drawn: orders are plain lists without a lifecycle.

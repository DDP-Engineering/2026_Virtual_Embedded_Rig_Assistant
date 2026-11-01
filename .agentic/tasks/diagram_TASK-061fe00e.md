# TASK-061fe00e diagrams

Illustrates `## Design` in `TASK-061fe00e.md`. The Design text is authoritative.

| Node | Class |
|---|---|
| document-tabs-store (read/write/remove) | added |
| DocumentViewerProvider (sessionId, restore, save), App (sessionId, delete hook) | changed |
| docs.stat, downloads.list, artifacts.list, localStorage | unchanged (reused) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    app["App (sessionId, delete)"]:::changed --> provider["DocumentViewerProvider (restore, save)"]:::changed
    provider --> store["document-tabs-store"]:::added --> ls[("localStorage vera.tabs.*")]
    provider --> stat["docs.stat / downloads.list / artifacts.list"]
    app --> store
```

## Sequence

```mermaid
sequenceDiagram
    participant A as App
    participant P as DocumentViewerProvider
    participant S as document-tabs-store
    participant M as main (IPC)
    A->>P: session S shown (first time in run)
    P->>S: readTabs(workbench, S)
    S-->>P: version 1 record or nothing
    P->>M: docs.stat / downloads.list / artifacts.list
    M-->>P: existence
    P->>P: install tabs, places, selection (gone tabs dropped)
    P->>S: writeTabs (when tabs were dropped)
```

## State

Not drawn: the tab lifecycle of TASK-79f6ffd3 is unchanged; restore only seeds a session's first tab set.

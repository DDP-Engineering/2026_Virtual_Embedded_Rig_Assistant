# TASK-d798dbc7 diagrams

Illustrates the journal Design, which is authoritative.

## Structure
Node map: Transcript, TranscriptNavigator and shared session-state changed; useBookmarks and BookmarkButton added; api.invoke reused.

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 T["Transcript"]:::changed ==> H["useBookmarks"]:::added
 T ==> B["BookmarkButton"]:::added
 S["shared session-state"]:::changed ==> T
 T --> N["TranscriptNavigator"]:::changed
 N ==> B
 H ==> A["api.invoke"]
```

## Sequence

```mermaid
sequenceDiagram
 participant B as BookmarkButton
 participant H as useBookmarks
 participant A as api.invoke
 B->>H: toggle message
 H->>B: optimistic shared state
 H->>A: session.bookmark
 alt success
 A-->>H: acknowledgement and durable event
 else failure
 A-->>H: error
 H->>B: rollback and alert
 end
```

## State

```mermaid
stateDiagram-v2
 Confirmed --> Pending: toggle
 Pending --> Confirmed: event matches desired value
 Pending --> Confirmed: failure rolls back with alert
```

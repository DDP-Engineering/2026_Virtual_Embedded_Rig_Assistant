# TASK-70a10e42 diagrams

Illustrates the Design in [TASK-70a10e42.md](TASK-70a10e42.md).

## Structure

Changed: DocsTree, GitReader, DocumentViewerProvider. Added: GitHistoryService, history reader and GitHistoryView. Reused: TreeMenu and Chat.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    tree["DocsTree"]:::changed --> menu["TreeMenu"]
    tree ==> service["GitHistoryService"]:::added
    tree --> provider["DocumentViewerProvider"]:::changed
    provider ==> service
    provider ==> view["GitHistoryView"]:::added
    provider --> chat["Chat"]
    service ==> reader["GitReader"]:::changed
    reader ==> history["history reader"]:::added
```

## Sequence

```mermaid
sequenceDiagram
    participant Files as DocsTree
    participant Service as GitHistoryService
    participant Git as GitReader
    participant Tabs as DocumentViewerProvider
    Files->>Service: Selected path eligibility and lease
    Service->>Git: Confined exact tracking check
    Git-->>Files: Eligibility for selection
    Files->>Tabs: Open history target
    Tabs->>Service: Request history for same target
    Service->>Git: Read bounded local HEAD history
    Git-->>Service: Confined result
    Service-->>Tabs: Current lease and Display projection
```

## State

```mermaid
stateDiagram-v2
    [*] --> Loading
    Loading --> Ready
    Loading --> Capped
    Loading --> ScopeBoundary
    Loading --> Unborn
    Loading --> Empty
    Loading --> Unavailable
    Loading --> Malformed
    Loading --> ReadLimit
```

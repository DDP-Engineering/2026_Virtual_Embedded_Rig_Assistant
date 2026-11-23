# TASK-1e495e65 diagrams

Illustrates the Design in TASK-1e495e65.md.

## Structure

Changed: Workbench overview, Files. Added: overview details and shared document index queries. Reused: status hook and renderer API.

```mermaid
flowchart LR
  Workbench[Workbench overview] --> Details[Workbench index details]
  Files --> Queries[Document index queries]
  Details --> Queries
  Details --> Status[Scoped index status]
  Files --> Status
  Status --> API[Renderer API]
  Queries --> API
```

## Sequence

```mermaid
sequenceDiagram
  participant User
  participant Overview
  participant Cache
  participant API
  User->>Overview: Open workbench overview
  Overview->>Cache: Observe status and documents for active workbench
  Cache->>API: Read current status and document records
  API-->>Cache: Snapshot and live updates
  Cache-->>Overview: Refresh status and exception records
```

## State

Not drawn: the existing indexing status states and transitions are unchanged.

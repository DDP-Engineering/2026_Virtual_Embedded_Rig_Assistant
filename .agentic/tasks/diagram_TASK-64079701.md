# TASK-64079701 diagrams

Design in TASK-64079701.md is authoritative.

## Structure

Map: shared channels, DisplayDocuments and WorkbenchService changed; read-bytes and display-bytes added;
locateEntry and DisplayIdentities reused unchanged.

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 ipc["shared channels"]:::changed ==> display["DisplayDocuments"]:::changed
 display --> ids["DisplayIdentities"]
 display ==> service["WorkbenchService"]:::changed
 service ==> reader["read-bytes"]:::added
 reader ==> guard["locateEntry"]
 display ==> masking["display-bytes"]:::added
```

## Sequence

```mermaid
sequenceDiagram
 participant Renderer
 participant DisplayDocuments
 participant WorkbenchService
 participant Filesystem
 Renderer->>DisplayDocuments: docs.readBytes identity and window
 DisplayDocuments->>WorkbenchService: original path and window
 WorkbenchService->>Filesystem: validate, open, bounded read, recheck, close
 Filesystem-->>WorkbenchService: bytes with bounded context
 WorkbenchService-->>DisplayDocuments: host-only source
 DisplayDocuments->>DisplayDocuments: recheck owner, current Display and secrets, mask
 DisplayDocuments-->>Renderer: opaque path, offset, physical size, base64
```

## State

Not drawn: no new lifecycle or persisted state transitions.

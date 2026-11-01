# TASK-e5310cdb diagrams

Illustrates `## Design` in `TASK-e5310cdb.md`. The Design text is authoritative.

| Node | Class |
|---|---|
| readdir filter adapter, index.volume event, docs.volume channel, volume warning | added |
| documentKind, Ingester.selected/reconcile, WorkbenchService, docs-tab, workbench-documents | changed |
| tinyglobby, DocumentsRepository, processor | unchanged (reused) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    adapter["readdir filter (ignore rules + documentKind)"]:::added
    glob["tinyglobby include/exclude"]
    selected["Ingester.selected()"]:::changed
    reconcile["Ingester.reconcile()"]:::changed
    rows[("documents rows")]
    volume["index.volume / docs.volume"]:::added
    docs["Docs tab warning"]:::added
    preview["Documents section warning"]:::added
    adapter --> glob --> selected --> reconcile
    reconcile -->|remove unselected rows| rows
    reconcile --> volume --> docs
    preview -.->|DocumentPreview files/bytes| preview
```

## Sequence

```mermaid
sequenceDiagram
    participant Ingester
    participant Glob as tinyglobby + adapter
    participant DB as DocumentsRepository
    participant UI as Docs tab
    Ingester->>Glob: include/exclude, fs.readdir filtered
    Glob-->>Ingester: document paths only (ignored folders never listed)
    Ingester->>Ingester: lstat each path, sum sizes
    Ingester->>DB: remove rows outside the selection
    Ingester-->>UI: index.volume {files, bytes}
    UI->>UI: warn when files > 2000 or bytes > 2 GiB
```

## State

Not drawn: the volume is a value replaced at each selection.

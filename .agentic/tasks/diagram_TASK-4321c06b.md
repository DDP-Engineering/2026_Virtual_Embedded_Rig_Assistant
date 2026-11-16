# TASK-4321c06b diagrams

Illustrates `## Design` in `TASK-4321c06b.md`. The Design text is authoritative.

Node map: added = guard.ts, IndexGuard, docs.approve, index.guard; changed = Ingester reconcile/reindex,
WorkbenchService, docs.volume, DocsTab, App openEditor, WorkbenchEditor/ConfigForm, events.ts scrub;
unchanged = selectDocuments, meta table.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    tab["DocsTab"]:::changed --> guardUi["IndexGuard"]:::added
    guardUi -->|Index anyway| approve["IPC docs.approve"]:::added
    guardUi -->|Edit exclusions| app["App openEditor(section)"]:::changed
    app --> editor["WorkbenchEditor / ConfigForm"]:::changed
    approve --> service["WorkbenchService"]:::changed
    tab --> volume["IPC docs.volume (+guard)"]:::changed
    volume --> service
    service --> ingester["Ingester reconcile / reindex"]:::changed
    ingester --> select["selectDocuments"]
    ingester --> guard["guard.ts: fileLimit, topFolders"]:::added
    ingester --> meta["meta index_approved_files"]
    ingester -->|index.guard| scrub["events.ts scrub"]:::changed
    scrub --> tab
```

## Sequence

```mermaid
sequenceDiagram
    participant T as Docs tab
    participant S as WorkbenchService
    participant G as Ingester
    participant X as Indexer process
    G->>X: select {root, docs}
    X-->>G: paths (12,000)
    G->>G: documentGuard(paths, maxFiles, approved)
    G-->>T: index.volume, index.guard {files 12000, limit 10000, folders}
    Note over G: no row created, changed or removed
    T->>S: docs.approve {files 12000}
    S->>G: approve -> meta, request()
    G->>X: select
    X-->>G: paths (12,000)
    G-->>T: index.guard null, index.progress, index.document...
```

## State

```mermaid
stateDiagram-v2
    [*] --> Indexing: count <= limit
    [*] --> Guarded: count > limit
    Guarded --> Indexing: Index anyway (approved = count)
    Guarded --> Indexing: exclusions or maxFiles lower the count
    Indexing --> Guarded: count > max(maxFiles, 1.2 x approved)
```

# TASK-b31773a5 diagrams

Illustrates `## Design` in `TASK-b31773a5.md`. The Design text is authoritative.

Node map: added = sizeLimit, size and count fields; changed = shared docs schema and patch,
mergeWorkbench, selectDocuments (Selection.skipped), Ingester reconcile/ingest, editor and create
payloads; unchanged = sourceLimit, useDescribeDocument (Files tab), WorkbenchService.updateConfig.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    fields["Documents & RAG: Maximum file size / Maximum indexed files"]:::added --> payload["Editor Save / Create payload"]:::changed
    fields --> docsSchema["shared docs schema: maxFileMB, maxFiles"]:::changed
    payload --> update["WorkbenchService.updateConfig"]
    update --> merge["mergeWorkbench (null clears maxFileMB)"]:::changed
    update --> ingester["Ingester reconcile / ingest"]:::changed
    ingester --> select["selectDocuments -> paths + skipped"]:::changed
    select --> limit["sizeLimit(kind, docs)"]:::added
    ingester --> limit
    limit --> fixed["sourceLimit (fixed 100 / 20 MiB)"]
    ingester --> files["Files tab: useDescribeDocument"]
```

## Sequence

```mermaid
sequenceDiagram
    participant U as Editor (renderer)
    participant S as WorkbenchService (main)
    participant G as Ingester (main)
    participant X as Indexer process
    U->>S: workbench.config.update {docs.maxFileMB, docs.maxFiles}
    S->>S: mergeWorkbench, write workbench.yaml (format 1)
    S->>G: request()
    G->>X: select {root, docs}
    X-->>G: paths, skipped (too-large), retry
    loop paths + skipped in order
        G->>G: lstat; size > sizeLimit -> unsupported / SIZE_LIMIT
    end
    G-->>U: index.document, index.volume (paths only)
```

## State

Not drawn: no new lifecycle; a skipped document uses the existing unsupported status.

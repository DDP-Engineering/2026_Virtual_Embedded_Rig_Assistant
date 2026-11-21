# TASK-0dff4c83 diagrams

Illustrates `## Design` in `TASK-0dff4c83.md`. The Design text is authoritative.

Node classes from the Design: added = indexer `limits` object, `selectionDocs` helper; changed = kinds
limits, selection, ingest (pause, sizes), inspect/processor ceilings, extractors, embedding host, document
services, IndexerHost/handler, workbench service (docs results, preview), search, volume warning, desktop main,
CLI; unchanged = resolveAdvanced.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    config["workbench config (docs.maxFileMB, advanced)"]
    app["application settings (advanced)"]
    wbs["WorkbenchService"]:::changed
    ingest["Ingester (pause, sizes)"]:::changed
    sel["selectionDocs + sizeLimit"]:::added
    host["IndexerHost"]:::changed
    lim["limits {extractionMs, embeddingIdleMs}"]:::added
    proc["indexer process: selection, inspect, processor"]:::changed
    ext["PDF/Office extractors (base getter)"]:::changed
    emb["EmbeddingHost (idle getter)"]:::changed
    ceil["sourceLimit ceilings 500/64 MiB"]:::changed
    ui["volume warning, Docs panel results"]:::changed
    config --> wbs
    app --> wbs
    wbs --> ingest
    ingest --> sel
    ingest --> host
    app --> lim
    lim --> host
    host --> proc
    proc --> ext
    proc --> emb
    proc --> ceil
    config --> ui
    app --> ui
```

## Sequence

```mermaid
sequenceDiagram
    participant W as WorkbenchService
    participant I as Ingester
    participant H as IndexerHost
    participant P as Indexer process
    participant X as Extractor
    W->>I: request() after a config save
    I->>I: wait the Indexing pause (application value)
    I->>H: select(root, selectionDocs(config))
    H->>P: {type: select, input, limits}
    P-->>H: selection within maxFileMB / textFileMB
    I->>H: process(document)
    H->>P: {type: process, input, limits}
    P->>X: extract with base = limits.extractionMs
    X-->>P: text or timeout
    P-->>H: result; embedding host idles for limits.embeddingIdleMs
```

## State

Not drawn: the design adds no lifecycle, status field or state transition.

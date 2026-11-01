# TASK-f09609fd diagrams

Illustrates `## Design` in `TASK-f09609fd.md`. The Design text is authoritative.

| Node | Class |
|---|---|
| indexer-process, indexer-host, selection.ts, inspect.ts, indexer.status/restart | added |
| Ingester (ports, retry), desktop composition, Docs tab | changed |
| SQLite repositories, watcher, document processor, EmbeddingHost | unchanged (moved behind the protocol) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    subgraph Main["VERA main process"]
      ingester["Ingester (watcher, queue, SQLite writes)"]:::changed
      host["IndexerHost (ids, cancel, restart policy)"]:::added
      search["search_docs ranking"]
    end
    subgraph Indexer["VERA Indexer utility process"]
      handler["createIndexerHandler"]:::added
      select["selectDocuments"]:::added
      inspect["inspectSource"]:::added
      proc["document processor + PDF/office workers"]
      emb["EmbeddingHost (ONNX worker)"]
    end
    ingester --> host
    search --> host
    host <-->|MessagePort| handler
    handler --> select
    handler --> inspect
    handler --> proc
    handler --> emb
    ingester --> db[("workbench SQLite")]
```

## Sequence

```mermaid
sequenceDiagram
    participant I as Ingester (main)
    participant H as IndexerHost
    participant X as Indexer process
    I->>H: select(root, docs)
    H->>X: {id, select}
    X-->>H: paths and sizes
    I->>H: inspect / process(path)
    H->>X: {id, process}
    X--xH: exit (crash)
    H-->>I: reject {retry: true}
    H->>X: fork new process
    I->>I: keep row pending, request reconcile
```

## State

```mermaid
stateDiagram-v2
    [*] --> running
    running --> running: crash (restart, < 3 in 60 s)
    running --> stopped: 3rd crash within 60 s
    stopped --> running: restart() from Docs
```

# TASK-d73ff73d diagrams

Illustrates the Design in TASK-d73ff73d.md.

## Structure

Changed nodes are IndexerHost, EmbeddingHost and createDocumentProcessor. Added nodes are createModelDocumentServices and createPassageBudget. embedding-worker and DocumentsRepository are reused for inference and writes.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    host["IndexerHost"]:::changed ==> services["createModelDocumentServices"]:::added
    services ==> processor["createDocumentProcessor"]:::changed
    processor ==> budget["createPassageBudget"]:::added
    services ==> embedding["EmbeddingHost"]:::changed
    embedding --> worker["embedding-worker"]
    host --> repo["DocumentsRepository"]
```

## Sequence

```mermaid
sequenceDiagram
    participant Main as IndexerHost
    participant Services as createModelDocumentServices
    participant Host as EmbeddingHost
    participant Worker as embedding-worker
    Main->>Services: Process using configured model
    Services->>Services: Chunk using passage tokenizer
    Services->>Host: Embed passage batch
    Host->>Worker: Start if needed and embed
    Worker-->>Main: Return model-identified vectors via host and services
    Main->>Host: Rank with the same model via services
    Host->>Worker: Encode query and rank workbench vectors
```

## State

```mermaid
stateDiagram-v2
    [*] --> Dormant
    Dormant --> Busy: queued call
    Busy --> Idle: queue drained
    Idle --> Busy: new call
    Idle --> Dormant: timeout or last workbench released
    Busy --> Retiring: release or abort
    Retiring --> Dormant: native call drained
```

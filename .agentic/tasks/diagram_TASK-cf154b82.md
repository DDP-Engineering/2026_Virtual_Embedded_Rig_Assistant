# TASK-cf154b82 diagrams

Illustrates the Design in [TASK-cf154b82.md](TASK-cf154b82.md).

## Structure

Added: embedding-model registry and shared manifest schema. Changed: workbench schema, preparation, BGE manifest location and staging. Reused: embedding worker.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    ids["embeddingModelIds"]:::added --> config["workbenchSchema"]:::changed
    ids --> prepare["prepare:model"]:::changed
    schema["embeddingModelManifestSchema"]:::added --> prepare
    prepare --> models["Per-model manifests and assets"]:::changed
    models --> stage["BGE staging"]:::changed
    stage --> worker["Embedding worker"]
```

## Sequence

```mermaid
sequenceDiagram
    participant CLI as prepare:model
    participant Cache as Local model directories
    participant Upstream as Hugging Face pinned asset
    loop Each registered model and pinned asset
        CLI->>Cache: Read asset
        opt Missing and online
            CLI->>Upstream: Fetch pinned asset
            Upstream-->>CLI: Asset bytes
        end
        CLI->>CLI: Verify size and SHA-256
        opt Verified download
            CLI->>Cache: Store asset atomically
        end
    end
```

## State

Not drawn: the task adds no lifecycle states.

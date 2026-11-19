# TASK-dd7b8f09 diagrams

Illustrates the Design in [TASK-dd7b8f09.md](TASK-dd7b8f09.md).

## Structure

Changed components include the editor, configuration service, ingester, SQLite repository, processor and document search. The embedding worker retains its existing interface.

```mermaid
flowchart LR
    classDef changed fill:#faeeda,stroke:#854f0b
    editor["WorkbenchEditor"]:::changed --> config["WorkbenchService.updateConfig"]:::changed
    config --> ingest["Ingester"]:::changed
    ingest --> storage[("Workbench database repository")]:::changed
    ingest --> processor["DocumentProcessor"]:::changed
    processor --> worker["EmbeddingHost"]
    search["DocumentKnowledge"]:::changed --> storage
```

## Sequence

```mermaid
sequenceDiagram
    participant Editor as WorkbenchEditor
    participant Service as WorkbenchService
    participant Ingest as Ingester
    participant Worker as DocumentProcessor
    Editor->>Editor: Confirm the indexed document count
    Editor->>Service: Save confirmed model
    Service->>Ingest: Invalidate old vectors and schedule rebuild
    Service-->>Editor: Return saved configuration
    Ingest->>Worker: Embed persisted extraction with new settings
    Worker-->>Ingest: Return chunks and vectors
    Ingest->>Ingest: Commit results and emit progress
```

## State

```mermaid
stateDiagram-v2
    [*] --> Current
    Current --> Rebuilding: Confirm and save a different model
    Rebuilding --> Rebuilding: Resume incomplete work
    Rebuilding --> Current: Restore vector coverage
```

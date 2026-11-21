# TASK-4226b5fe diagrams

Illustrates the journal design in [TASK-4226b5fe.md](TASK-4226b5fe.md).

## Structure

- Added: searchPublishedDocuments.
- Changed: DocumentKnowledge, WorkbenchService, Ingester, DocumentViewer.
- Reused: KeywordSearch, EmbeddingPort, SQLite.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0e886a
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  files["WorkbenchService"]:::changed --> know["DocumentKnowledge"]:::changed
  files ==> ingest["Ingester"]:::changed
  know ==> search["searchPublishedDocuments"]:::added
  search ==> db["SQLite"]
  search ==> keyword["KeywordSearch"]
  search ==> embed["EmbeddingPort"]
  files --> viewer["DocumentViewer"]:::changed
  viewer --> db
```

## Sequence

```mermaid
sequenceDiagram
  participant K as DocumentKnowledge
  participant R as searchPublishedDocuments
  participant E as EmbeddingPort
  participant I as Ingester
  K->>R: Search request
  R->>E: Rank for candidate revision
  I->>I: Publish source
  E-->>R: Rank response
  R->>R: Check revision, discard and retry
  R-->>K: Validated hits and metadata, or transient unavailable
```

## State

```mermaid
stateDiagram-v2
  [*] --> scanning
  scanning --> indexing: Selection accepted
  scanning --> blocked: Guard or scan failure
  indexing --> settled: Batch finishes
  indexing --> settledWithExceptions: Exceptional sources
  indexing --> blocked: Pending work cannot progress
  settled --> scanning: Follow-up pass
  settledWithExceptions --> scanning: Follow-up pass
  blocked --> scanning: Reconcile
```

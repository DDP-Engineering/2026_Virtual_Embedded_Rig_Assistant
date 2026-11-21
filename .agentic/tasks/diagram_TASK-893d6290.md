# TASK-893d6290 diagrams

The [journal design](TASK-893d6290.md) defines the implementation.

## Structure

Added: IndexStatus, DocumentIndexStatus, RetrievalNotice. Changed: Ingester,
WorkbenchService, Electron IPC, transcriptRows. Reused: SQLite, session tool metadata.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  ing["Ingester"]:::changed --> db["SQLite"]
  ing ==> collector["IndexStatus"]:::added
  workbench["WorkbenchService"]:::changed ==> collector
  ipc["Electron IPC"]:::changed ==> workbench
  status["DocumentIndexStatus"]:::added ==> ipc
  projection["transcriptRows"]:::changed ==> notice["RetrievalNotice"]:::added
  projection --> metadata["Session tool metadata"]
```

## Sequence

```mermaid
sequenceDiagram
  participant R as DocumentIndexStatus
  participant M as Electron IPC
  participant W as WorkbenchService
  participant I as Ingester
  R->>M: Subscribe to active lease
  R->>M: Request current status
  M->>W: Validate id and lease
  W->>I: Read current status
  I-->>R: Scoped snapshot
  I-->>R: Ordered coalesced update
  R->>R: Accept matching newer revision
```

## State

```mermaid
stateDiagram-v2
  [*] --> scanning
  [*] --> readOnly
  scanning --> indexing: Accepted selection
  scanning --> rebuilding: Model change
  scanning --> countGuard: Guarded selection
  scanning --> blocked: Selection error
  indexing --> scanning: Follow-up queued
  indexing --> ready: Settled searchable
  indexing --> exceptions: Settled with exclusions
  indexing --> empty: Settled without passages
  rebuilding --> scanning: Follow-up queued
  rebuilding --> ready: Settled searchable
  rebuilding --> exceptions: Settled with failures
  rebuilding --> empty: Settled without passages
  indexing --> stopped: Indexer paused
  stopped --> scanning: Restart
  ready --> scanning: Reconcile
  countGuard --> scanning: Approval or changed selection
  blocked --> scanning: Reindex
```

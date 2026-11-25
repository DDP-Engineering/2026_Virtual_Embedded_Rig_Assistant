# TASK-a78209f5 diagrams

Illustrates the Design in [TASK-a78209f5.md](TASK-a78209f5.md).

## Structure

Added compareCaptures and comparisonReport. Changed inspectWireshark and issuedCaptureCitations.
Reused OfflineTshark and artifact_save.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed fill:#fce0df,stroke:#a32929
    service["inspectWireshark"]:::changed ==> compare["compareCaptures"]:::added
    compare ==> native["OfflineTshark"]
    compare ==> citations["issuedCaptureCitations"]:::changed
    compare ==> report["comparisonReport"]:::added
    report ==> artifact["artifact_save"]
```

## Sequence

```mermaid
sequenceDiagram
    participant S as inspectWireshark
    participant C as compareCaptures
    participant T as OfflineTshark
    participant R as comparisonReport
    S->>C: Verified baseline and candidate snapshots
    C->>T: Read normalized facts from each saved capture
    T-->>C: Scoped packet and timing facts
    C->>R: Bounded comparison projection
    R-->>S: Markdown report
```

## State

The comparison is a read operation with a result for one request.

# TASK-6c9ed425 diagrams

Illustrates the Design in [TASK-6c9ed425.md](TASK-6c9ed425.md).

## Structure

Media projection is added. The service, native validation, citation and model projection change. The traffic facts reader is reused.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    service["inspectWireshark"]:::changed ==> media["analyzeMedia"]:::added
    media ==> facts["readTrafficFacts"]
    facts --> native["OfflineTshark"]:::changed
    media ==> citation["captureCitation"]:::changed
    media ==> model["maskCaptureOutput"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant VERA as inspectWireshark
    participant Media as analyzeMedia
    participant Native as OfflineTshark
    VERA->>Media: Verified snapshot and bounds
    Media->>Media: Reject embedded secrets
    Media->>Native: Validate fields and read bounded facts
    Native-->>Media: Fixed fields and frame locators
    Media-->>VERA: Compact media evidence and RTP statistics
```

## State

Not drawn: the operation adds no lifecycle.

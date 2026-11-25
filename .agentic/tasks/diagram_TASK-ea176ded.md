# TASK-ea176ded diagrams

Illustrates the design in `TASK-ea176ded.md`.

## Structure

Changed nodes: `inspectWireshark`, `OfflineTshark`. Added node: `analyzeAutomotive`.
Reused nodes: `readTrafficFacts`, `captureCitation`.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    service["inspectWireshark"]:::changed ==> profile["analyzeAutomotive"]:::added
    profile ==> facts["readTrafficFacts"]
    profile ==> tshark["OfflineTshark"]:::changed
    facts --> tshark
    profile ==> cite["captureCitation"]
```

## Sequence

```mermaid
sequenceDiagram
    participant Service as inspectWireshark
    participant Profile as analyzeAutomotive
    participant Native as OfflineTshark
    Service->>Profile: Verified snapshot and profile
    Profile->>Native: Read bounded capture facts
    Native-->>Profile: Frame and transport observations
    Profile->>Native: Dissect same prefix into PDML
    Native-->>Profile: Ordered protocol and reassembly trees
    Profile-->>Service: Coverage and cited evidence page
```

## State

Not drawn: evidence describes the saved capture and has no application lifecycle.

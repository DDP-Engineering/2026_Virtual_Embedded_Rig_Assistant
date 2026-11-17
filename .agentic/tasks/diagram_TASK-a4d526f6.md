# TASK-a4d526f6 diagrams

Illustrates Design in TASK-a4d526f6.md. Design text is authoritative.

## Structure

Node map: viewer-context and DisplayDocuments changed; file-mode added; readers reused unchanged.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  Tabs["viewer-context"]:::changed --> Mode["file-mode"]:::added
  Mode --> Host["DisplayDocuments.stat"]:::changed
  Mode --> Readers["Rendered / readTextFile / readHexFile"]
```

## Sequence

```mermaid
sequenceDiagram
  participant Tabs as viewer-context
  participant Mode as file-mode
  participant Host as DisplayDocuments
  Tabs->>Mode: load ordinary file
  Mode->>Host: docs.stat
  Host-->>Mode: real extension and opaque path
  Mode->>Mode: resolve deliberate or remembered mode
  Mode-->>Tabs: bounded reader result and selected mode
```

## State

```mermaid
stateDiagram-v2
  [*] --> Metadata
  Metadata --> Loading: resolve applicable mode
  Loading --> Ready: matching attempt reply
  Loading --> Error: failed read
  Ready --> Loading: deliberate mode selection
  Error --> Loading: Retry
```

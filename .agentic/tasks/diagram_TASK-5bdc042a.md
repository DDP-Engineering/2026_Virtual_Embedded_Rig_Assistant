# TASK-5bdc042a diagrams

Illustrates Design in TASK-5bdc042a.md. Design is authoritative.
Node map: viewer-context changed; HexViewer/HexSource added; docs.readBytes unchanged.

## Structure
```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 context["viewer-context"]:::changed ==> view["HexViewer"]:::added
 view ==> source["HexSource"]:::added
 source ==> host["docs.readBytes"]
```

## Sequence
```mermaid
sequenceDiagram
 participant U as HexViewer
 participant S as HexSource
 participant H as docs.readBytes
 U->>S: find(pattern, signal)
 loop bounded chunks
 S->>H: read masked window
 H-->>S: physical bytes
 S->>S: check cancellation, KMP, yield
 end
 S-->>U: next physical match
```

## State
```mermaid
stateDiagram-v2
 [*] --> Loading
 Loading --> Ready: verified window
 Loading --> Error: failed read
 Ready --> Searching: Find
 Searching --> Ready: hit or cancelled
 Searching --> Error: failed read
 Error --> Loading: Retry
 Ready --> [*]: owner change or unmount
 Searching --> [*]: abort and dispose
```

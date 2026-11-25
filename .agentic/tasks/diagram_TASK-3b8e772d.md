# TASK-3b8e772d diagrams

Illustrates the Design in TASK-3b8e772d.md.

## Structure

Changed: `inspectWireshark`, `CaptureFileNative`, `indexCapture`, `publishCaptures`.
Added: `importHexdump`, `parseHexdump`. Reused: text2pcap.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    service["inspectWireshark"]:::changed ==> job["importHexdump"]:::added
    job ==> parser["parseHexdump"]:::added
    job ==> native["CaptureFileNative"]:::changed
    native ==> text["text2pcap"]
    job ==> audit["indexCapture"]:::changed
    job ==> storage["publishCaptures"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant Tool as wireshark_derive
    participant Job as importHexdump
    participant Native as text2pcap
    participant Store as publishCaptures
    Tool->>Job: Import saved path with explicit profile
    Job->>Job: Snapshot, hash and parse
    Job->>Native: Convert canonical text
    Native-->>Job: Bounded PCAPNG stream
    Job->>Job: Audit packets and stage provenance
    Job->>Store: Publish binary and manifest together
    Store-->>Job: Managed capture
    Job-->>Tool: Managed identities and provenance
```

## State

Not drawn: the operation has no new persistent lifecycle or status field.

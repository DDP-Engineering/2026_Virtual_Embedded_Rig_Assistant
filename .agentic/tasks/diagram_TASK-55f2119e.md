# TASK-55f2119e diagrams

Illustrates the Design in [TASK-55f2119e.md](TASK-55f2119e.md).

## Structure

The package and delivery commands change. The shared pin catalog and archive reader are added. The model registry and files remain inputs.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    models["Model registry and pins"] --> payload["embedding-payload.mjs"]:::added
    payload --> package["package.mjs"]:::changed
    payload --> delivery["verify-delivery.mjs"]:::changed
    archive["verify-embedding-archive.mjs"]:::added --> delivery
```

## Sequence

```mermaid
sequenceDiagram
    participant Delivery as verify-delivery.mjs
    participant Reader as verify-embedding-archive.mjs
    participant Tool as Full 7-Zip
    Delivery->>Reader: Verify artifact against source pins
    Reader->>Tool: Read exact archive members
    Tool-->>Reader: Stream member bytes
    Reader-->>Delivery: Match or member failure
```

## State

No lifecycle or status fields change.

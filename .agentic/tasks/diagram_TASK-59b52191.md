# TASK-59b52191 diagrams

See [the task design](TASK-59b52191.md).

## Structure

Changed: tool schema, offline service, citations and masking. Added: network profile
and evidence projection. Reused: capture snapshot, traffic facts and native TShark.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    Schema["Capture tool schema"]:::changed ==> Service["Offline service"]:::changed
    Service --> Snapshot["Capture snapshot"]
    Service ==> Network["Network profiles and evidence"]:::added
    Network --> Facts["Native traffic facts"]
    Facts --> TShark["TShark"]
    Network ==> Citations["Citations and model masking"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant Caller
    participant Service as Offline service
    participant Network as Networking evidence
    participant Native as TShark
    Caller->>Service: Query saved capture
    Service->>Service: Verify local capture identity
    Service->>Network: Snapshot and typed query
    Network->>Network: Check embedded-secret boundary
    Network->>Native: Read bounded metadata
    Native-->>Network: Frame facts and native fields
    Network-->>Service: Page with references and coverage
    Service-->>Caller: Masked evidence
```

## State

No lifecycle or state transitions change.

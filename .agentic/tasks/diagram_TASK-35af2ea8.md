# TASK-35af2ea8 diagrams

Illustrates the task journal's Design.

## Structure

Added: hosted-catalog.ts. Changed: provider-presets.ts, preset-connection.ts, providers.ts and curated-adapters.ts. Reused: the Settings editor and the curated credential store.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    editor["custom-provider-editor.tsx"] --> registry["provider-presets.ts"]:::changed
    discovery["preset-connection.ts"]:::changed ==> parse["hosted-catalog.ts"]:::added
    discovery --> registry
    gateway["providers.ts"]:::changed --> discovery
    gateway --> credentials["CredentialStore"]
    gateway ==> adapter["curated-adapters.ts"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant Editor as Custom provider editor
    participant Main as ProviderGateway
    participant Core as Curated provider gateway
    participant Service as Hosted API
    Editor->>Main: Discover models for the selected binding
    Main->>Core: Resolve catalog and scoped credential
    Core->>Service: GET fixed catalog
    Service-->>Core: Catalog and possible Fireworks cursor
    Core-->>Editor: Typed discovery result through main
    Main->>Core: Stream a turn on a saved connection
    Core->>Service: POST Chat Completions
    Service-->>Core: SSE tool call
    Core->>Service: POST next request with call and tool result
    Service-->>Core: SSE reply
```

## State

No new lifecycle or state transition.

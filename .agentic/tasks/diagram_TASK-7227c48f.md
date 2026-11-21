# TASK-7227c48f diagrams

Illustrates the Design in `TASK-7227c48f.md`.

## Structure

Changed: hostedProviderPresets, parseHostedCatalog, hostedCompletionsCompatibility.
Added: gateway-catalogs.ts. Reused: picker and preset discovery.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    picker["Settings provider editor"] --> registry["hostedProviderPresets"]:::changed
    registry --> discovery["discoverPresetModels"]
    discovery --> parser["parseHostedCatalog"]:::changed
    parser ==> catalogs["gateway-catalogs.ts"]:::added
    registry --> adapter["hostedCompletionsCompatibility"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant Editor as Provider editor
    participant Gateway as ProviderGateway
    participant Service as Bound provider service
    Editor->>Gateway: Discover with the scoped key
    Gateway->>Service: GET /v1/models
    Service-->>Gateway: Service catalog
    Gateway-->>Editor: Exact IDs and documented profiles
    Editor->>Gateway: Test the explicitly saved model
    Gateway->>Service: POST streaming chat completion
    Service-->>Gateway: SSE events or scoped error
```

## State

No lifecycle or persisted state transition changes.

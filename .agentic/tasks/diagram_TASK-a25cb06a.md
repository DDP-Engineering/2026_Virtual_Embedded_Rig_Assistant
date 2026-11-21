# TASK-a25cb06a diagrams

Illustrates the Design in TASK-a25cb06a.md.

## Structure

Changed: curatedProviderPresets, discoverPresetModels, createPiAiGateway, PresetCatalogCache and mapProviderError. Reused: CredentialStore and pi-ai Chat Completions.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    registry["curatedProviderPresets"]:::changed --> gateway["createPiAiGateway"]:::changed
    gateway --> cache["PresetCatalogCache"]:::changed
    cache --> discover["discoverPresetModels"]:::changed
    gateway --> store["CredentialStore"]
    gateway --> pi["pi-ai Chat Completions"]
    gateway --> errors["mapProviderError"]:::changed
    discover ==> errors
```

## Sequence

```mermaid
sequenceDiagram
    participant V as ProviderGateway
    participant S as CredentialStore
    participant Q as QwenCloud bound endpoint
    V->>S: Resolve and read plan-scoped slot
    V->>Q: GET models with scoped key when probing
    alt Catalog available
        Q-->>V: Model IDs
    else Catalog unavailable
        Q-->>V: Use explicitly saved model
    end
    V->>Q: POST Chat Completions
    Q-->>V: SSE reasoning and tool call
    V->>Q: POST assistant call and tool result
    Q-->>V: SSE final response
```

## State

Not drawn: the task uses the existing gateway lifecycle and discovery statuses.

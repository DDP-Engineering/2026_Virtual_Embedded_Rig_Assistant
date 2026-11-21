# TASK-f9b010e7 diagrams

Illustrates the task’s Design.

## Structure

Added: OpenCode catalog cache and parser. Changed: registry and preset catalog loader, gateway. Reused: ProviderSettings and ProviderGateway.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    settings["ProviderSettings"] --> registry["curatedProviderPresets"]:::changed
    desktop["ProviderGateway"] --> catalog["discoverPresetModels"]:::changed
    desktop --> gateway["createPiAiGateway"]:::changed
    gateway --> registry
    gateway ==> cache["OpenCodeCatalogCache"]:::added
    cache ==> catalog
    catalog ==> parser["parseOpenCodeCatalog"]:::added
```

## Sequence

```mermaid
sequenceDiagram
    participant V as VERA
    participant G as createPiAiGateway
    participant O as Bound OpenCode plan
    V->>G: Prepare selected model
    G->>O: GET plan inference catalog
    O-->>G: Eligible model profiles
    V->>G: Stream prompt
    G->>O: POST with scoped key and session header
    O-->>G: Stream tool call
    G-->>V: Tool call with ID
    V->>G: Stream continuation with result
    G->>O: POST on same plan and session
    O-->>G: Stream reply
```

## State

Not drawn: existing cancellation and connection states are reused.

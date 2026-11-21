# TASK-db834e2a diagrams

## Structure

Changed nodes are the curated registry, ProviderGateway and its catalog cache. The curated adapter module is new.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    settings["ProviderSettings"] --> registry["curatedProviderPresets"]:::changed
    gateway["ProviderGateway"]:::changed --> registry
    gateway --> cache["PresetCatalogCache"]:::changed
    gateway ==> adapters["curated-adapters.ts"]:::added
    adapters ==> pi["pi-ai"]
```

## Sequence

```mermaid
sequenceDiagram
    participant UI as Providers
    participant Main as ProviderGateway
    participant Pi as pi-ai
    participant API as Registered service
    UI->>Main: Select saved connection and model
    Main->>Pi: Stream with the scoped key
    Pi->>Main: Dispatch exact registered POST
    Main->>API: Send request with redirects disabled
    API-->>Main: Stream reasoning and tool call
    Main-->>UI: Return tool call
    UI->>Main: Continue with the tool result
    Main->>API: Send reasoning and matching result
    API-->>Main: Stream final text
```

## State

Not drawn: this feature uses the existing provider operation lifecycle.

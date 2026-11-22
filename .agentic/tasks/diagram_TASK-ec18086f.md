# TASK-ec18086f diagrams

Illustrates `## Design` in `TASK-ec18086f.md`. The Design text is authoritative.

Node classes from the Design: added = providers.models.enable, ProviderCard, ProviderDialog; changed = shared provider
schemas, ProviderSettings, Providers page, useModelCatalog, browser mock; unchanged = providers.models, editors, composer.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    page["Providers page (header Save/Cancel)"]:::changed --> card["ProviderCard (model ticks)"]:::added
    page --> dialog["ProviderDialog (dropdown + editors)"]:::added
    card -->|catalog| models["providers.models"]
    page -->|Save ticks| enable["providers.models.enable"]:::added
    enable --> settings["ProviderSettings"]:::changed
    dialog -->|providers.save| settings
    settings --> schema["shared provider schemas (enabledModels)"]:::changed
    composer["composer picker"] --> catalog["useModelCatalog (filter)"]:::changed
    catalog --> models
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant P as Providers page
    participant M as main ProviderSettings
    participant C as composer picker
    U->>P: tick models on cards
    U->>P: header Save
    P->>M: providers.models.enable(changes)
    M-->>P: saved, providers.list refreshed
    C->>M: providers.list + providers.models
    C-->>U: only ticked models (plus current)
```

## State

Not drawn: ticks are a page draft over saved lists; no new lifecycle.

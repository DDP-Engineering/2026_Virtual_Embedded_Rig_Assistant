# TASK-a8070c73 diagrams

Illustrates `## Design` in `TASK-a8070c73.md`. The Design text is authoritative.

## Structure

Changed: both provider editors, ProviderSettings, provider schemas, parseChatGptCatalog and createPiAiGateway.
Added: ProviderImageSwitch. Reused: the OpenAI model list and SettingsService.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    custom["CustomEditor"]:::changed ==> checkbox["ProviderImageSwitch"]:::added
    lmstudio["LmStudioEditor"]:::changed ==> checkbox
    custom --> main["ProviderSettings"]:::changed
    lmstudio --> main
    main --> schemas["Provider schemas and capabilities"]:::changed
    main --> settings["SettingsService"]
    settings --> gateway["createPiAiGateway"]:::changed
    chatGPT["parseChatGptCatalog"]:::changed --> gateway
    openAI["Pinned OpenAI model list"] --> gateway
    gateway --> schemas
```

## Sequence

```mermaid
sequenceDiagram
    participant E as Provider editor
    participant P as ProviderSettings
    participant S as SettingsService
    E->>P: providers.save with imageModels
    P->>S: Update validated provider settings
    S-->>P: Save complete
    P-->>E: Saved
    E->>P: providers.list on reopening
    P->>S: Read saved providers
    S-->>P: Saved provider settings
    P-->>E: Provider metadata with imageModels
```

## State

Not drawn: the checkbox is part of the existing provider draft and save flow.

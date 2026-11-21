# TASK-49fbfd2e diagrams

Illustrates the task journal's Design.

## Structure

Added: shared registry and curated catalog. Changed: Settings UI, ProviderSettings, gateway and model pickers. Reused: CredentialFile and pi-ai.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#86b8a7
    classDef changed fill:#faeeda,stroke:#caa866
    classDef removed stroke-dasharray:4 3
    UI["Settings provider editor"]:::changed ==> Registry["Shared preset registry"]:::added
    UI --> Settings["ProviderSettings"]:::changed
    Settings ==> Registry
    Settings --> Store["CredentialFile"]
    Pickers["Model pickers"]:::changed --> Gateway["createPiAiGateway"]:::changed
    Gateway ==> Catalog["Curated discovery"]:::added
    Gateway ==> Registry
    Gateway --> Pi["pi-ai"]
```

## Sequence

```mermaid
sequenceDiagram
    participant U as Settings editor
    participant M as Desktop main
    participant C as CredentialFile
    participant P as Bound service
    U->>M: Discover for preset and binding
    M->>C: Read matching saved slot when requested
    M->>P: GET registered catalog URL
    P-->>M: Catalog response
    M-->>U: Discovered, manual or failed
    U->>M: Save selected model
    U->>M: Test saved connection
    M->>C: Read only the saved connection slot
    M->>P: Stream using the registered inference route
    M-->>U: Typed test outcomes
```

## State

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Discovering
    Discovering --> Discovered
    Discovering --> Manual
    Discovering --> Failed
    Discovered --> Draft
    Manual --> Draft
    Failed --> Draft
    Draft --> Saved
    Saved --> [*]
```

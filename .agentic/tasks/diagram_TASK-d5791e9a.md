# TASK-d5791e9a diagrams

Illustrates journal Design; the journal is authoritative.
Map: Plugins and CatalogSection changed; library model/controls added; API/QueryClient reused unchanged.

## Structure
```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 P["Plugins"]:::changed ==> M["plugin-library.ts"]:::added
 P ==> C["PluginLibraryControls"]:::added
 P ==> S["CatalogSettings / CatalogItem"]:::changed
 P --> A["typed API"]
 P --> Q["QueryClient"]
```

## Sequence
```mermaid
sequenceDiagram
 participant U as Engineer
 participant P as Plugins
 participant A as typed API
 participant Q as QueryClient
 U->>P: Check all dependencies
 loop issue-free installed packages
 P->>A: plugins.check
 A-->>P: statuses or failure
 P->>Q: successful observations
 end
 P-->>U: count and per-package failures
```

## State
```mermaid
stateDiagram-v2
 [*] --> Available
 Available --> Installed: selected tab
 Installed --> Available: selected tab
 Available --> Review: explicit Install or Update
 Installed --> Review: explicit import or scoped review
 Review --> Available: catalog completed or cancelled
 Review --> Installed: manual import completed
```

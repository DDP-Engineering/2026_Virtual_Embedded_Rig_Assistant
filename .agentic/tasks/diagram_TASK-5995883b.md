# TASK-5995883b diagrams
Illustrates Design in TASK-5995883b.md. The Design text is authoritative.

## Structure
Node map: shared discovery schema and catalog source builder changed; client, CLI, bundle preparation reused unchanged.
```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 metadata["catalog.yaml metadata"]:::changed ==> schema["catalogMaintainersSchema"]:::changed
 schema ==> build["buildCatalogRelease"]:::changed
 build --> index["index.json format1"]
 index --> client["PluginCatalog.view"]
 build --> cli["vera catalog build"]
 cli --> bundle["prepareBundledPlugins"]
```
## Sequence
```mermaid
sequenceDiagram
 participant M as maintainer
 participant B as catalog builder
 participant C as catalog client
 M->>B: source plus discovery metadata
 B->>B: validate fields and references
 B-->>C: deterministic index.json plus unchanged zips
 C-->>M: same metadata and installed state
```
## State
Not drawn: no lifecycle or state transition is changed.

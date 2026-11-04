# TASK-a1c75648 diagrams

Illustrates Design in TASK-a1c75648.md. Node map: registry/catalog/citations changed; loader/decoder/contracts added; PathGuard reused unchanged.

## Structure

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  registry["ToolRegistry"]:::changed ==> loader["loadDefinition"]:::added
  loader ==> guard["PathGuard"]
  loader ==> contracts["decodeRegisterDefinitionSchema"]:::added
  registry ==> decoder["decodeRegister"]:::added
  decoder ==> citations["validateCitations"]:::changed
  catalog["builtinToolNames / WorkbenchTools"]:::changed ==> registry
```

## Sequence

```mermaid
sequenceDiagram
  participant R as ToolRegistry
  participant L as loadDefinition
  participant P as PathGuard
  participant D as decodeRegister
  R->>L: definitionPath / expectedSha256
  L->>P: resolve before and after bounded read
  P-->>L: canonical identity
  L-->>R: validated definition and exact source
  R->>D: register / value / device
  D-->>R: complete exact result
```

## State

Not drawn: this capability adds no lifecycle or persisted state.

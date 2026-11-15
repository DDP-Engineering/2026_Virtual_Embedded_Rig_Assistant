# TASK-15cb5dad diagrams

Illustrates `## Design` in `TASK-15cb5dad.md`. The Design text is authoritative.

Node classes: added = shared industrial-catalog.ts, core catalog.ts, catalog-tool.ts, plugin industrial-catalog,
catalog files; changed = units.ts (scales, known properties), tools.ts (gate list), registry.ts; unchanged =
SessionService filter, model.ts, PathGuard.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    plugin["plugin industrial-catalog<br/>(ecosystem electrical, skill)"]:::added --> gate["electricalToolNames<br/>(tools.ts)"]:::changed
    gate --> service["SessionService tool filter"]
    registry["ToolRegistry"]:::changed --> tool["industrial_catalog<br/>(catalog-tool.ts)"]:::added
    service --> tool
    tool --> guard["PathGuard"]
    guard --> files[("electrical-automation-catalogs/&lt;id&gt;.json")]:::added
    tool --> engine["checkCatalog / findItems /<br/>selectItems / coordinationFor<br/>(catalog.ts)"]:::added
    engine --> schema["industrialCatalogSchema<br/>(shared)"]:::added
    engine --> units["unitProblem / toBaseUnit<br/>(units.ts)"]:::changed
    engine --> model["jsonPath / problemsText<br/>(model.ts)"]
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent
    participant Tool as industrial_catalog
    participant FS as catalog file (PathGuard)
    participant Engine as catalog.ts
    Agent->>Tool: {view: select, catalog, requirements}
    Tool->>FS: lstat + read <id>.json (<= 4 MiB, ordinary file)
    FS-->>Tool: bytes (sha256)
    Tool->>Engine: parseCatalog(bytes, id)
    Engine-->>Tool: catalog or "Invalid industrial catalog:" problems
    Tool->>Engine: selectItems(catalog, stamp, request)
    Engine-->>Tool: items eligible / unknown / eliminated with cited evidence
    Tool-->>Agent: selection {catalog {id, version, sha256, path}, counts, items}
```

## State

```mermaid
stateDiagram-v2
    [*] --> evaluated: requirement on item
    evaluated --> unknown_absent: no value of that name
    evaluated --> unknown_conditions: no value covers the conditions
    evaluated --> unknown_unconfirmed: only extracted values
    evaluated --> pass: conservative confirmed value meets limit
    evaluated --> fail: conservative confirmed value misses limit
    note right of fail: any fail -> item eliminated; else any unknown -> unknown; else eligible
```

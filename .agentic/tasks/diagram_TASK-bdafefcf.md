# TASK-bdafefcf diagrams

Illustrates `## Design` in `TASK-bdafefcf.md`. The Design text is authoritative.

Node map: added - shared electrical-model schemas, core units/model/edit/results/tools, fixture;
changed - ToolRegistry (two tools), SessionService (electricalModel gate), desktop sessions (flag),
FileChangeRequest tool union, workbench tools editor; unchanged - commitChange, WriteQueue, PathGuard,
approval gate, plugin helpers.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    agent["agent"] --> registry["ToolRegistry"]:::changed
    service["SessionService gate"]:::changed --> registry
    desktop["desktop sessions flag"]:::changed --> service
    registry --> read["electrical_model"]:::added
    registry --> change["electrical_model_change"]:::added
    read --> port["tools.ts access port"]:::added
    change --> port
    change --> edit["edit.ts operations + import"]:::added
    edit --> model["model.ts validate / serialize / hash"]:::added
    port --> model
    port --> results["results.ts freshness"]:::added
    model --> units["units.ts table"]:::added
    model --> schema["shared electrical-model.ts"]:::added
    results --> schema
    change --> commit["commitChange + WriteQueue"]
    commit --> file[("electrical-automation-model.json")]
    port --> file
    port --> runs[("electrical-automation-results/*/result.json")]
    helper["plugin helpers (later)"] -.-> runs
    helper -.-> file
```

## Sequence

```mermaid
sequenceDiagram
    participant A as Agent
    participant S as SessionService
    participant C as electrical_model_change
    participant Q as commitChange / WriteQueue
    participant F as model file
    A->>S: electrical_model_change(operations)
    S->>C: prepare
    C->>F: read bytes, before SHA-256
    C->>C: apply operations, validate, serialize, diff
    C-->>S: PreparedChange (path, hashes, diff)
    S->>A: approval (ask) or mode decision
    S->>Q: apply
    Q->>F: recheck before hash, temp write, rename
    Q-->>A: {path, sha256, bytes, ids}
```

## State

```mermaid
stateDiagram-v2
    [*] --> invalid: result fails schema
    [*] --> current: every input snapshot hash matches
    [*] --> stale: an input changed or was removed
    current --> stale: model entity changes
    stale --> current: entity restored to the snapshot
```

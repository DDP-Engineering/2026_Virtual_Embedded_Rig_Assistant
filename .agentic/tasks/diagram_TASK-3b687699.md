# TASK-3b687699 diagrams

Illustrates `## Design` in `TASK-3b687699.md`. The Design text is authoritative.

Node classes: added = registry/resolver, AdvancedField, Settings Advanced, Workbench Advanced, Session Advanced dialog, session.advanced.set, CLI --advanced; changed = settings.json schema, workbench.yaml schema, session.updated/reducer, SessionService, desktop main sessions host, CLI run.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    registry["shared advanced-settings (registry, patch schemas, resolver)"]:::added
    settings["settings.json advanced + showAdvanced"]:::changed
    workbench["workbench.yaml advanced"]:::changed
    events["session.updated advanced / reducer"]:::changed
    service["SessionService (setAdvanced, resolve cap)"]:::changed
    main["desktop main sessions host"]:::changed
    cli["CLI --advanced"]:::added
    ui["Settings / Edit workbench / Session Advanced (AdvancedField)"]:::added
    ipc["session.advanced.set IPC"]:::added
    registry --> settings
    registry --> workbench
    registry --> events
    registry --> service
    registry --> ui
    registry --> cli
    ui --> ipc --> service
    ui --> settings
    ui --> workbench
    main --> service
    cli --> service
    service --> events
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant R as Renderer (Session Advanced)
    participant M as Desktop main
    participant S as SessionService
    participant DB as events table
    U->>R: set Tool calls per turn = 300
    R->>M: session.advanced.set {key, value}
    M->>S: setAdvanced(id, key, 300)
    S->>S: validate against registry (10-500)
    S->>DB: record session.updated {advanced}
    U->>R: send message
    R->>M: session.send
    M->>S: startTurn
    S->>S: resolve session > workbench > app > 50
    S->>S: runtime maxToolCallsPerTurn = 300
```

## State

```mermaid
stateDiagram-v2
    [*] --> Hidden
    Hidden --> Shown: Show advanced settings on
    Shown --> Hidden: switch off (stored values keep applying)
    state Shown {
        [*] --> Inherited
        Inherited --> Set: user enters a valid value
        Set --> Inherited: Reset
        Set --> Set: new valid value
    }
```

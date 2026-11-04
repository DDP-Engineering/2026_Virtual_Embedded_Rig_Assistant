# TASK-389f3ff4 diagrams

Illustrates Design in TASK-389f3ff4.md. The Design text is authoritative.

## Structure

Node map: package and skill added; catalog changed; store, provisioner, runner, gate reused unchanged.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    catalog["Official catalog and Security group"]:::changed --> package["esp32-efuse package"]:::added
    package --> skill["esp32-efuse-review"]:::added
    package --> store["PluginStore"] --> provisioner["Provisioner"]
    store --> gate["ApprovalGate"] --> runner["ProgramRunner"]
```

## Sequence

```mermaid
sequenceDiagram
    participant Engineer
    participant Agent
    participant Gate as ApprovalGate
    participant Runner as ProgramRunner
    participant CLI as espefuse virtual
    Engineer->>Agent: Explicit single burn request
    Agent->>Gate: summary (device-read)
    Gate->>Runner: Approved read
    Runner->>CLI: --chip esp32 --virt summary
    CLI-->>Agent: Current state
    Agent->>Agent: Explain burn and write session artifact plan
    Agent->>Gate: burn-efuse (irreversible)
    Gate->>Engineer: Ask/auto-edit: type burn-efuse
    Engineer->>Gate: burn-efuse
    Gate->>Runner: Single-use grant (Bypass: mode grant)
    Runner->>CLI: --virt --do-not-confirm burn-efuse
    CLI-->>Agent: Exit code and observed virtual state
```

## State

Not drawn: no lifecycle or transition changes; existing approval and runner state machines are reused.

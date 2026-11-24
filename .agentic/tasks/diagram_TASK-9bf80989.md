# TASK-9bf80989 diagrams

Illustrates the Design in `TASK-9bf80989.md`.

## Structure

Changed: pluginManifestSchema, classifyCommand, prepareProgramRequest, timeoutCap, power-profile main.
Unchanged: programPolicy.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    manifest["pluginManifestSchema"]:::changed ==> classify["classifyCommand"]:::changed
    request["prepareProgramRequest"]:::changed --> classify
    timeout["timeoutCap"]:::changed --> classify
    request --> policy["programPolicy"]
    policy --> helper["power-profile main"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant Request as prepareProgramRequest
    participant Rules as classifyCommand
    participant Policy as programPolicy
    participant Helper as power-profile main
    Request->>Rules: Rules, exact argv and selected declaration
    Rules-->>Request: Safe risk for opted-in help
    Request->>Policy: Safe risk, current mode and plugin tier
    opt Policy permits execution
        Policy->>Helper: capture --help
        Helper-->>Policy: Usage and exit 0
    end
```

## State

Not drawn because approval and trial state transitions stay as defined by existing policy.

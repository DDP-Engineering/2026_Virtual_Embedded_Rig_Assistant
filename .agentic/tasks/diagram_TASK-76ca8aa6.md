# TASK-76ca8aa6 diagrams

Illustrates `## Design` in `TASK-76ca8aa6.md`. The Design text is authoritative.

Node classes: added = session.compact IPC, SessionService.compactNow, CompactionSettings; changed = advanced registry, ContextCompactor, ReferenceRuntime.compact, SessionService turn setup, pi-ai gateway, AdvancedField, SessionAdvancedDialog, CLI run.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    registry["advanced registry (int + switch)"]:::changed --> resolve["resolveAdvanced"]
    service["SessionService turn setup"]:::changed --> resolve
    service --> settings["CompactionSettings"]:::added
    settings --> compactor["ContextCompactor"]:::changed
    runtime["ReferenceRuntime.compact(force)"]:::changed --> compactor
    compactnow["SessionService.compactNow"]:::added --> runtime
    ipc["session.compact IPC"]:::added --> compactnow
    dialog["SessionAdvancedDialog (Compact now)"]:::changed --> ipc
    field["AdvancedField (switch select)"]:::changed --> registry
    gateway["pi-ai gateway headerWaitMs()"]:::changed --> resolve
    cli["CLI run (--advanced booleans)"]:::changed --> registry
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant D as Session dialog
    participant M as Desktop main
    participant S as SessionService
    participant R as ReferenceRuntime
    participant C as ContextCompactor
    participant G as Gateway
    U->>D: Compact now
    D->>M: session.compact {sessionId}
    M->>S: compactNow(id)
    S->>S: refuse BUSY / DENIED
    S->>C: settings = compactionSettings(id)
    S->>R: start(prompt, model, policy, compactor)
    S->>R: compact(transcript, force)
    R->>C: prepare(force)
    C->>G: summary request
    G-->>C: summary JSON
    C-->>R: view completed
    R-->>S: context.compacted, usage.updated
    S-->>M: {status}
    M-->>D: status shown
```

## State

```mermaid
stateDiagram-v2
    [*] --> Below
    Below --> Above: context > trigger
    Above --> Summarizing: automatic on
    Above --> Uncompacted: automatic off
    Below --> Summarizing: Compact now (force)
    Summarizing --> Below: summary adopted
    Summarizing --> Above: failed or unavailable
    Uncompacted --> ContextLimit: request does not fit
    Uncompacted --> Summarizing: automatic on again
```

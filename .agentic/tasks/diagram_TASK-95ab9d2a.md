# TASK-95ab9d2a diagrams

Illustrates `## Design` in `TASK-95ab9d2a.md`. The Design text is authoritative.

Node classes: added = calibration usage field, context.compacted event, compact(), validCuts, background(); changed = ContextCompactor, ContextPolicy, ReferenceRuntime, SessionService, session-state reducer, Markdown export; unchanged = events table, gateway.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    service["SessionService"]:::changed --> compactor["ContextCompactor (summary, calibration, background)"]:::changed
    service --> runtime["ReferenceRuntime"]:::changed
    runtime --> compactor
    runtime --> policy["ContextPolicy (scale, rawTokens)"]:::changed
    compactor --> policy
    compactor --> cuts["validCuts + 20k tail"]:::added
    runtime --> compact["compact() after turn"]:::added
    runtime --> gateway["LLM gateway"]
    runtime -- "context.compacted" --> service
    runtime -- "usage.updated + calibration" --> service
    service --> events[("events table")]
    events -- "latest record + ratio at first turn" --> service
    events --> reducer["session-state reducer (skips record)"]:::changed
    events --> md["Markdown export (skips record)"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant S as SessionService
    participant R1 as Runtime (turn N)
    participant C as ContextCompactor
    participant G as Gateway
    R1->>S: turn.done (end, view above trigger)
    S->>R1: compact()
    R1->>C: prepare(all history), background task
    C->>G: summary request (tool results cut to 2,000 chars)
    U->>S: send message
    S->>S: record message.user at once
    S->>C: restore? (only first turn after open)
    Note over S,C: Runtime N+1 prepare awaits C.settled()
    G-->>C: summary JSON
    C-->>R1: adopted view
    R1->>S: context.compacted (one write)
    C-->>S: background tasktled
    S->>G: normal request N+1 (no second summary)
```

## State

```mermaid
stateDiagram-v2
    [*] --> Empty
    Empty --> Restored: first turn after open, record found
    Empty --> Summarized: pass adopted
    Restored --> Summarized: fingerprint matches, later pass
    Restored --> Empty: fingerprint mismatch
    Summarized --> Compacting: turn ends above trigger
    Compacting --> Summarized: pass adopted, record written
    Compacting --> Summarized: failed or aborted (keeps prior summary)
    Summarized --> [*]: session deleted or workbench closed
```

# TASK-3416fe29 diagrams

Illustrates the task journal's design.

## Structure

Added: Wireshark cases, fixture preparation, scorer. Changed: shared agent runner and model proxy. Reused: VERA CLI, native utilities, run report.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    cases["cases/wireshark.yaml"]:::added ==> fixtures["fixtures.mjs"]:::added
    fixtures ==> runner["agent-runner.mjs"]:::changed
    runner --> cli["VERA CLI"]
    cli --> utilities["Native Wireshark utilities"]
    runner --> proxy["model-proxy.mjs"]:::changed
    runner ==> score["score.mjs"]:::added
    score ==> report["Run report"]
```

## Sequence

```mermaid
sequenceDiagram
    participant F as fixtures.mjs
    participant R as agent-runner.mjs
    participant C as VERA CLI
    participant P as model-proxy.mjs
    participant S as score.mjs
    R->>F: Prepare and verify declared fixture bytes
    R->>C: Run selected case with approvals denied
    opt Custom model
        C->>P: Send model request
        P-->>R: Expose observed request in memory
    end
    C-->>R: Return native tool and answer events
    R->>S: Score and retain measurements
```

## State

No new lifecycle or status states are introduced.

# TASK-9a4d3e8a diagrams

Design in TASK-9a4d3e8a.md is authoritative.
Node map: runner/report/probes added; build config and API/main composition changed; loader/IPC/UI reused unchanged.

## Structure
```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 runner["scripts/eval-performance-harness/runner.mjs"]:::added ==> main["session-performance.ts"]:::added
 runner ==> report["performance/report.mjs"]:::added
 main ==> hub["SessionHub.get"]
 runner ==> ui["Sidebar session selection"]
 api["api/index.ts"]:::changed ==> probe["api/session-performance.ts"]:::added
```

## Sequence
```mermaid
sequenceDiagram
 participant R as Runner
 participant U as Sidebar
 participant M as Main IPC
 participant H as SessionHub
 R->>R: Start external watchdog and timing
 R->>U: Click persisted session
 U->>M: session.get
 M->>H: Reconstruct stored snapshot
 H-->>M: Snapshot and measured phases
 M-->>U: Validated response
 R->>U: Verify conversation, type draft, scroll
 R->>R: Save samples and compare explicit reference
```

## State
```mermaid
stateDiagram-v2
 [*] --> Measuring
 Measuring --> Complete: all expected samples valid
 Measuring --> Failed: deadline/crash/correctness failure
 Complete --> Compared: compatible explicit reference
 Complete --> Invalid: incompatible reference
 Compared --> Passed: budgets and tolerances hold
 Compared --> Failed: regression or budget violation
```

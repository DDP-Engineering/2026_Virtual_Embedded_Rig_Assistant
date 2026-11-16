# TASK-6170ebf2 diagrams

Illustrates Design in TASK-6170ebf2.md. Design is authoritative.

## Structure

Node map: privacy.ts and masking.ts added; settings.ts and workbench.ts changed; host getter reused unchanged.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    privacy["shared/privacy.ts"]:::added ==> settings["shared/settings.ts"]:::changed
    privacy ==> workbench["shared/workbench.ts"]:::changed
    privacy ==> resolver["core/settings/masking.ts"]:::added
    getter["host settings getter"] ==> resolver
    workbench ==> resolver
```

## Sequence

Not drawn: resolver is synchronous in one process; existing persistence flow is unchanged.

## State

Not drawn: no lifecycle or state transitions are added.

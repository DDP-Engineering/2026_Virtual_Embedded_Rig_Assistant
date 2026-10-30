# TASK-8befc086 diagrams

Illustrates Design in TASK-8befc086.md. Design text is authoritative.

## Structure

Node map: builtinToolNames added; ToolRegistry changed; WorkbenchTools added; WorkbenchEditor changed; configuration API reused unchanged.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  names["builtinToolNames"]:::added ==> registry["ToolRegistry"]:::changed
  names ==> list["WorkbenchTools"]:::added
  list ==> editor["WorkbenchEditor draft"]:::changed
  editor --> api["workbench.config.update"]
```

## Sequence

Not drawn: the save IPC flow is unchanged.

## State

Not drawn: existing editor draft/save lifecycle is unchanged.

# TASK-7b920e3b diagrams

Illustrates Design in TASK-7b920e3b.md. Design is authoritative.

## Structure

Map: context, input helpers and HIL executor changed; PathGuard reused unchanged.

```mermaid
flowchart LR
    classDef changed fill:#faeeda,stroke:#854f0b
    context["toolPathGuard"]:::changed --> guard["PathGuard"]
    context --> inputs["analysis/plugin/electrical inputs"]:::changed
    context --> hil["HIL compile and executor"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant Host
    participant Tool
    participant Worker
    Host->>Tool: captured epoch and exclusions
    Tool->>Worker: host scope and input
    Host->>Worker: terminate on epoch abort
    Worker-->>Tool: bounded result
```

## State

Not drawn: permission states and transitions are unchanged.

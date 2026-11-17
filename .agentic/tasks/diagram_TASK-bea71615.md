# TASK-bea71615 diagrams

Illustrates Design in TASK-bea71615.md. The Design text is authoritative.

## Structure

Map: RunPresentation and refresh hook added; main composition, terminal projection, Runs dialog, plugin status publication and viewer refresh changed; resolver, credential store and runner reused unchanged.

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 runner[ProgramRunner] --> presentation[RunPresentation]:::added
 resolver[Live resolver] --> presentation
 credentials[Credential store] --> presentation
 presentation --> main[Main IPC]:::changed
 main --> runs[Runs dialog]:::changed
 main --> viewer[Full log viewer]:::changed
 main --> plugins[Plugin status cards]:::changed
 events[Settings and config events] --> refresh[Query refresh hook]:::added
 refresh --> runs
 refresh --> plugins
 events --> viewer
 credentials --> terminals[Terminal projection]:::changed
 resolver --> terminals
```

## Sequence

```mermaid
sequenceDiagram
 participant UI
 participant Host as RunPresentation
 participant Runner
 participant Policy as Live resolver
 UI->>Host: list or log(owner)
 Host->>Host: capture current owner
 Host->>Runner: read raw local record
 Runner-->>Host: raw value
 Host->>Host: recheck current owner
 Host->>Policy: resolve runs
 Policy-->>Host: on or off
 Host-->>UI: projected value
```

## State

Not drawn: no lifecycle, status field or state transition changes.

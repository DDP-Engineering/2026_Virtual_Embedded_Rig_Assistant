# TASK-a79bc68f diagrams

Illustrates Design in TASK-a79bc68f.md; Design is authoritative.

## Structure

Map: Ingester changed; config, Chokidar and document repository reused unchanged.

```mermaid
flowchart LR
  C[Workbench selection] --> I[Ingester scoped roots]
  I --> W[Chokidar]
  W --> I
  I --> D[Document repository]
  classDef changed fill:#fff3cd,stroke:#856404
  class I changed
```

## Sequence

```mermaid
sequenceDiagram
  participant S as Workbench service
  participant I as Ingester
  participant W as Chokidar
  S->>I: Selection changes / request
  I->>I: Derive source and policy targets
  I->>W: Close previous watcher
  W-->>I: Closed
  I->>W: Watch new targets
  W-->>I: Ready
  I->>I: Request reconciliation
```

## State

```mermaid
stateDiagram-v2
  [*] --> Watching
  Watching --> Rebinding: Targets changed
  Rebinding --> Watching: Prior closed / new watcher ready
  Watching --> Closed: close
  Rebinding --> Closed: close cancels replacement
  Closed --> [*]
```

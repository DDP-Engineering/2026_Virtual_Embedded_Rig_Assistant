# TASK-34a0efbd diagrams

Illustrates Design in TASK-34a0efbd.md. Design is authoritative.

## Structure
Map: Workspace, Composer, Sidebar, SessionService changed; Inspector added; shared IPC changed; DB reused.
```mermaid
flowchart LR
  W[Workspace] --> C[Composer]
  C --> I[Inspector]
  W --> I
  S[Sidebar] --> P[IPC]
  P --> E[SessionService]
  E --> D[Existing session metadata]
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#fff3cd,stroke:#856404
  class I added
  class W,C,S,P,E changed
```

## Sequence
```mermaid
sequenceDiagram
  participant U as User
  participant S as Sidebar
  participant M as Main IPC
  participant C as SessionService
  participant D as SQLite
  U->>S: Archive row
  S->>M: session.archive.set
  M->>C: setArchived
  C->>C: Ownership / idle guard
  C->>D: Atomic flag and update event
  D-->>C: Committed
  C-->>M: Summary and notification
  M-->>S: Refreshed list
```

## State
```mermaid
stateDiagram-v2
  [*] --> Conversation
  Conversation --> Context: Indicator
  Conversation --> Activity: Activity button
  Context --> Conversation: Close / Escape
  Activity --> Conversation: Close / Escape
  Conversation --> Archived: Archive when idle
  Archived --> Conversation: Restore
```

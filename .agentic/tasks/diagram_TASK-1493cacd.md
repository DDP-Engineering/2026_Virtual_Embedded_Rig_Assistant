# TASK-1493cacd diagrams
Design in TASK-1493cacd.md is authoritative.

## Structure
Map: Picker added; IPC, SessionService, Gateway changed; event store reused.
```mermaid
flowchart LR
  P[Reasoning picker] --> I[Strict IPC]
  I --> S[SessionService]
  S --> E[Existing events]
  S --> R[Runtime metadata preparation]
  R --> G[Gateway native payload]
  G --> C[Account model catalog]
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#fff3cd,stroke:#856404
  class P,C added
  class I,S,G,R changed
```

## Sequence
```mermaid
sequenceDiagram
  participant U as User
  participant S as Session service
  participant E as Event store
  participant G as Gateway
  U->>S: Choose supported level / expected model
  S->>S: Ownership and model validation
  S->>E: Commit session.updated
  E-->>S: Durable preference
  S-->>U: Updated metadata/event
  S->>G: Prepare live model before budgeting
  G-->>S: Current supported capabilities
  S->>G: Next request + snapshot of current choice
  G->>G: Validate native model effort
```

## State
```mermaid
stateDiagram-v2
  [*] --> Default
  Default --> Override: Choose supported level
  Override --> Default: Choose Default / incompatible model
  Override --> Override: Change level / compatible model
  Default --> Default: Unsupported model
```

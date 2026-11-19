# TASK-61f10b95 diagrams

Illustrates the Design in TASK-61f10b95.md.

## Structure

Added: image draft state and image store. Changed: composer, Files, session IPC. Reused: primary-workbench path guard and existing send contract.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  Files:::changed --> Composer:::changed
  Files --> Draft[Image draft state]:::added
  Composer --> Draft
  Draft --> IPC[Session IPC]:::changed
  IPC --> Store[Image store]:::added
  Store --> Guard[Path guard]
  Composer --> Send[Session send contract]
```

## Sequence

```mermaid
sequenceDiagram
  participant User
  participant Composer
  participant Main
  participant Workbench
  User->>Composer: Paste screenshot or drop Files row
  Composer->>Main: Add image to session draft
  Main->>Workbench: Validate reference or save original bytes
  Main-->>Composer: Workbench path and thumbnail
  User->>Composer: Send
  Composer->>Main: Submit draft image paths
  Main-->>Composer: Accepted message
```

## State

```mermaid
stateDiagram-v2
  [*] --> Pending
  Pending --> Draft: Validates
  Pending --> [*]: Refused
  Draft --> [*]: Removed
  Draft --> [*]: Send accepted
  Draft --> Draft: Send rejected
```

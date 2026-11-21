# TASK-00ed678f diagrams

Illustrates the task's Design section.

## Structure

Changed: delegatedSessionTools, SessionService, DelegationsRepository, ToolRegistry, session IPC, Desktop delegation controls. Added: receipts and launch authorization storage.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  tools["delegatedSessionTools"]:::changed --> service["SessionService"]:::changed
  service --> registry["ToolRegistry"]:::changed
  service --> repo["DelegationsRepository"]:::changed
  repo ==> sqlite[("Request receipts and launch authorization")]:::added
  vue["Desktop delegation controls"]:::changed --> ipc["Session IPC"]:::changed
  ipc --> service
```

## Sequence

```mermaid
sequenceDiagram
  participant Parent as delegatedSessionTools
  participant Core as SessionService
  participant Store as DelegationsRepository
  participant Agent as ReferenceRuntime
  Parent->>Core: session_configure
  Core->>Store: Commit settings and receipt
  Core-->>Parent: Configuration revision
  Parent->>Core: session_send with revision
  Core->>Agent: Start or queue ordinary chat input
  Core->>Store: Commit events and acknowledgement
  Core-->>Parent: Exact turn and message IDs
  Parent->>Core: session_wait with exact turn ID
  Agent-->>Core: Sequenced completion event
  Core-->>Parent: Masked bounded outcome
```

## State

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Running: Admit follow-up
  Running --> Running: Queue eligible follow-up
  Running --> AwaitingApproval: Mandatory user decision
  AwaitingApproval --> Running: Approval settles
  Running --> Idle: Complete or stop
  AwaitingApproval --> Idle: Stop
```

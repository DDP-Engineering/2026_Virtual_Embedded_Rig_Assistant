# TASK-4fbe3463 diagrams

Design is authoritative. Map: command-prefix added; ApprovalGate, SessionService, WorkbenchService, ApprovalCard and Agent editor changed; runner reused unchanged.

## Structure

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 card["ApprovalCard"]:::changed ==> session["SessionService"]:::changed
 session ==> gate["ApprovalGate"]:::changed
 session ==> workbench["WorkbenchService"]:::changed
 editor["Agent editor"]:::changed ==> workbench
 gate ==> policy["command-prefix"]:::added
 gate --> runner["ProgramRunner"]
```

## Sequence

```mermaid
sequenceDiagram
 participant User
 participant ApprovalCard
 participant SessionService
 participant WorkbenchService
 participant ApprovalGate
 User->>ApprovalCard: Always allow chosen prefix
 ApprovalCard->>SessionService: exact approval IPC + prefix
 SessionService->>ApprovalGate: validate pending request
 SessionService->>WorkbenchService: persist eligible prefix
 WorkbenchService-->>SessionService: current format1 configuration
 SessionService->>ApprovalGate: revalidate and approve
 ApprovalGate->>ApprovalGate: consume exact grant under live policy
```

## State

Not drawn: existing approval lifecycle remains unchanged.

# TASK-4a82060d diagrams

Illustrates `## Design` in `TASK-4a82060d.md`. The Design text is authoritative.

Node classes: SessionRouter = added; index.ts handlers, SessionsHost, WorkbenchRuntimes, SessionHub,
SessionService, DisplayDocuments, shared IPC/events = changed; WorkbenchService, renderer session view =
unchanged.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    renderer["renderer session view"] ==> ipc["main/index.ts session handlers"]:::changed
    ipc ==> router["SessionRouter"]:::added
    router == "runtimes.all()" ==> registry["WorkbenchRuntimes"]:::changed
    router == "owner + guard" ==> hostA["SessionsHost A (background)"]:::changed
    router == "owner + guard" ==> hostB["SessionsHost B (foreground)"]:::changed
    hostA --> svcA["SessionService A"]:::changed
    hostB --> svcB["SessionService B"]:::changed
    svcA --> hubA["SessionHub A (rows + live text)"]:::changed
    svcB --> hubB["SessionHub B"]:::changed
    hostA -- "emit, masked per A" --> renderer
    svcA -. "onActivity" .-> ipc
    registry -. "changed" .-> ipc
    ipc -- "session.activity" --> renderer
    ipc --> display["DisplayDocuments (encode per owner, resolve foreground)"]:::changed
    ipc --> shared["shared ipc/events schemas"]:::changed
    hostA --> wbA["WorkbenchService A"]
```

## Sequence

```mermaid
sequenceDiagram
    participant R as Renderer
    participant M as Main handler
    participant S as SessionRouter
    participant H as SessionsHost (owner)
    participant C as SessionService / Hub
    R->>M: session.approval.decide {sessionId}
    M->>S: session(sessionId)
    S->>S: first open runtime whose db holds sessionId
    S-->>M: route {runtime, id, folder, db}
    M->>H: run(op, prepare=false, guard)
    H->>S: guard(): same id, folder, db?
    alt changed
        S-->>R: CONFLICT
    else same
        H->>C: decideApproval(request)
        C-->>R: {} and events masked per owner
    end
    R->>M: vera:subscription subscribe {sessionId, sinceSeq}
    M->>S: route to owner host
    H->>C: subscribe(sessionId, sinceSeq)
    C-->>R: stored rows once, then live text of unfinished items, then live events
```

## State

```mermaid
stateDiagram-v2
    [*] --> Empty
    Empty --> Streaming: message.delta / reasoning.delta / tool.update kept per item
    Streaming --> Streaming: more deltas (tail 500000 chars)
    Streaming --> Streaming: message.done drops that message text; tool.done drops that tool output
    Streaming --> Empty: turn.done or session.interrupted
    Empty --> [*]: hub cleared on close
```

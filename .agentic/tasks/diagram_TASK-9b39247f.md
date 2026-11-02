# TASK-9b39247f diagrams

Illustrates `## Design` in `TASK-9b39247f.md`. The Design text is authoritative.

Node classes: added = program-rules.ts, program-request.ts, program-approvals e2e; changed =
ApprovalGate, ChangeRequest (changes.ts), shared events/session-state/ipc, PluginStore, approval
card, permission picker, mock sessions, CLI approval prompt; unchanged = PathGuard, LoadedPlugin.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    rules["shared program-rules.ts"]:::added
    prep["core plugins/program-request.ts"]:::added
    gate["core ApprovalGate"]:::changed
    req["core ChangeRequest (changes.ts)"]:::changed
    schemas["shared events / session-state / ipc"]:::changed
    store["core PluginStore.summary"]:::changed
    card["desktop approval-card.tsx"]:::changed
    picker["desktop permission-picker.tsx"]:::changed
    mock["renderer mocks/sessions.ts"]:::changed
    cli["cli approval-prompt.ts"]:::changed
    guard["PathGuard"]
    loaded["LoadedPlugin"]
    prep ==> rules
    prep ==> guard
    prep ==> loaded
    prep ==> req
    gate ==> rules
    gate ==> schemas
    mock ==> rules
    card ==> schemas
    picker ==> store
    cli ==> schemas
```

## Sequence

```mermaid
sequenceDiagram
    participant T as Caller (PLG-04 run_program)
    participant P as prepareProgramRequest
    participant G as ApprovalGate
    participant U as Card (renderer)
    T->>P: findProgram + prepare(program, args, cwd)
    P-->>T: ProgramChangeRequest (risk, confirm, files)
    T->>G: request(req)
    G->>G: programPolicy(mode, risk, trial)
    G-->>U: approval.requested (program payload)
    U->>G: decide(approved, confirmation)
    alt typed word wrong
        G-->>U: INVALID approval.confirmMismatch (still pending)
        U->>G: decide(approved, "burn-key")
    end
    G-->>T: approved
    T->>P: prepare again (re-hash files)
    T->>G: consume(req')
    G-->>T: ok, or CONFLICT when a file changed
```

## State

```mermaid
stateDiagram-v2
    [*] --> Refused: policy refuse (blocked, read-only)
    [*] --> RunsUnrecorded: policy run (safe, not trial)
    [*] --> ApprovedByMode: policy mode
    [*] --> Pending: policy user or confirm
    Pending --> Pending: wrong typed word (INVALID)
    Pending --> ApprovedByUser: decide approved (+ word when confirm)
    Pending --> Denied: decide denied
    Pending --> ApprovedByMode: switch to bypass, not trial
    Pending --> Aborted: read-only, stop, abort
    ApprovedByUser --> Consumed: consume with same digest
    ApprovedByMode --> Consumed: consume while policy still mode
    ApprovedByMode --> Void: mode changed (CONFLICT)
    ApprovedByUser --> Void: named file changed (CONFLICT)
    Consumed --> [*]
```

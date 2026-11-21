# TASK-a49f4f0c diagrams

Illustrates `## Design` in `TASK-a49f4f0c.md`. The Design text is authoritative.

Node classes: WorkbenchRuntimes = added; index.ts wiring, SessionsHost, SessionService,
WorkbenchService (locate), DisplayDocuments = changed; ProgramRunner, TerminalService = unchanged.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    ipc["main/index.ts handlers"]:::changed ==> registry["WorkbenchRuntimes"]:::added
    registry ==> fg["foreground runtime"]
    registry ==> bg["retained runtimes by folder"]
    fg --> wbA["WorkbenchService (lock, db, queue, ingest)"]:::changed
    fg --> shA["SessionsHost"]:::changed
    bg --> wbB["WorkbenchService"]:::changed
    bg --> shB["SessionsHost"]:::changed
    shA --> svcA["SessionService"]:::changed
    shB --> svcB["SessionService"]:::changed
    svcB -. "onWorkSettled" .-> registry
    registry -- "release: stopWorkbench(folder)" --> runner["ProgramRunner"]
    ipc --> terminals["TerminalService (foreground)"]
    ipc --> display["DisplayDocuments"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant R as Renderer
    participant M as index.ts
    participant W as WorkbenchRuntimes
    participant A as Runtime A (foreground)
    participant B as Runtime B (fresh)
    R->>M: workbench.open(B)
    M->>W: open(B)
    W->>A: workbench.locate(B)
    W->>B: sessions.lifecycle(open B, no drain)
    B-->>W: snapshot B
    W->>W: foreground = B
    W->>A: clearSubscriptions, idle()?
    alt A busy
        W->>W: retain A by folder
        A-->>W: settled (turn ended)
        W->>A: lifecycle(drain, stopPrograms, close)
    else A idle
        W->>A: lifecycle(drain, stopPrograms, close)
    end
    W-->>M: snapshot B
```

## State

```mermaid
stateDiagram-v2
    [*] --> Foreground: open/create succeeds
    Foreground --> Foreground: reopen same folder
    Foreground --> Retained: other workbench opens, runtime busy
    Foreground --> Released: other workbench opens, runtime idle
    Foreground --> Released: explicit close
    Retained --> Foreground: user opens its folder again
    Retained --> Released: owned work settles
    Retained --> Released: app exit
    Foreground --> Released: app exit
    Released --> [*]
```

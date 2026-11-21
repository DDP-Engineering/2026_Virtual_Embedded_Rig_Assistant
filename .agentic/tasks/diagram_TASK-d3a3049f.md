# TASK-d3a3049f diagrams

Illustrates `## Design` in `TASK-d3a3049f.md`. The Design text is authoritative.

Node classes: TurnLimit (core admission) and useTurnCapacity = added; Advanced registry, shared
errors/IPC/events, SessionService, delegation tool, main index.ts, SessionsHost, renderer workspace and
mock = changed; ReplayGateway/provider gateway and WorkbenchRuntimes = unchanged.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    settings["Advanced registry: concurrentTurns"]:::changed --> main["main/index.ts"]:::changed
    main == "one instance" ==> limit["core TurnLimit"]:::added
    main ==> hostA["SessionsHost A"]:::changed
    main ==> hostB["SessionsHost B"]:::changed
    hostA == "admission" ==> svcA["SessionService A"]:::changed
    hostB == "admission" ==> svcB["SessionService B"]:::changed
    svcA -- "acquire / release" --> limit
    svcB -- "acquire / release" --> limit
    svcA --> tool["delegation tool (TURN_LIMIT text)"]:::changed
    svcA --> gateway["provider gateway"]
    limit -. "changed" .-> main
    main -- "session.capacity event + IPC" --> hook["useTurnCapacity"]:::added
    hook --> workspace["workspace composer status"]:::changed
    main --> shared["shared errors / ipc / events"]:::changed
    main --> runtimes["WorkbenchRuntimes"]
```

## Sequence

```mermaid
sequenceDiagram
    participant R as Renderer composer
    participant M as Desktop main
    participant S as SessionService (owner)
    participant L as TurnLimit
    participant G as Provider gateway
    R->>M: session.send
    M->>S: send (owner runtime, queued slot)
    S->>L: acquire()
    alt slot free
        L-->>S: slot
        S->>G: stream request
        L-->>M: changed {active, limit}
        M-->>R: app event session.capacity
        S-->>M: { turnId, messageId }
        M-->>R: ok
        G-->>S: turn ends
        S->>L: slot.release()
        L-->>M: changed
        M-->>R: app event session.capacity
    else at capacity
        L-->>S: undefined
        S-->>M: throw TURN_LIMIT {limit}
        M-->>R: error TURN_LIMIT (draft kept)
        R->>R: alert until active < limit, then "turn can start"
    end
```

## State

```mermaid
stateDiagram-v2
    [*] --> Refused: acquire at limit (TURN_LIMIT)
    [*] --> Held: acquire below limit
    Held --> Held: steering message queued
    Held --> Held: awaiting approval
    Held --> Released: completion, Stop, failure
    Held --> Released: discard (refused launch)
    Held --> Released: workbench sessions close
    Released --> Released: release() again (no effect)
    Refused --> [*]
    Released --> [*]
```

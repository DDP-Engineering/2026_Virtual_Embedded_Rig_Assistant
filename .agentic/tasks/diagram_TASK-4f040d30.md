# TASK-4f040d30 diagrams

Illustrates `## Design` in `TASK-4f040d30.md`. The Design text is authoritative.

Node classes: added = program-tools.ts, desktop program resolver, echo-tools fixture plugin; changed =
SessionService, ReferenceRuntime, program-request.ts, ProgramRunner, buildSystemPrompt, SkillCatalog,
WorkbenchService, shared skills/tools/program-rules, desktop sessions host and main, CLI run.ts,
renderer skills settings; unchanged = ApprovalGate, PluginStore, PathGuard.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    tools["core plugins/program-tools.ts"]:::added
    resolver["desktop main program resolver"]:::added
    fixture["tests/fixtures/plugins/echo-tools"]:::added
    service["core SessionService"]:::changed
    runtime["core ReferenceRuntime"]:::changed
    request["core program-request.ts"]:::changed
    runner["core ProgramRunner"]:::changed
    prompt["core buildSystemPrompt"]:::changed
    catalog["core SkillCatalog"]:::changed
    workbench["core WorkbenchService.loadPlugins"]:::changed
    shared["shared skills / tools / program-rules"]:::changed
    host["desktop main/sessions.ts + index.ts"]:::changed
    cli["cli run.ts"]:::changed
    ui["renderer skills.tsx"]:::changed
    gate["core ApprovalGate"]
    store["core PluginStore"]
    guard["PathGuard"]
    runtime ==> service
    service ==> tools
    service ==> gate
    tools ==> request
    tools ==> runner
    tools ==> shared
    request ==> guard
    workbench ==> store
    catalog ==> workbench
    host ==> workbench
    host ==> resolver
    host ==> prompt
    host ==> service
    cli ==> workbench
    cli ==> prompt
    cli ==> service
    prompt ==> tools
    ui ==> shared
    fixture -.-> store
```

## Sequence

```mermaid
sequenceDiagram
    participant M as Model (runtime)
    participant S as SessionService
    participant T as run_program
    participant G as ApprovalGate
    participant U as User (card)
    participant R as ProgramRunner
    M->>S: approve(call run_program)
    S->>T: prepare: plugins, findProgram, resolve, prepareProgramRequest, refuse policy -> error
    T-->>S: request (risk, files hashes)
    S->>S: scrub check
    S->>G: request(request)
    G-->>U: approval.requested (device-write)
    U->>G: decide approved
    G-->>S: approved
    M->>S: execute(run_program)
    S->>T: apply
    T->>T: prepare again (current plugins, resolver, files)
    T->>G: consume(request again) - CONFLICT if changed
    T->>R: start(beforeSpawn = re-hash files)
    R->>R: open log, beforeSpawn, spawn
    R-->>T: done (exitCode, output tail, log)
    T-->>S: result (capped, scrubbed)
    S-->>M: tool result
```

## State

```mermaid
stateDiagram-v2
    [*] --> Prepared: run_program prepare
    Prepared --> Refused: policy refuse / undeclared / unavailable
    Prepared --> Waiting: gate pending (user or confirm)
    Prepared --> Approved: gate run or mode
    Waiting --> Approved: user approves
    Waiting --> Denied: user denies or abort
    Approved --> Conflict: re-prepare differs / consume CONFLICT / beforeSpawn hash differs
    Approved --> Running: spawn
    Running --> Finished: exit / timeout / stop
    Running --> Background: background (handle registered)
    Background --> Background: program_output
    Background --> Finished: exit / session stop / program_stop
    Finished --> [*]: foreground result or program_stop removes handle
    Refused --> [*]
    Denied --> [*]
    Conflict --> [*]
```

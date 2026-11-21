# TASK-5de66ce2 diagrams

Illustrates `## Design` in `TASK-5de66ce2.md`. The Design text is authoritative.

Node classes from the Design: added = `ToolContext.advanced`/`toolLimit`, host getters (pool deadline,
runner limits, web timeout); changed = registry, service, tools (read, grep, glob, web, web_download,
run_program, run_command), runtime final cut, worker pool, runner, configured web provider, WebDownloads,
transfer, desktop/CLI hosts; unchanged = registry `resolveAdvanced`.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    reg["shared advancedSettings (+17 keys)"]:::changed
    resolve["resolveAdvanced"]
    svc["SessionService.startTurn"]:::changed
    ctx["ToolContext.advanced / toolLimit"]:::added
    tools["read, grep, glob, web, web_download, run_program, run_command"]:::changed
    cap["registry capToolResult + runtime final cut"]:::changed
    hosts["desktop main / CLI run"]:::changed
    getters["host getters: pool deadline, runner limits, web timeout"]:::added
    pool["NodeWorkerPool"]:::changed
    runner["ProgramRunner"]:::changed
    web["ConfiguredWebProvider"]:::changed
    dl["WebDownloads.save + transfer"]:::changed
    reg --> resolve
    svc --> resolve
    svc --> ctx
    ctx --> tools
    tools --> cap
    tools --> dl
    hosts --> getters
    getters --> pool
    getters --> runner
    getters --> web
    tools --> pool
    tools --> runner
    tools --> web
```

## Sequence

```mermaid
sequenceDiagram
    participant M as Model
    participant T as web_download tool
    participant A as Approval gate
    participant D as WebDownloads.save
    participant X as transfer port
    M->>T: web_download(url)
    T->>T: prepare: maxBytes = toolLimit(downloadMB) x 1 MiB
    T->>A: approval request (bound maxBytes, hashed)
    A-->>T: approved
    T->>D: save(target, {maxBytes, deadlineMs = toolLimit(downloadTimeout)})
    D->>X: transfer(url, signal, {maxBytes, deadlineMs})
    X-->>D: bytes, or "Download exceeds the size limit." / timeout
    D-->>T: download record, or the error with nothing saved
```

## State

Not drawn: the design adds no lifecycle, status field or state transition.

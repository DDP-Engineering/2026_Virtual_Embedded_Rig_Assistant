# TASK-98ecbd0a diagrams

Illustrates `## Design` in `TASK-98ecbd0a.md`. The Design text is authoritative.

Node map: added = plugins.choose, plugins.review, runs.* channels, RunsTab, run records; changed = Plugins page, PluginStore, ProgramRunner, program-tools, Shell, mockApi; unchanged = Provisioner, WorkbenchService.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    page["Plugins page (plugins.tsx)"]:::changed
    runs["RunsTab (runs-tab.tsx)"]:::added
    shell["Shell right panel"]:::changed
    mock["mockApi"]:::changed
    ipc["shared channels: plugins.choose/review/install, runs.list/log/stop"]:::added
    main["desktop main handlers"]:::changed
    store["PluginStore review + install(sha256)"]:::changed
    runner["ProgramRunner list/log/stopRun"]:::changed
    tools["program-tools run_program label"]:::changed
    prov["Provisioner"]
    wb["WorkbenchService togglePlugin"]
    files[(".vera/runs/<id>.log + <id>.json")]:::added
    shell --> runs
    page --> ipc
    runs --> ipc
    page -.-> mock
    runs -.-> mock
    ipc --> main
    main --> store
    main --> runner
    main --> prov
    main --> wb
    tools --> runner
    runner --> files
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant P as Plugins page
    participant M as Main
    participant S as PluginStore
    U->>P: Install from folder
    P->>M: plugins.choose {kind: folder}
    M-->>P: {path}
    P->>M: plugins.review {path}
    M->>S: review(path)
    S-->>P: {sha256, manifest, issues}
    U->>P: Install (no issues)
    P->>M: plugins.install {path, sha256}
    M->>S: install(path, sha256)
    alt package changed since review
        S-->>P: CONFLICT (review stays open)
    else same hash
        S-->>P: installed summary
        P->>M: plugins.list {workbenchId}
    end
    U->>P: enable switch
    P->>M: plugins.toggle {workbenchId, id, enabled}
```

## State

```mermaid
stateDiagram-v2
    [*] --> running: begin writes record (no end)
    running --> exited: process exits / cannot start
    running --> stopped: Stop, session stop, workbench close, app exit
    running --> timedOut: timeout
    running --> interrupted: app ends without the end record (listing view)
    exited --> [*]
    stopped --> [*]
    timedOut --> [*]
    interrupted --> [*]
```

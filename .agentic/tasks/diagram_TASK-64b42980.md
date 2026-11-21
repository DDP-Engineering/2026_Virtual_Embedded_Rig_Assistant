# TASK-64b42980 diagrams

Illustrates the Design in TASK-64b42980.md.

## Structure

Added: GitStatusService, GitRead, GitStatusControls. Changed: DocsTree, Desktop IPC.
Reused: WorkbenchService, Git executable.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#dce9fc,stroke:#345669
    ui["GitStatusControls"] --> ipc["Desktop IPC"] --> service["GitStatusService"]
    service --> owner["WorkbenchService"]
    service --> read["GitRead"] --> git["Git executable"]
    ui --> tree["DocsTree"]
    class ui,service,read added
    class ipc,tree changed
```

## Sequence

```mermaid
sequenceDiagram
    participant F as GitStatusControls
    participant S as GitStatusService
    participant R as GitRead
    participant G as Git executable
    F->>S: open(workbench, activation, view)
    S->>R: read scoped status
    R->>G: fixed status against private metadata
    G-->>R: NUL-delimited porcelain
    R-->>S: scoped snapshot
    S-->>F: publish for same activation and view
```

## State

```mermaid
stateDiagram-v2
    [*] --> Inactive
    Inactive --> Reading: open current view
    Reading --> Ready: read succeeds
    Reading --> Unavailable: read cannot complete
    Ready --> Reading: debounced change or manual refresh
    Unavailable --> Reading: manual refresh or watched change
    Ready --> Inactive: close or activation retirement
    Unavailable --> Inactive: close or activation retirement
    Reading --> Inactive: close or activation retirement
```

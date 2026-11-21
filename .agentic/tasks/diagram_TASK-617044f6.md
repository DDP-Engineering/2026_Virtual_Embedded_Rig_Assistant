# TASK-617044f6 diagrams

Illustrates `## Design` in `TASK-617044f6.md`. The Design text is authoritative.

Node classes from the Design: changed = PowerShell startup script, TerminalCommandPrompt, TerminalService.execute;
unchanged = renderer Run action, terminal.execute IPC, node-pty.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    run["renderer Run action"] --> ipc["terminal.execute IPC"]
    ipc --> exec["TerminalService.execute"]:::changed
    exec --> prompt["TerminalCommandPrompt (two markers, constrained flag)"]:::changed
    prompt --> script["PowerShell startup script (Full / other branch)"]:::changed
    exec --> pty["node-pty write"]
    pty --> script
```

## Sequence

```mermaid
sequenceDiagram
    participant R as Renderer
    participant T as TerminalService
    participant P as TerminalCommandPrompt
    participant S as PowerShell (pty)
    T->>S: start with startup script
    S-->>P: PS path> + constrained marker (not Full Language)
    P-->>P: ready, constrained = true
    R->>T: execute(block)
    T->>P: wait, read constrained, consume
    T->>S: Invoke-Expression (-join [char[]](codes))
    S-->>S: Read-Host line, Invoke-Expression, block runs once
```

## State

```mermaid
stateDiagram-v2
    [*] --> starting
    starting --> ready: Full marker
    starting --> readyConstrained: constrained marker
    starting --> timedOut: 5 s
    timedOut --> ready: Full marker
    timedOut --> readyConstrained: constrained marker
    ready --> used: consume / input / close
    readyConstrained --> used: consume / input / close
    starting --> used: input / close
```

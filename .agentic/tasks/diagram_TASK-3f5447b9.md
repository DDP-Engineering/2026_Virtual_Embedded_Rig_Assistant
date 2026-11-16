# TASK-3f5447b9 diagrams

Illustrates the authoritative Design in TASK-3f5447b9.md.

## Structure

Node map: TerminalTab, TerminalService and PTY factory added; IPC, registry/runtime and package closure changed; shell resolver reused unchanged.

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 ui["TerminalTab / xterm"]:::added ==> ipc["Strict IPC"]:::changed
 ipc ==> host["TerminalService"]:::added
 host ==> pty["node-pty factory"]:::added
 pty ==> cleanup["PTY session / job-group cleanup"]:::added
 host ==> resolver["resolveCommandShell"]
 tools["terminal_read / registry"]:::changed ==> host
 tools ==> runtime["Runtime publication guard"]:::changed
 package["Package native closure"]:::changed ==> pty
```

## Sequence

```mermaid
sequenceDiagram
 participant User
 participant Renderer
 participant Host
 participant PTY
 participant Agent
 User->>Renderer: Open terminal
 Renderer->>Host: create(workbenchId)
 Host->>PTY: spawn interactive shell
 User->>Renderer: Type and resize
 Renderer->>Host: input / resize
 Host->>PTY: write / resize
 Agent->>Host: terminal_read
 Host-->>Agent: Denied before consent
 User->>Renderer: Enable reads
 Renderer->>Host: consent(true)
 Agent->>Host: terminal_read
 Host-->>Agent: Output / internal lease
 Agent->>Host: Validate at publication
 Host-->>Agent: Current grant or denial
```

## State

```mermaid
stateDiagram-v2
 [*] --> Private: user creates
 Private --> Shared: user grants
 Shared --> Private: user revokes
 Private --> Closed: close / switch / shutdown
 Shared --> Closed: close / switch / shutdown
 Closed --> [*]
```

# TASK-002d804f diagrams

Illustrates Design in TASK-002d804f.md. The Design text is authoritative.

## Structure

Map: command-tools/shell added; ApprovalGate, ProgramRunner and settings changed; ProgramSession reused.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  settings["settings.shell"]:::changed ==> shell["shell.ts"]:::added
  command["command-tools.ts"]:::added ==> shell
  command ==> gate["ApprovalGate"]:::changed
  command ==> runner["ProgramRunner"]:::changed
  command ==> session["ProgramSession"]
```

## Sequence

```mermaid
sequenceDiagram
  participant Agent
  participant Command as command-tools
  participant Gate as ApprovalGate
  participant Runner as ProgramRunner
  participant Shell
  Agent->>Command: run_command
  Command->>Gate: exact prepared request
  Gate-->>Command: user or Bypass approval
  Command->>Runner: revalidate cwd, shell and consume grant
  Runner->>Shell: spawn with closed stdin
  Runner-->>Agent: result or background handle
```

## State

Not drawn: commands reuse the existing run lifecycle without new states.

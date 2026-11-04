# TASK-951445ca diagrams

Illustrates the task Design. Map: Git package/projection added; manifest schema/classifyCommand changed; gate/provisioner/runner reused unchanged.

## Structure
```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  package["plugins/git"]:::added ==> schema["pluginManifestSchema"]:::changed
  schema ==> matcher["classifyCommand"]:::changed
  matcher ==> projection["gitRuleArguments"]:::added
  matcher --> gate["ApprovalGate"]
  gate --> runner["ProgramRunner"]
  package ==> provisioner["Provisioner"]
  provisioner --> runner
```

## Sequence
```mermaid
sequenceDiagram
  participant Agent
  participant Core
  participant User
  participant Git
  Agent->>Core: run_program raw argv
  Core->>Core: project roles and highest risk
  opt Change needs approval
    Core->>User: Exact command approval
    User->>Core: Approve
  end
  Core->>Git: Fixed prefix, raw argv, fixed env
  Git-->>Core: Output and exit
  Core-->>Agent: Result and run log
```

## State
Not drawn: existing approval and runner states are reused unchanged.

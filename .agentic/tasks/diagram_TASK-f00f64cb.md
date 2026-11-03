# TASK-f00f64cb diagrams

Illustrates Design in TASK-f00f64cb.md. Design text is authoritative.

## Structure

Node map: schema, Provisioner, launcher helper, tools and runner changed; esp32-idf added; ProcessHost reused unchanged.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  p["esp32-idf"]:::added ==> s["pluginManifestSchema"]:::changed
  s ==> r["Provisioner"]:::changed
  r ==> l["programInvocation"]:::changed
  t["runProgramTool"]:::changed ==> l
  t ==> runner["ProgramRunner programArgs"]:::changed
  runner --> host["ProcessHost"]
```

## Sequence

```mermaid
sequenceDiagram
  participant T as runProgramTool
  participant R as Provisioner
  participant G as ApprovalGate
  participant P as ProgramRunner
  participant H as ProcessHost
  T->>R: resolve launcher program
  R-->>T: executable and transport
  T->>G: program args, actual argv, file hashes
  G-->>T: exact decision
  T->>R: resolve again
  T->>G: consume current request
  T->>P: actual argv and programArgs
  P->>P: serial guard and final file hashes
  P->>H: spawn without shell
```

## State

Not drawn: reuses existing program provisioning and run lifecycle states.

# TASK-bb6f2f0e diagrams

Illustrates Design in TASK-bb6f2f0e.md; the Design text is authoritative.

## Structure

Map: binutils package added; schema and Provisioner changed; PluginStore, ProcessHost and ProgramRunner reused unchanged.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    binutils["plugins/binutils"]:::added ==> schema["pluginManifestSchema"]:::changed
    schema --> store["PluginStore"]
    store --> provisioner["Provisioner"]:::changed
    provisioner --> host["ProcessHost"]
    provisioner --> runner["ProgramRunner"]
```

## Sequence

```mermaid
sequenceDiagram
    participant User
    participant Provisioner
    participant ProcessHost
    participant Download
    User->>Provisioner: statuses / resolve
    Provisioner->>ProcessHost: found executable --version
    ProcessHost-->>Provisioner: version or unavailable
    User->>Provisioner: install
    alt no executable found
        Provisioner->>Download: pinned archive
        Download-->>Provisioner: verified bytes
        Provisioner->>ProcessHost: extracted executable --version
        ProcessHost-->>Provisioner: version
    end
    Provisioner-->>User: statuses
```

## State

Not drawn: existing missing/unavailable/ready lifecycle is reused without a new status or transition.

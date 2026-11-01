# TASK-0cb6ef0f diagrams

Illustrates `## Design` in `TASK-0cb6ef0f.md`. The Design text is authoritative.

| Node | Class |
|---|---|
| shared plugins.ts schemas, PluginStore, plugins.* channels | added |
| workbench.ts schema/warnings, WorkbenchService, main index.ts, mockApi | changed |
| fflate, yaml, userData plugins folder | unchanged (reused) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    schema["shared plugins.ts (pluginManifestSchema)"]:::added
    channels["shared ipc.ts plugins.*"]:::added
    wbschema["shared workbench.ts (plugins.enabled, configWarnings)"]:::changed
    store["core PluginStore"]:::added
    service["core WorkbenchService (togglePlugin, warnings)"]:::changed
    main["desktop main index.ts"]:::changed
    mock["renderer mockApi"]:::changed
    fflate["fflate unzipSync"]
    disk[("userData/plugins/installed")]
    yaml[(".vera/workbench.yaml")]
    main ==> channels
    main ==> store
    main ==> service
    mock ==> channels
    store ==> schema
    store ==> fflate
    store ==> disk
    service ==> store
    service ==> wbschema
    service --> yaml
```

## Sequence

```mermaid
sequenceDiagram
    participant R as Renderer
    participant M as main plugins.install
    participant S as PluginStore
    participant FS as userData/plugins
    R->>M: plugins.install {path}
    M->>S: install(path)
    S->>S: read folder or zip into memory (limits, path rules)
    S->>S: parse plugin.yaml, pluginManifestSchema, id = folder
    alt any issue
        S-->>M: INVALID {issue, path}
    else valid
        S->>FS: write staging/<uuid>/ files + install.json (sha256)
        S->>FS: move installed/<id> aside, rename staging into place
        S->>FS: remove the old folder
        S-->>M: summary
    end
    M-->>R: summary or error
```

## State

```mermaid
stateDiagram-v2
    [*] --> Valid: install
    Valid --> Changed: a file is added, edited, renamed or removed
    Changed --> Valid: original bytes restored
    Valid --> Valid: reinstall
    Changed --> Valid: reinstall
    Valid --> [*]: uninstall
    Changed --> [*]: uninstall
```

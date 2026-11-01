# TASK-37222751 diagrams

Illustrates `## Design` in `TASK-37222751.md`. The Design text is authoritative. Drawn after the task closed, at the user's request to use diagrams.

Node classes (from the Design):

| Node | Class |
|---|---|
| WorkbenchConfigForm, WorkbenchCreate, workbench.inspect channel, WorkbenchService.inspect | added |
| WorkbenchEditor (inline page), Workbench (overview only), App.tsx, workbench.create channel, WorkbenchService.create, main index.ts, mockApi | changed |
| SkillSettings, WorkbenchTools, PermissionPicker, SkillCatalog | unchanged |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    app["App.tsx"]:::changed
    create["WorkbenchCreate"]:::added
    editor["WorkbenchEditor"]:::changed
    overview["Workbench overview"]:::changed
    form["WorkbenchConfigForm"]:::added
    skills["SkillSettings"]
    tools["WorkbenchTools"]
    ipc["shared ipc.ts workbench.inspect / workbench.create"]:::changed
    main["main index.ts handlers"]:::changed
    mock["mockApi"]:::changed
    service["WorkbenchService.inspect / create"]:::changed
    catalog["SkillCatalog"]
    app ==> create
    app --> editor
    app --> overview
    create ==> form
    editor ==> form
    editor --> skills
    form ==> tools
    create ==> ipc
    editor --> ipc
    ipc --> main
    ipc --> mock
    main --> service
    service ==> catalog
```

## Sequence

```mermaid
sequenceDiagram
    actor Engineer
    participant Create as WorkbenchCreate
    participant Main as main index.ts
    participant Service as WorkbenchService
    participant Disk as workbench folder
    Engineer->>Create: Choose folder
    Create->>Main: app.chooseFolder
    Main-->>Create: folder
    Create->>Main: workbench.inspect {folder}
    Main->>Service: inspect(folder)
    Service->>Disk: read .vera/WORKBENCH.md and skills (no writes)
    Service-->>Create: folder, name, existing, instructions, skills
    Engineer->>Create: edit draft sections, Create
    Create->>Main: workbench.create {folder, name, config, instructions}
    Main->>Service: create(folder, name, initial)
    Service->>Service: merge and validate draft (INVALID before any write)
    Service->>Disk: write workbench.yaml, WORKBENCH.md unless it exists
    Service-->>Create: snapshot of the opened workbench
```

## State

```mermaid
stateDiagram-v2
    [*] --> NoFolder
    NoFolder --> Inspecting: Choose folder
    Inspecting --> ExistingWorkbench: inspect.existing
    Inspecting --> Draft: not a workbench
    ExistingWorkbench --> Opened: Open this workbench
    Draft --> Draft: edit sections
    Draft --> Creating: Create
    Creating --> Opened: snapshot
    Creating --> Draft: error shown
    Opened --> [*]
```

# TASK-66225463 diagrams

Illustrates Design in TASK-66225463.md.

## Structure

Changed: WorkbenchPlugins, WorkbenchSharedCapabilities and App's navigation. Reused: Plugins catalog, plugin inventory IPC and tool allowance storage.

```mermaid
flowchart LR
  Inventory[Plugin inventory IPC] --> Editor[WorkbenchPlugins]
  Editor --> Shared[Shared capability section]
  Editor --> Owner[Existing workbench draft]
  Editor --> App[App catalog navigation]
  App --> Global[Global Plugins]
```

## Sequence

```mermaid
sequenceDiagram
  participant User
  participant Editor
  participant App
  participant Catalog
  User->>Editor: Open Plugins with empty inventory
  Editor-->>User: Show message and catalog shortcut
  User->>App: Browse available plugins
  App->>Catalog: Show unfiltered catalog
  User->>App: Return to the workbench
  App->>Editor: Resume the same draft and read inventory
```

## State

Not drawn: the installed-package and draft lifecycles are unchanged.

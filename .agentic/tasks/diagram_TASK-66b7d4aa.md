# TASK-66b7d4aa diagrams

Illustrates `## Design` in `TASK-66b7d4aa.md`. The Design text is authoritative.

| Node | Class |
|---|---|
| core workbench/tree.ts, docs.tree/find/read/stat, docs-tree.tsx, tree-menu.tsx, tree-properties.tsx | added |
| WorkbenchService, DocsTab, viewer-context ViewerTarget, mockApi | changed |
| docs.list, docs.open, OpenExternally, readIgnorePolicy | unchanged (reused) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    tree["docs-tree.tsx (ARIA tree, filter, memory)"]:::added
    tab["DocsTab"]:::changed
    viewer["viewer-context ({path} | {textPath})"]:::changed
    ipc["docs.tree / docs.find / docs.read / docs.stat"]:::added
    list["docs.list (counts, status)"]
    service["WorkbenchService"]:::changed
    core["core workbench/tree.ts"]:::added
    menu["tree-menu.tsx (Open, Open in default app, Properties)"]:::added
    props["tree-properties.tsx (dialog)"]:::added
    tab --> tree
    tree --> menu --> props
    props --> ipc
    tree --> ipc --> service --> core
    tree --> list
    tree --> viewer
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant T as Docs tree
    participant M as main
    participant S as Source tab
    U->>T: expand "datasheets"
    T->>M: docs.tree {path: "datasheets"}
    M-->>T: entries (folders, files)
    U->>T: Enter on main.c (not indexed)
    T->>S: open {textPath}
    S->>M: docs.read
    M-->>S: text lines
    U->>T: right click a.pdf, Properties
    T->>M: docs.stat {path: "docs/a.pdf"}
    M-->>T: type, size, modified
```

## State

Not drawn: the expanded set is a persisted list of folder paths.

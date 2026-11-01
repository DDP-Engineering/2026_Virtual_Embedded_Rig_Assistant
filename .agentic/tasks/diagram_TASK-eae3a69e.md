# TASK-eae3a69e diagrams

Illustrates `## Design` in `TASK-eae3a69e.md`. The Design text is authoritative.

| Node | Class |
|---|---|
| main openers.ts, docs.openers/openWith/reveal/copyPath, core locateEntry | added |
| tree-menu.tsx (submenus), docs-tree.tsx menu, mockApi | changed |
| app.openPath (Default app), app.info, PathGuard | unchanged (reused) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    menu["tree-menu.tsx (Open in, Copy submenus)"]:::changed
    tree["docs-tree.tsx menuItems"]:::changed
    ipc["docs.openers / openWith / reveal / copyPath"]:::added
    openers["main openers.ts (detect, openWith, copyText)"]:::added
    locate["core locateEntry"]:::added
    os["spawn / shell.showItemInFolder / clipboard"]
    tree --> menu
    tree --> ipc --> openers
    ipc --> locate
    openers --> os
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant T as Docs tree menu
    participant M as main
    participant OS as OS
    U->>T: right click main.c, Open in, VS Code
    T->>M: docs.openWith {path, app: vscode}
    M->>M: locateEntry (confinement)
    M->>OS: spawn Code.exe [absolute path]
    M-->>T: {}
    U->>T: Copy, Relative path
    T->>M: docs.copyPath {form: relative}
    M->>OS: clipboard.writeText("firmware\\main.c")
    T-->>U: Copied to the clipboard.
```

## State

Not drawn: the menu has at most one open submenu; opening another closes it.

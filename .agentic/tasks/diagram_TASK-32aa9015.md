# TASK-32aa9015 diagrams

Illustrates `## Design` in `TASK-32aa9015.md`. The Design text is authoritative.

Node classes (from the Design):

| Node | Class |
|---|---|
| shared externalDocumentExtensions / opensExternally | added |
| app.openPath channel, main openPath, OpenExternally button | added |
| reveal-path.ts (guardedFile factored out), main index.ts, viewer-context.tsx, docs-tab.tsx | changed |
| PathGuard, shell.openPath | unchanged (reused) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    allow["shared opensExternally"]:::added
    button["OpenExternally button"]:::added
    viewer["viewer-context.tsx header"]:::changed
    docs["docs-tab.tsx rows"]:::changed
    ipc["app.openPath"]:::added
    open["main openPath"]:::added
    guard["reveal-path.ts guardedFile"]:::changed
    pathguard["PathGuard"]
    shell["shell.openPath"]
    viewer ==> button
    docs ==> button
    button ==> allow
    button ==> ipc
    ipc ==> open
    open ==> allow
    open ==> guard
    guard ==> pathguard
    open ==> shell
```

## Sequence

```mermaid
sequenceDiagram
    participant UI as OpenExternally
    participant Main as app.openPath
    participant Guard as guardedFile
    participant OS as shell.openPath
    UI->>Main: {path: docs/pinout.xlsx}
    Main->>Main: opensExternally? else DENIED
    Main->>Guard: resolve, ordinary file, re-check
    Guard-->>Main: absolute path (or DENIED / NOT_FOUND)
    Main->>OS: open(absolute)
    OS-->>Main: "" or error text
    Main-->>UI: {} or INTERNAL
```

## State

Not drawn: no lifecycle or stored state.

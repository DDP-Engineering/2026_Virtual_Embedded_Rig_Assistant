# TASK-1c2ea187 diagrams

Illustrates `## Design` in `TASK-1c2ea187.md`. The Design text is authoritative.

Node classes (from the Design):

| Node | Class |
|---|---|
| SourcePanel, useDocumentSource | added |
| DocumentViewerProvider (no dialog, recent, revision), Shell (Source tab, width), App, lib/layout.ts | changed |
| DocumentBody / PdfViewer, OpenExternally, citation chips, DocsTab, downloads | unchanged (reused) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    chips["citation chips / DocsTab / downloads"]
    provider["DocumentViewerProvider"]:::changed
    hook["useDocumentSource"]:::added
    panel["SourcePanel"]:::added
    body["DocumentBody / PdfViewer"]
    ext["OpenExternally"]
    shell["Shell Source tab"]:::changed
    layout["lib/layout.ts source width"]:::changed
    app["App"]:::changed
    chips ==> provider
    provider ==> hook
    hook ==> panel
    hook ==> shell
    panel ==> body
    panel ==> ext
    app ==> shell
    app ==> panel
    shell ==> layout
```

## Sequence

```mermaid
sequenceDiagram
    participant Chip as citation chip
    participant Prov as DocumentViewerProvider
    participant Shell
    participant Panel as SourcePanel
    participant API as docs.open
    Chip->>Prov: open(target)
    Prov->>Prov: recent, revision++, focus request
    Prov->>API: docs.open(target)
    Shell->>Shell: revision changed: expand panel, select Source
    API-->>Prov: content
    Prov-->>Panel: content, focus once
    Panel->>Panel: Escape: close source, focus opener
```

## State

Not drawn: the source state is a single current target plus a list; no lifecycle beyond open/close.

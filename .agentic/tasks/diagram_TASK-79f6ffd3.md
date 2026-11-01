# TASK-79f6ffd3 diagrams

Illustrates `## Design` in `TASK-79f6ffd3.md`. The Design text is authoritative.

| Node | Class |
|---|---|
| DocumentTabs | added |
| DocumentViewerProvider, DocumentBody/TextViewer, PdfViewer, App center, Shell right panel, layout.ts | changed |
| SourcePanel, Source tab, Recent sources, layout.source | removed |
| Files tree / search / downloads / transcript openers, docs.open / docs.read / downloads.open | unchanged (reused) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    openers["Files tree, search, downloads, citation chips"] -->|"useDocumentViewer().open"| provider["DocumentViewerProvider (tab map per session)"]:::changed
    provider -->|reveal| app["App center"]:::changed
    app --> tabs["DocumentTabs (tablist, panels)"]:::added
    tabs --> chat["SessionWorkspace (Chat, kept mounted)"]
    tabs --> body["DocumentBody / TextViewer (place)"]:::changed
    body --> pdf["PdfViewer (page)"]:::changed
    provider --> ipc["docs.open / docs.read / downloads.open"]
    shell["Shell right panel"]:::changed -.-> source["SourcePanel, Recent sources, layout.source"]:::removed
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant C as Citation chip
    participant P as DocumentViewerProvider
    participant A as App
    participant T as DocumentTabs
    participant M as main (docs.open)
    U->>C: click datasheet#p=47
    C->>P: open({sessionId, messageId, ref})
    P->>P: key file:datasheets/stm32g474.pdf (existing tab? replace target, clear place)
    P->>A: reveal()
    A->>T: chat area shown, tab selected
    P->>M: docs.open(ref)
    M-->>P: content (page 47)
    P->>T: tab content
    T->>U: PDF at page 47, focus in the document
```

## State

```mermaid
stateDiagram-v2
    [*] --> Loading: open (new tab or new place)
    Loading --> Shown: content loaded
    Loading --> Failed: load error
    Failed --> Loading: Retry or open again
    Shown --> Kept: another tab selected (unmounted, place kept)
    Kept --> Shown: tab selected again (mounted at place)
    Shown --> Loading: open again at another place
    Shown --> [*]: close
    Kept --> [*]: close
    Failed --> [*]: close
```

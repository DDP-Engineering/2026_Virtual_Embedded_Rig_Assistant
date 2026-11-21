# TASK-de5a9991 diagrams

Illustrates the task journal's Design.

## Structure

Added: GitDiffService, GitDiffView. Changed: DocsTree, DocumentViewerProvider, GitReader. Reused: TreeMenu, DiffViewer.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    docs["DocsTree"]:::changed --> menu["TreeMenu"]
    menu ==> tabs["DocumentViewerProvider"]:::changed
    tabs ==> view["GitDiffView"]:::added
    view ==> main["GitDiffService"]:::added
    main ==> git["GitReader"]:::changed
    view ==> patch["DiffViewer"]
```

## Sequence

```mermaid
sequenceDiagram
    participant DocsTree
    participant DocumentViewerProvider
    participant GitDiffService
    participant GitReader
    DocsTree->>DocumentViewerProvider: Open path comparison
    DocumentViewerProvider->>GitDiffService: Read display identity and lease
    GitDiffService->>GitReader: Read validated literal path
    GitReader-->>GitDiffService: Patch or notice
    GitDiffService-->>DocumentViewerProvider: Masked result for current activation
```

## State

```mermaid
stateDiagram-v2
    [*] --> Loading: Open comparison
    Loading --> Patch: Readable change
    Loading --> Notice: Empty or unavailable
    Loading --> [*]: Close or retire activation
    Patch --> Loading: Reopen
    Notice --> Loading: Retry
    Patch --> [*]: Close or retire activation
    Notice --> [*]: Close or retire activation
```

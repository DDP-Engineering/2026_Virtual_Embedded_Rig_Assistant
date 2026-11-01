# TASK-b34f2cc7 diagrams

Illustrates `## Design` in `TASK-b34f2cc7.md`. The Design text is authoritative.

| Node | Class |
|---|---|
| useTreeExpansion, .docs-actions row, In documents list | added |
| DocsTab, DocsTree, core tree.ts listFolder/readText/statEntry, docsTreeEntrySchema, mockApi | changed |
| docs.find, docs.search, findFiles, readIgnorePolicy | unchanged (reused) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    tab["DocsTab (one search box, actions row)"]:::changed
    exp["useTreeExpansion"]:::added
    tree["DocsTree (query, ignored rows)"]:::changed
    hits["In documents list"]:::added
    find["docs.find"]
    search["docs.search"]
    listing["docs.tree (entries + ignored)"]:::changed
    core["core tree.ts"]:::changed
    tab --> exp
    tab --> tree
    tab --> hits --> search
    tree --> find
    tree --> listing --> core
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant D as DocsTab
    participant T as DocsTree
    participant M as main
    U->>D: types "power"
    D->>D: 250 ms debounce
    D->>T: query "power"
    T->>M: docs.find
    D->>M: docs.search
    M-->>T: name matches
    M-->>D: keyword hits (In documents)
    U->>T: expand .git (dimmed)
    T->>M: docs.tree {path: ".git"}
    M-->>T: entries, ignored: true
```

## State

Not drawn: the search box is empty or has text; the tree switches between browsing and
filtered views on that alone.

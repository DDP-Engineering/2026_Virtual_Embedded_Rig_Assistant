# TASK-286a3fb6 diagrams

Illustrates `## Design` in `TASK-286a3fb6.md`. The Design text is authoritative.

Node map: added = createGitignoreRules, docs.gitignore checkbox; changed = createIgnoreRules,
readIgnorePolicy, selectDocuments, Ingester, service scan/preview/tree, tree.listFolder/findFiles,
shared docs schema, IPC scanDocs/previewDocs; unchanged = PathGuard.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    ui["Documents & RAG: Use .gitignore checkbox"]:::added --> ipc["IPC scanDocs / previewDocs + gitignore"]:::changed
    ui --> schema["shared docs.gitignore (default true)"]:::changed
    ipc --> svc["WorkbenchService scan / preview / listFolder / findFiles"]:::changed
    svc --> tree["tree.listFolder / findFiles"]:::changed
    svc --> policy["readIgnorePolicy(root, gitignore)"]:::changed
    tree --> policy
    ingest["Ingester + indexer selectDocuments"]:::changed --> policy
    policy --> combined["createIgnoreRules: permanent > .veraignore > .gitignore"]:::changed
    combined --> git["createGitignoreRules (root + nested)"]:::added
    guard["PathGuard (agent tools)"] --> combined
```

## Sequence

```mermaid
sequenceDiagram
    participant W as Watcher (Ingester)
    participant I as Indexer process
    participant P as Ignore policy
    W->>W: .gitignore changed -> refreshPolicy, bump generation, request()
    W->>I: select {root, docs incl. gitignore}
    I->>P: readIgnorePolicy(root, docs.gitignore)
    loop each walked entry
        I->>P: ignored(prefixes..., entry)
        P-->>I: permanent / .veraignore / .gitignore decision
    end
    I-->>W: selected paths and sizes
```

## State

Not drawn: no lifecycle or status field changes; docs.gitignore is a plain boolean.

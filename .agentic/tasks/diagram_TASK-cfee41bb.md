# TASK-cfee41bb diagrams

Illustrates the journal Design. Node map: DisplayDocuments and DisplayIdentities added; main IPC and renderer changed; WorkbenchService/resolver reused.

## Structure
```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 renderer["DocsTree and DocumentViewerProvider"]:::changed ==> ipc["main IPC"]:::changed
 ipc ==> display["DisplayDocuments"]:::added
 display ==> workbench["WorkbenchService"]
 display ==> identities["DisplayIdentities and host-local key"]:::added
 display ==> resolver["createMaskingResolver"]
```
## Sequence
```mermaid
sequenceDiagram
 participant UI as DocsTree
 participant IPC as DisplayDocuments
 participant Host as WorkbenchService
 UI->>IPC: read owning opaque path
 IPC->>IPC: authenticate and decrypt original identity
 IPC->>Host: read original path
 Host-->>IPC: confined content
 IPC->>IPC: recheck owner and live Display choice
 IPC-->>UI: identity plus conditional presentation
```
## State
```mermaid
stateDiagram-v2
 [*] --> Owned: workbench listing
 Owned --> Owned: issue or resolve exact identity
 Owned --> Closed: workbench closes; pending reads invalidated
 Closed --> Owned: reopen with persistent key
 Closed --> [*]
```

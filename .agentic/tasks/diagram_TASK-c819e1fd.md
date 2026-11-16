# TASK-c819e1fd diagrams

Illustrates Design in TASK-c819e1fd.md. Design is authoritative.

## Structure
Map: WorkbenchFolders added; WorkbenchService, ToolContext and PathGuard changed; ApprovalGate reused.
```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 ui["WorkbenchFolders"]:::added ==> service["WorkbenchService"]:::changed
 service ==> context["ToolContext"]:::changed
 context ==> guard["PathGuard"]:::changed
 guard ==> gate["ApprovalGate"]
```

## Sequence
```mermaid
sequenceDiagram
 participant User
 participant WorkbenchService
 participant ToolContext
 participant PathGuard
 User->>WorkbenchService: choose and save folder IDs
 ToolContext->>WorkbenchService: live folder grants
 ToolContext->>PathGuard: resolve lexical and canonical path
 User->>WorkbenchService: remove grant
 ToolContext->>PathGuard: recheck before result or execution
 PathGuard-->>ToolContext: refuse revoked grant
```

## State
```mermaid
stateDiagram-v2
 [*] --> Unlisted
 Unlisted --> Draft: native chooser
 Draft --> Granted: Save
 Draft --> Unlisted: Cancel
 Granted --> Removed: Save removal
 Removed --> Unlisted
```

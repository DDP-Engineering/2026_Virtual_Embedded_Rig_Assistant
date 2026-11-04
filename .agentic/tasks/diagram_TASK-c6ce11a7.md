# TASK-c6ce11a7 diagrams
Illustrates Design; Design is authoritative.

## Structure
Added: WorkbenchPlugins. Changed: WorkbenchConfigForm, WorkbenchEditor, WorkbenchCreate, Plugins. Unchanged: IPC/service/store.
```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 Form["WorkbenchConfigForm"]:::changed ==> Selector["WorkbenchPlugins"]:::added
 Editor["WorkbenchEditor"]:::changed --> Form
 Create["WorkbenchCreate"]:::changed --> Form
 Selector ==> List["plugins.list"]
 Editor ==> Save["workbench.config.update"]
 Create ==> New["workbench.create"]
 Manager["Plugins"]:::changed -.-> Toggle["plugins.toggle"]
```
## Sequence
```mermaid
sequenceDiagram
 participant User
 participant Form as WorkbenchConfigForm
 participant Host as WorkbenchService
 User->>Form: select plugins
 Form->>Form: update draft only
 User->>Form: Save
 Form->>Host: create or config.update with plugins.enabled
 Host-->>Form: persisted workbench snapshot
```
## State
```mermaid
stateDiagram-v2
 [*] --> Empty: new workbench default
 Empty --> Draft: select package
 Saved --> Draft: select or deselect
 Draft --> Saved: Save succeeds
 Draft --> Saved: Cancel keeps original
 Draft --> Draft: Save fails
```

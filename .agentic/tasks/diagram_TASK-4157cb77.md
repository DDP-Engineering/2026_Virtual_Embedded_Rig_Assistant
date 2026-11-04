# Chat detail design

Node map: Config/Form/App/Workspace/Transcript changed; Projection added; Storage/Activity reused unchanged.

## Structure
```mermaid
flowchart LR
 Form[Workbench Chat form] ==> Config[Shared config]
 Config ==> App
 App ==> Workspace
 Workspace ==> Transcript
 Transcript ==> Projection
 Workspace --> Activity
 Config --> Storage
 classDef added fill:#dfd,stroke:#282
 classDef changed fill:#ffd,stroke:#882
 classDef removed fill:#fdd,stroke:#822
 class Projection added
 class Form,Config,App,Workspace,Transcript changed
```

## Sequence
```mermaid
sequenceDiagram
 participant E as Engineer
 participant F as Workbench form
 participant H as Existing config host
 participant T as Transcript
 E->>F: choose detail and Save
 F->>H: update chat.detail
 H-->>F: confirmed workbench snapshot
 F-->>T: confirmed detail through App/Workspace
 T-->>E: present same history at chosen detail
```

## State
Not drawn: no execution lifecycle or new state transitions; existing settings draft/save behavior is reused.

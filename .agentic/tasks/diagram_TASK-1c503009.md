# TASK-1c503009 diagrams

Illustrates `## Design` in `TASK-1c503009.md`. The Design text is authoritative.

## Structure

Map: Settings, WorkbenchConfigForm, WorkbenchEditor and usePreferences changed; PrivacySettings, WorkbenchPrivacy and PrivacyControls added; API/shared defaults reused unchanged.

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 s["Settings"]:::changed ==> p["PrivacySettings"]:::added
 w["WorkbenchConfigForm"]:::changed ==> wp["WorkbenchPrivacy"]:::added
 p ==> c["PrivacyControls"]:::added
 wp ==> c
 wp ==> q["usePreferences settings query"]:::changed
 q --> api["typed API"]
 e["WorkbenchEditor"]:::changed ==> api
 c ==> d["shared maskingDefaults"]
```

## Sequence

```mermaid
sequenceDiagram
 actor User
 participant Controls as PrivacyControls
 participant Draft as Owning draft
 participant API as Typed API
 User->>Controls: select agent off
 Controls->>User: provider disclosure warning
 User->>Controls: Confirm
 Controls->>Draft: change draft only
 User->>Draft: Save
 Draft->>API: strict partial privacy patch
 API-->>Draft: confirmed snapshot
```

## State

```mermaid
stateDiagram-v2
 [*] --> Clean
 Clean --> Warning: agent disabling selection
 Warning --> Clean: Cancel or Escape
 Warning --> Dirty: Confirm draft
 Clean --> Dirty: other area change
 Dirty --> Clean: Cancel
 Dirty --> Saving: Save
 Saving --> Dirty: failure
 Saving --> Clean: confirmed snapshot
```

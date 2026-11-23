# TASK-2077e196 diagrams

Illustrates `## Design` in `TASK-2077e196.md`. The Design text is authoritative.

## Structure

Added: NotificationSettings. Changed: Settings, shared settings contract. Reused: useSettingsDraft, SettingsService.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    panel["Settings"]:::changed ==> prefs["NotificationSettings"]:::added
    prefs ==> draft["useSettingsDraft"]
    prefs ==>|app.settings.update| service["SettingsService"]
    service --> contract["settingsSchema and mergeSettings"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    actor User as Desktop user
    participant Panel as NotificationSettings
    participant Service as SettingsService
    User->>Panel: Edit a preference
    User->>Panel: Select Save
    Panel->>Service: app.settings.update with edited fields
    alt Save succeeds
        Service-->>Panel: Confirmed settings snapshot
        Panel-->>User: Clear confirmed edits
    else Save fails
        Service-->>Panel: Settings error
        Panel-->>User: Show error and retain edits
    end
```

## State

No lifecycle or status is added. The page uses the shared settings draft lifecycle.

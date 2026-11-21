# TASK-046849f5 diagrams

Illustrates `## Design` in `TASK-046849f5.md`. The Design text is authoritative.

Node classes: added = SettingsPageHeader, AppearanceSettings, appearance preview store; changed = Settings, App guard, UpdatesPanel, CommandSettings, PrivacySettings, AdvancedSettingsPanel, AdvancedField, SessionAdvancedDialog, usePreferences.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    app["App (leaveDrafts, selectSection)"]:::changed --> settings["Settings (save, dirtyChanged)"]:::changed
    settings --> header["SettingsPageHeader"]:::added
    settings --> appearance["AppearanceSettings"]:::added
    settings --> pages["Updates / Shortcuts / Commands / Data / Advanced pages"]:::changed
    appearance --> preview["appearance preview store"]:::added
    preview --> prefs["usePreferences effects"]:::changed
    pages --> header
    appearance --> header
    settings --> mutation["app.settings.update (mutateAsync)"]
    dialog["SessionAdvancedDialog (draft, Cancel/Save)"]:::changed --> ipc["session.advanced.set"]
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant P as Settings page
    participant A as App guard
    participant M as settings mutation
    U->>P: change a value
    P->>A: dirty = true
    U->>A: Back to workbenches
    A->>U: Discard changes?
    U-->>A: Stay
    U->>P: Save
    P->>M: mutateAsync(draft)
    M-->>P: saved snapshot
    P->>A: dirty = false
```

## State

```mermaid
stateDiagram-v2
    [*] --> Clean
    Clean --> Dirty: change a value
    Dirty --> Clean: Cancel
    Dirty --> Saving: Save
    Saving --> Clean: saved
    Saving --> Dirty: save failed (error shown)
    Dirty --> Dirty: leave, Stay
    Dirty --> [*]: leave, Discard
```

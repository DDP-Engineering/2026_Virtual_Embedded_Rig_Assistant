# TASK-211bfde8 diagrams

Illustrates the design in `TASK-211bfde8.md`.

## Structure

Added: Permissions panel. Changed: settings schema and SessionService. Reused: SettingsService.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    panel["Permissions panel"]:::added ==> service["SettingsService"]
    service --> schema["settingsSchema"]:::changed
    runtime["SessionService"]:::changed ==> service
```

## Sequence

```mermaid
sequenceDiagram
    participant P as Permissions panel
    participant S as SettingsService
    participant C as SessionService
    P->>S: Save confirmed enable through Desktop IPC
    C->>S: Read policy at delegated launch
    C->>S: Recheck after model preparation
```

## State

```mermaid
stateDiagram-v2
    [*] --> Off
    Off --> Confirming: Enable
    Confirming --> Off: Cancel
    Confirming --> On: Confirm and save
    On --> Off: Disable and save
```

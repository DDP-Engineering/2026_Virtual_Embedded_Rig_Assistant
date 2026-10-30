# TASK-8f446150 diagrams

Illustrates Design in TASK-8f446150.md; the Design text is authoritative.

## Structure

Node map: PermissionPicker added; settings/shared mode, SessionService, ApprovalGate, PathGuard and grep worker changed; existing file tools changed to receive host-selected scope.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  picker["PermissionPicker"]:::added ==> prefs["settings suppression preference"]:::changed
  picker ==> service["SessionService live mode and scope signal"]:::changed
  service --> gate["ApprovalGate exact automatic grants"]:::changed
  service ==> tools["file tools"]:::changed
  tools --> guard["PathGuard explicit filesystem scope"]:::changed
  tools ==> worker["grep worker host-selected scope"]:::changed
  worker --> guard
```

## Sequence

```mermaid
sequenceDiagram
  participant User
  participant Picker as PermissionPicker
  participant Session as SessionService
  participant Tools as File tools
  participant FS as Operating system
  User->>Picker: Select marked Bypass
  Picker->>Session: Persist bypass mode
  Picker->>User: Show dismissible risk notice
  Session->>Tools: Live mode and revocable filesystem scope
  Tools->>FS: Ordinary file I/O inside or outside workbench
  User->>Picker: Select another mode
  Picker->>Session: Persist mode and revoke scope signal
  Session->>Tools: Abort scoped work; later paths confined
```

## State

```mermaid
stateDiagram-v2
  [*] --> Confined
  Confined --> Bypass: Explicit selection
  Bypass --> Confined: Mode changed, scope revoked
  state Notice {
    [*] --> Visible
    Visible --> Dismissed: Close, X or Escape
    Visible --> Suppressed: Close with remember checked and save succeeds
    Visible --> Visible: Preference save fails
  }
```

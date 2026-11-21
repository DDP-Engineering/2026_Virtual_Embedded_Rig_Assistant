# TASK-07b74bbb diagrams

Illustrates `## Design` in `TASK-07b74bbb.md`. The Design text is authoritative.

Node classes from the Design: added = renderer `app-advanced` store, `choice` setting kind; changed =
advanced registry, TerminalService, terminal_read publish, Updates, CatalogChecks, logger, desktop main
wiring, usePreferences, terminal tab, transcript, pager (usePaged), AdvancedField; unchanged =
resolveAdvanced, settings service.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    reg["advanced registry (10 keys)"]:::changed
    choice["choice kind (10/20/50)"]:::added
    settings[("settings.json advanced")]
    resolve["resolveAdvanced"]
    main["desktop main: appAdvanced getters"]:::changed
    term["TerminalService (count, buffer, agent tail)"]:::changed
    tread["terminal_read publish (tool result cap)"]:::changed
    upd["Updates (interval)"]:::changed
    cat["CatalogChecks (interval)"]:::changed
    log["logger (retention)"]:::changed
    prefs["usePreferences"]:::changed
    store["app-advanced store"]:::added
    tab["terminal tab (scrollback, New)"]:::changed
    tr["transcript (rows)"]:::changed
    pager["usePaged (page size)"]:::changed
    field["AdvancedField (choice select)"]:::changed
    reg --> choice
    reg --> resolve
    settings --> resolve
    resolve --> main
    main --> term
    main --> upd
    main --> cat
    main --> log
    term --> tread
    settings --> prefs
    prefs --> store
    resolve --> store
    store --> tab
    store --> tr
    store --> pager
    reg --> field
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant R as Renderer (Settings > Advanced)
    participant M as Desktop main
    participant S as SettingsService
    participant P as Updates / CatalogChecks
    participant St as app-advanced store
    U->>R: set Update check interval 1 h, Save
    R->>M: settings.update {advanced: {updateInterval: 1}}
    M->>S: save
    S-->>M: changed()
    M->>P: settingsChanged()
    P->>P: interval differs: restart timer, no check
    M-->>R: settings.changed event
    R->>St: setAppAdvanced(snapshot.advanced)
    St-->>R: lists, transcript and terminal tab read resolved values
```

## State

```mermaid
stateDiagram-v2
    [*] --> Idle: start (mode not off)
    Idle --> Checking: timer fires every interval
    Checking --> Idle: check settles
    Idle --> Idle: interval changed (timer restarted, no check)
    Idle --> Off: mode set to off (timer cleared)
    Off --> Checking: mode set on (immediate check, timer started)
```

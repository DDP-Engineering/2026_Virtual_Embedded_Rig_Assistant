# TASK-4b3878c7 diagrams

Illustrates Design in TASK-4b3878c7.md.

## Structure
Changed: sidebar coordinator, App/create IPC, SessionService reuse, composer focus. SQLite store reused.
```mermaid
flowchart LR
 classDef changed fill:#faeeda,stroke:#854f0b
 sidebar[Sidebar menu coordinator]:::changed --> menus[Native session and workbench action menus]
 app[App New session guard]:::changed --> ipc[Create IPC with reuseEmpty]:::changed
 ipc --> service[SessionService atomic selection or creation]:::changed
 service --> db[(Existing SQLite rows)]
 app --> composer[One-shot composer focus]:::changed
```

## Sequence
```mermaid
sequenceDiagram
 participant U as User
 participant A as App
 participant M as Main
 participant C as SessionService
 U->>A: New session or shortcut
 A->>A: Immediate in-flight guard
 A->>M: session.create reuseEmpty=true
 M->>C: Validated workbench ownership
 C->>C: Transaction finds unused eligible row or inserts once
 C-->>A: Existing or created session summary
 A->>A: Select, deduplicate cache and focus composer
```

## State
```mermaid
stateDiagram-v2
 [*] --> NoMenu
 NoMenu --> MenuA: Open A
 MenuA --> MenuB: Open B and close A
 MenuB --> NoMenu: Outside interaction or Escape
```

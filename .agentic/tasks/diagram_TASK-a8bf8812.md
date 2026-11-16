# TASK-a8bf8812 diagrams

Illustrates Design in TASK-a8bf8812.md. Design is authoritative.

## Structure

Map: toolPathGuard, PathGuard, grep-worker, confined input helpers, program guards and PermissionPicker changed; host composition and mode owner reused.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  host["Desktop / CLI managedRoots"] --> context["toolPathGuard"]:::changed
  context ==> guard["PathGuard exclusions"]:::changed
  context ==> worker["grep-worker exclusions"]:::changed
  context ==> inputs["Confined candidate/electrical/HIL input guards"]:::changed
  context ==> programs["Program request/runner exclusions"]:::changed
  inputs ==> guard
  programs ==> guard
  picker["PermissionPicker confirmation"]:::changed --> owner["Parent mode owner"]
```

## Sequence

```mermaid
sequenceDiagram
  participant User
  participant PermissionPicker
  participant Parent
  User->>PermissionPicker: choose Bypass
  PermissionPicker->>PermissionPicker: load rules and open confirmation
  User->>PermissionPicker: confirm
  PermissionPicker->>Parent: change Bypass
  Parent-->>PermissionPicker: saved mode
```

## State

```mermaid
stateDiagram-v2
  PriorMode --> Confirmation: choose Bypass
  Confirmation --> PriorMode: cancel / Escape
  Confirmation --> Saving: confirm
  Saving --> Confirmation: save failure
  Saving --> Bypass: save success
  Bypass --> PriorMode: choose another mode
```

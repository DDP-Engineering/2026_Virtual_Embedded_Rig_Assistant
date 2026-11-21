# TASK-fc2d54a9 diagrams

Illustrates the Design section in TASK-fc2d54a9.md.

## Structure

BrowserHost and Chromium launch change. BrowserAccessPolicy and the scoped proxy are added. Public address validation is reused.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  main["Desktop main"]:::changed ==> policy["BrowserAccessPolicy"]:::added
  host["BrowserHost"]:::changed ==> policy
  host --> chromium["Chromium launch"]:::changed
  policy ==> proxy["Session proxy"]:::added
  chromium ==> proxy
  proxy ==> checks["Public address validation"]
  proxy ==> network["Pinned HTTP(S) request"]
```

## Sequence

```mermaid
sequenceDiagram
  participant Main as Desktop main
  participant Policy as BrowserAccessPolicy
  participant Chrome as Chromium
  participant Proxy as Session proxy
  participant Web as Public origin
  Main->>Policy: Record exact origin grant
  Chrome->>Proxy: Request resource
  Proxy->>Policy: Check active owner and exact origin
  Proxy->>Web: Connect to vetted address
  Web-->>Chrome: Relay bounded response
  Main->>Policy: Disable browser access
  Policy->>Proxy: Abort owned requests
```

## State

```mermaid
stateDiagram-v2
  [*] --> Disabled
  Disabled --> AwaitingGrant: Global and workbench enable
  AwaitingGrant --> Authorized: Trusted user grant
  Authorized --> Active: Acquire lease
  Active --> AwaitingGrant: Session ends or grant revoked
  Active --> Disabled: Either gate disabled
  Authorized --> Disabled: Either gate disabled
```

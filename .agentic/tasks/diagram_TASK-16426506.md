# TASK-16426506 diagrams

Illustrates [Design](TASK-16426506.md#design).

## Structure

Class map: Desktop main and packager changed. BrowserHost, BrowserRuntime, BrowserNetworkPolicy, and the fixture added. Playwright and Chromium are reused upstream components.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    main["Desktop main"]:::changed ==> host["BrowserHost"]:::added
    main ==> fixture["Controlled fixture"]:::added
    fixture ==> host
    host ==> policy["BrowserNetworkPolicy"]:::added
    host ==> runtime["BrowserRuntime"]:::added
    host ==> playwright["Playwright"]
    playwright --> chrome["Chromium"]
    packager["Packager"]:::changed ==> playwright
```

## Sequence

```mermaid
sequenceDiagram
    participant F as Controlled fixture
    participant H as BrowserHost
    participant P as BrowserNetworkPolicy
    participant R as BrowserRuntime
    participant C as Chromium
    F->>R: Explicitly provision the pinned archive
    F->>H: Open owned session
    H->>P: Acquire network policy
    H->>R: Verify installed runtime
    H->>C: Launch with sandbox and create context
    H->>P: Attach policy to context
    H-->>F: Return the session
    F->>H: Close session
    H->>C: Close browser and temporary state
```

## State

```mermaid
stateDiagram-v2
    [*] --> Starting: Session open
    Starting --> Open: Context and policy ready
    Starting --> Closing: Failure or cancellation
    Open --> Closing: Close, timeout, or disconnect
    Closing --> [*]: Browser and policy drained
```

# TASK-48e18516 diagrams

Illustrates the design in [TASK-48e18516.md](TASK-48e18516.md).

## Structure

Changed nodes are the preset registry, Settings editor and gateway. The
credential store, pinned adapters and external services retain their interfaces.

```mermaid
flowchart LR
    classDef changed fill:#faeeda,stroke:#854f0b
    editor["Settings editor"]:::changed --> registry["Preset registry"]:::changed
    gateway["VERA gateway"]:::changed --> registry
    gateway --> credentials["Scoped credential store"]
    gateway --> messages["Messages adapter"]
    gateway --> completions["Chat Completions adapter"]
    messages --> minimax["MiniMax international"]
    completions --> zai["Z.AI international"]
```

## Sequence

```mermaid
sequenceDiagram
    participant Runtime
    participant Gateway
    participant Slot as Credential store
    participant Service as Selected service endpoint
    Runtime->>Gateway: Start streamed turn
    Gateway->>Slot: Read bound connection key
    Gateway->>Service: Request with registered route and protocol
    Service-->>Gateway: Stream thinking and tool call
    Gateway-->>Runtime: Return assistant message
    Runtime->>Gateway: Continue with assistant message and tool result
    Gateway->>Service: Replay thinking, call and result on same route
    Service-->>Runtime: Stream final answer through gateway
```

## State

No lifecycle or persisted state transition changes.

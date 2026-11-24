# TASK-40109a62 diagrams

Illustrates the Design in `TASK-40109a62.md`.

## Structure

Changed: `pluginCredentialsFromEnvironment`, `MemoryCredentials.modify`. Reused: `ConsoleLogger.registerSecret`, `cliProgramCredentials`.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    env["pluginCredentialsFromEnvironment"]:::changed -->|login| store["MemoryCredentials.modify"]:::changed
    env -->|password| logger["ConsoleLogger.registerSecret"]
    store -->|password| logger
    store -.->|username registration| logger
    env -.->|username registration| logger
    store -->|stored login| port["cliProgramCredentials"]
```

## Sequence

```mermaid
sequenceDiagram
    participant Env as pluginCredentialsFromEnvironment
    participant Store as MemoryCredentials.modify
    participant Logger as ConsoleLogger.registerSecret
    Env->>Logger: Register password before validation
    Env->>Store: Save password and optional username
    Store->>Logger: Register password
    Store-->>Env: Stored login
```

## State

Not drawn: credential lifetime and state transitions are unchanged.

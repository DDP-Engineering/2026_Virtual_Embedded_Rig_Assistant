# TASK-4912fc24 diagrams

Illustrates `## Design` in `TASK-4912fc24.md`. The Design text is authoritative.

## Structure

Node map: SessionService, providers, ArtifactStore, TerminalService and CLI run are changed;
sessions/masking and CLI session-output are added; CLI replay-output is removed;
createMaskingResolver and credentials.scrub are reused unchanged.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    resolver["createMaskingResolver"] ==> session["SessionService"]:::changed
    session ==> masking["sessions/masking"]:::added
    masking --> scrub["credentials.scrub"]
    session --> artifacts["ArtifactStore"]:::changed
    session --> providers["providers.stream"]:::changed
    resolver ==> terminals["TerminalService"]:::changed
    cli["CLI run"]:::changed ==> output["CLI session-output"]:::added
    cli -.-> replay["CLI replay-output"]:::removed
```

## Sequence

```mermaid
sequenceDiagram
    participant Runtime as ReferenceRuntime
    participant Policy as MaskingContextPolicy
    participant Session as SessionService
    participant Provider as LlmGateway
    Runtime->>Policy: project and count normal or summary view
    Policy-->>Runtime: bounded detached messages
    Runtime->>Session: stream request
    Session->>Session: await durable publication
    Session->>Policy: recheck current projected budget
    alt projected content fits
        Session->>Provider: dispatch counted view
        Provider-->>Session: output or protected error
        Session-->>Runtime: live agent projection
    else projected content exceeds budget
        Session-->>Runtime: CONTEXT_LIMIT without dispatch
    end
```

## State

Not drawn: this task consumes the existing masking choices and preserves existing execution,
consent, session and storage state transitions.

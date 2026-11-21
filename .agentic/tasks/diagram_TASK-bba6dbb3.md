# TASK-bba6dbb3 diagrams

Illustrates the design in TASK-bba6dbb3.md.

## Structure

Added components are DictationButton, useComposerDictation and draft insertion. Settings, Composer and the shared shortcut registry gain responsibilities. DictationCapture and the typed bridge are reused.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    settings["Settings"]:::changed ==> shortcuts["shortcutCommands"]:::changed
    composer["Composer"]:::changed ==> button["DictationButton"]:::added
    composer ==> hook["useComposerDictation"]:::added
    hook ==> capture["DictationCapture"]
    hook ==> shortcuts
    composer ==> draft["draft insertion"]:::added
    capture --> bridge["VeraBridge"]
```

## Sequence

```mermaid
sequenceDiagram
    participant user as User
    participant composer as Composer
    participant hook as useComposerDictation
    participant capture as DictationCapture
    user->>composer: Start the configured gesture
    composer->>hook: Capture draft revision and selection end
    hook->>capture: Start for the live session
    user->>hook: End the configured gesture
    hook->>capture: Stop and transcribe
    capture-->>hook: Return transcript and session
    hook-->>composer: Deliver matching attempt
    composer-->>user: Present editable draft
```

## State

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Opening: Begin gesture
    Opening --> Recording: Microphone ready
    Recording --> Transcribing: End gesture
    Transcribing --> Idle: Insert result in live draft
    Opening --> Idle: Cancel or error
    Recording --> Idle: Cancel or error
    Transcribing --> Idle: Cancel or error
```

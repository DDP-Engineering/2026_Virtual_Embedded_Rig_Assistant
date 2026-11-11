# TASK-d0a44d9c diagrams

Illustrates `## Design` in `TASK-d0a44d9c.md`. The Design text is authoritative.

Node map: added = transcript-navigation helper, TranscriptNavigator, navigation spec; changed = Transcript (registry,
navigate, suspension), styles, locales, mock sessions; unchanged = TranscriptScroll rail, transcriptRows.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    tr["Transcript<br/>anchor registry, navigate, auto-follow"]:::changed
    rows["transcriptRows"]
    rail["TranscriptScroll rail"]
    nav["TranscriptNavigator<br/>lane, preview, selector"]:::added
    geo["transcript-navigation<br/>pure geometry"]:::added
    css["styles.css / locales"]:::changed
    mock["mocks/sessions slow stream"]:::changed
    e2e["session-navigation.spec"]:::added
    tr --> rows
    tr --> rail
    tr --> nav
    nav --> geo
    nav --> css
    e2e --> mock
    e2e --> nav
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant N as TranscriptNavigator
    participant T as Transcript
    participant V as Viewport
    U->>N: Enter on marker 7
    N->>T: navigate(id)
    T->>T: following=false, suspended=true
    T->>V: scrollTop = clamp(y-16)
    T-->>N: highlight id, status text
    V-->>N: scroll → current index from memorized ys
    Note over T,V: streaming deltas do not scroll while suspended
    U->>V: scroll to end
    V-->>T: near end away from jump → follow again
```

## State

```mermaid
stateDiagram-v2
    [*] --> Following
    Following --> Reading: user scrolls up
    Reading --> Following: user returns to end
    Following --> Suspended: marker jump
    Reading --> Suspended: marker jump
    Suspended --> Following: user returns to end (not the jump itself)
    Suspended --> Suspended: streaming, new jump
```

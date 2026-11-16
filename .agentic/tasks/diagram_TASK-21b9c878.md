# TASK-21b9c878 diagrams

Illustrates Design in TASK-21b9c878.md. Design is authoritative.

## Structure
Node map: registry, navigator and Transcript changed; hook added; Settings editor reused unchanged except label map.

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 registry["keyboard-shortcuts"]:::changed ==> hook["useBookmarkNavigation"]:::added
 hook ==> navigator["TranscriptNavigator"]:::changed
 navigator --> transcript["Transcript.navigate"]:::changed
 registry --> editor["KeyboardShortcuts"]:::changed
```

## Sequence
```mermaid
sequenceDiagram
 participant Reader
 participant Hook as useBookmarkNavigation
 participant Navigator as TranscriptNavigator
 participant Transcript
 Reader->>Hook: next / previous key
 Hook->>Navigator: select bookmarked message
 Navigator->>Transcript: navigate(id)
 alt anchor not mounted
 Transcript->>Transcript: mount remaining rows
 Hook->>Navigator: retry after measurement
 Navigator->>Transcript: navigate(id)
 end
 Navigator->>Reader: focus marker and announce
```

## State
Not drawn: no product lifecycle or persisted state changes.

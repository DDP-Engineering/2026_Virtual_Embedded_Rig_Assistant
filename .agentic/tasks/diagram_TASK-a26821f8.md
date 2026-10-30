# TASK-a26821f8 diagrams

Illustrates Design in TASK-a26821f8.md. The Design text is authoritative.

## Structure

Node map: styles.css changed; Transcript changed; TranscriptScroll added; Composer reused unchanged.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  style["styles.css viewport containment"]:::changed ==> transcript["Transcript bounded frame"]:::changed
  transcript ==> rail["TranscriptScroll"]:::added
  style --> composer["Composer"]
```

## Sequence

Not drawn: scrolling stays within one renderer component boundary.

## State

Not drawn: native scrolling and existing follow state remain unchanged.

# TASK-9a5b9ff2 diagrams

Illustrates Design in TASK-9a5b9ff2.md; Design is authoritative.

## Structure

Node map: provider/text viewer changed; reader/decoder/row hook added; host reused unchanged.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  provider[Tab provider]:::changed --> reader[Small text reader]:::added
  reader --> host[Existing masked byte host]
  provider --> text[Text viewer]:::changed
  text --> decoder[TextDecoder helper]:::added
  text --> rows[Measured virtual rows]:::added
```

## Sequence

```mermaid
sequenceDiagram
  participant User
  participant Tabs
  participant Reader
  participant Host
  User->>Tabs: Open ordinary text file
  Tabs->>Reader: Load owner and identity
  Reader->>Host: docs.stat
  Host-->>Reader: Physical size
  loop Small file windows, at most 1MiB
    Reader->>Host: docs.readBytes
    Host-->>Reader: Masked physical bytes
  end
  Reader-->>Tabs: Consistent bounded bytes
  Tabs-->>User: Detected text, encoding and wrap controls
```

## State

```mermaid
stateDiagram-v2
  [*] --> StrictDecode
  StrictDecode --> Text: Valid selected encoding
  StrictDecode --> Invalid: Invalid bytes or NUL
  Invalid --> Text: Show as text with replacement decoding
  Text --> StrictDecode: Change encoding
  Invalid --> StrictDecode: Change encoding
  Text --> [*]: Close or Display refresh
  Invalid --> [*]: Close or Display refresh
```

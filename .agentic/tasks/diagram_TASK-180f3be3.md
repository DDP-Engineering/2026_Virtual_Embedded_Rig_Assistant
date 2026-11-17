# TASK-180f3be3 diagrams

Illustrates Design in TASK-180f3be3.md. Design text is authoritative.

## Structure

Node map: file-mode and viewer-context changed; image-source and ImageViewer added; HexSource and docs.readBytes reused unchanged.

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 modes["file-mode"]:::changed ==> context["viewer-context"]:::changed
 context ==> image["ImageViewer"]:::added
 image ==> source["image-source"]:::added
 source ==> hex["HexSource"]
 hex --> host["docs.readBytes"]
```

## Sequence

```mermaid
sequenceDiagram
 participant Tab as viewer-context
 participant Image as ImageViewer
 participant Source as image-source
 participant Host as docs.readBytes
 Tab->>Image: transient ImageFile
 Image->>Source: assemble(signal)
 loop bounded windows
 Source->>Host: offset and length
 Host-->>Source: masked bytes
 end
 Source-->>Image: verified Blob
 Image->>Image: create URL and decode img
 Tab->>Image: unmount or replacement
 Image->>Image: abort and revoke URL
```

## State

```mermaid
stateDiagram-v2
 [*] --> Loading
 Loading --> Preview: verified Blob decoded
 Loading --> Error: read or decode failure
 Error --> Loading: Retry remount
 Preview --> Preview: fit or percent zoom
 Loading --> Disposed: owner or content change
 Preview --> Disposed: owner or content change
 Error --> Disposed: unmount
 Disposed --> [*]: abort and revoke
```

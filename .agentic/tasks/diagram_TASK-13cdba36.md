# TASK-13cdba36 diagrams

Illustrates the Design section of [TASK-13cdba36.md](TASK-13cdba36.md).

## Structure

Added: TranscriptImages and docs.imageThumbnail. Changed: renderer event/snapshot projection, DisplayDocuments and DocumentViewerProvider. Reused: WorkbenchService.readBytes, ImageViewer and the raster thumbnail transform.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    projection["Renderer event and snapshot projection"]:::changed ==> row["TranscriptImages"]:::added
    row ==> thumbnail["docs.imageThumbnail"]:::added ==> display["DisplayDocuments"]:::changed
    display ==> bytes["WorkbenchService.readBytes"]
    display ==> raster["Raster thumbnail transform"]
    row ==> tabs["DocumentViewerProvider"]:::changed --> viewer["ImageViewer"]
```

## Sequence

```mermaid
sequenceDiagram
    participant Row as TranscriptImages
    participant Display as DisplayDocuments
    participant Workbench as WorkbenchService
    participant Viewer as DocumentViewerProvider
    Row->>Display: Request thumbnail by scoped path
    Display->>Workbench: Read bounded byte windows
    Workbench-->>Display: File bytes or typed error
    Display-->>Row: Public path and optional PNG
    opt Activate available thumbnail
        Row->>Viewer: Open the path in Rendered mode
    end
```

## State

```mermaid
stateDiagram-v2
    [*] --> Waiting
    Waiting --> Loading : Near viewport
    Loading --> Thumbnail : Supported image available
    Loading --> Path : Preview unavailable
    Thumbnail --> Loading : Refresh
    Path --> Loading : Refresh
```

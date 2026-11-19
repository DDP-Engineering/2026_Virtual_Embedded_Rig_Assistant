# TASK-9091aa22 diagrams

Illustrates the Design in TASK-9091aa22.md.

## Structure

Added: viewImageTool, readRasterFile. Changed: WorkbenchTools, ProviderGateway, ReferenceRuntime, ToolRegistry, PathGuard. Reused: provider model.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    editor["WorkbenchTools"]:::changed ==> gateway["ProviderGateway"]:::changed
    gateway --> provider["Provider model"]
    runtime["ReferenceRuntime"]:::changed --> registry["ToolRegistry"]:::changed
    registry ==> view["viewImageTool"]:::added
    view ==> raster["readRasterFile"]:::added
    raster ==> guard["PathGuard"]:::changed
    runtime --> provider
```

## Sequence

```mermaid
sequenceDiagram
    participant Model as Provider model
    participant Runtime as ReferenceRuntime
    participant Tool as viewImageTool
    participant Guard as PathGuard
    Model->>Runtime: Call view_image with a path
    Runtime->>Tool: Execute enabled read tool
    Tool->>Guard: Resolve and check the workbench path
    Guard-->>Tool: Guarded file
    Tool-->>Runtime: Path text and bounded raster part
    Runtime->>Model: Tool result with image in current turn
```

## State

Not drawn: The design uses the existing turn lifecycle.

# TASK-ca6e05a5 diagrams

Illustrates `## Design` in `TASK-ca6e05a5.md`. The Design text is authoritative.

Node classes (from the Design):

| Node | Class |
|---|---|
| knowledge/office.ts (archive guard + extractors) | added |
| createOfficeExtractor | added |
| shared documents.ts schemas, extraction.ts, pdf-worker.ts, processor.ts, ingest.ts documentKind, chunk.ts, search.ts, viewer.ts, documents-scan.ts, workbench/service.ts ref bounds | changed |
| main document-viewer.ts, renderer viewer-context.tsx | changed |
| extractHtml, mammoth, fflate, @xmldom/xmldom | unchanged (reused / dependency) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    ingest["ingest.ts documentKind"]:::changed
    processor["processor.ts"]:::changed
    host["createOfficeExtractor"]:::added
    worker["pdf-worker.ts"]:::changed
    office["office.ts guard + extractors"]:::added
    html["extractHtml"]
    mammoth["mammoth"]
    fflate["fflate"]
    xmldom["@xmldom/xmldom"]
    chunk["chunk.ts"]:::changed
    viewer["viewer.ts / search.ts read_doc"]:::changed
    main["main document-viewer.ts"]:::changed
    ui["renderer viewer-context.tsx"]:::changed
    ingest ==> processor
    processor ==> host
    host ==> worker
    worker ==> office
    office ==> fflate
    office ==> mammoth
    office ==> xmldom
    office ==> html
    processor --> chunk
    viewer --> main
    main --> ui
```

## Sequence

```mermaid
sequenceDiagram
    participant Ingest as Ingester
    participant Proc as DocumentProcessor
    participant Host as createOfficeExtractor
    participant Worker as pdf-worker thread
    participant Office as office.ts
    Ingest->>Proc: process {path, kind: presentation}
    Proc->>Host: extract(bytes, format pptx)
    Host->>Worker: postMessage {format, bytes}
    Worker->>Office: guardArchive(bytes)
    alt over limits
        Office-->>Worker: SIZE_LIMIT
    else within limits
        Office->>Office: read slide order, a:t per slide
        Office-->>Worker: {kind: presentation, slides}
    end
    Worker-->>Host: extraction or error code
    Host-->>Proc: extraction, or rejection mapped to SIZE_LIMIT / PROCESSING
    Proc->>Proc: chunk per slide with page locators, embed
```

## State

Not drawn: document statuses (pending, indexed, failed) are unchanged; this task only adds failure reasons on existing transitions.

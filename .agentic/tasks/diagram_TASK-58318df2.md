# TASK-58318df2 diagrams

Illustrates `## Design` in `TASK-58318df2.md`. The Design text is authoritative.

Node classes (from the Design):

| Node | Class |
|---|---|
| shared refs.ts (grammar, label) | changed |
| search.ts documentRef, read (parts), validDocumentRef | changed |
| viewer.ts open anchor | changed |
| renderer viewer-context.tsx anchor effect | changed |
| tools/documents.ts read_doc description | changed |
| WorkbenchService.searchDocuments, currentBounds, chunk locators, SessionService citations | unchanged (reused) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    refs["shared refs.ts parseRef/formatRef/label"]:::changed
    search["search.ts documentRef / read parts"]:::changed
    valid["search.ts validDocumentRef"]:::changed
    tool["tools/documents.ts read_doc"]:::changed
    viewer["viewer.ts open"]:::changed
    ui["renderer viewer-context.tsx"]:::changed
    docs["WorkbenchService.searchDocuments"]
    bounds["DocumentViewer.currentBounds"]
    cites["SessionService citations"]
    chunks[("chunks locator: slug '' / Markdown lines")]
    tool ==> search
    search ==> chunks
    search ==> refs
    cites ==> valid
    valid ==> refs
    docs ==> refs
    docs ==> bounds
    viewer ==> refs
    ui ==> viewer
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent
    participant Search as DocumentKnowledge
    participant Refs as shared refs
    participant Cite as citation checker
    participant UI as viewer
    Agent->>Search: search_docs "phrase"
    Search->>Refs: formatRef heading slug ""
    Refs-->>Agent: docs/notes.docx#h=
    Agent->>Search: read_doc {heading: "", part: 2}
    Search-->>Agent: {text, part: 2, parts: 3, truncated: true, ref: docs/notes.docx#h=}
    Agent->>Cite: answer with [[docs/notes.docx#h=]]
    Cite->>Search: validDocumentRef (issued, leading section exists)
    Search-->>Cite: valid
    UI->>Refs: open chip, anchor ""
    UI-->>UI: focus data-heading=""
```

## State

Not drawn: no lifecycle or status changes; part reads are stateless requests.

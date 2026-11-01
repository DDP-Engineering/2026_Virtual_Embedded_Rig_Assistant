# TASK-3e78d66b diagrams

Illustrates `## Design` in `TASK-3e78d66b.md`. The Design text is authoritative.

Node classes (from the Design):

| Node | Class |
|---|---|
| workbenchRetrievalSchema | added |
| workbenchSchema / workbenchPatchSchema / mergeWorkbench / configWarnings | changed |
| searchDocsSchema, DocumentKnowledge.search, search_docs tool | changed |
| SessionService (SessionHost.retrieval) | changed |
| desktop main/sessions.ts, cli run.ts | changed |
| WorkbenchConfigForm Indexing section, WorkbenchCreate, WorkbenchEditor | changed |
| KeywordSearch, EmbeddingPort | unchanged |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    form["WorkbenchConfigForm Indexing"]:::changed
    create["WorkbenchCreate"]:::changed
    editor["WorkbenchEditor"]:::changed
    schema["workbenchSchema / workbenchPatchSchema"]:::changed
    retrieval["workbenchRetrievalSchema"]:::added
    desktop["main/sessions.ts"]:::changed
    cli["cli run.ts"]:::changed
    session["SessionService"]:::changed
    tool["search_docs tool"]:::changed
    knowledge["DocumentKnowledge.search"]:::changed
    keyword["KeywordSearch"]
    embed["EmbeddingPort"]
    form ==> retrieval
    create ==> schema
    editor ==> schema
    schema ==> retrieval
    desktop ==> session
    cli ==> session
    session ==> knowledge
    tool --> knowledge
    knowledge --> keyword
    knowledge --> embed
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent as model turn
    participant Tool as search_docs
    participant Knowledge as DocumentKnowledge
    participant Host as SessionHost.retrieval
    Agent->>Tool: search_docs {query}
    Tool->>Knowledge: search(args)
    Knowledge->>Host: defaults()
    Host-->>Knowledge: {results, mode} from workbench.yaml
    Knowledge->>Knowledge: k = args.k ?? results, mode = args.mode ?? mode
    Knowledge-->>Agent: up to k results in that mode
```

## State

Not drawn: the Design adds configuration values, not a lifecycle or status field.

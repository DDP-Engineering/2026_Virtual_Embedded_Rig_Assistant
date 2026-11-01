# TASK-2fef1397 diagrams

Illustrates `## Design` in `TASK-2fef1397.md`. The Design text is authoritative.

| Node | Class |
|---|---|
| lib/attachments.ts, AttachmentsContext | added |
| App (state, attach), Composer (chips, mentions), DocsTree / TreeMenu (item, disabled), prompt.ts rule | changed |
| session.send, session.create, workbench tools | unchanged (reused) |

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    tree["DocsTree menu: Attach as context"]:::changed
    ctx["AttachmentsContext (App state per session)"]:::added
    rules["lib/attachments.ts"]:::added
    composer["Composer chips + withMentions"]:::changed
    send["session.send {text}"]
    prompt["core prompt rule @path"]:::changed
    tree --> ctx
    ctx --> composer --> rules
    composer --> send --> prompt
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant T as Docs tree
    participant A as App
    participant C as Composer
    participant M as main/agent
    U->>T: Attach as context on docs/a.pdf
    T->>A: attach("docs/a.pdf")
    A->>A: active session? else session.create (reuseEmpty)
    A->>C: chat shown, chip a.pdf
    U->>C: "Summarize this", Send
    C->>M: session.send "Summarize this\n@docs/a.pdf"
    M-->>C: accepted, chips cleared
```

## State

Not drawn: per session, attachments are a list that grows by Attach (to 20), shrinks by remove
and empties on an accepted send.

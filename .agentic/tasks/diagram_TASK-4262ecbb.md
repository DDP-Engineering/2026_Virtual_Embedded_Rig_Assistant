# TASK-4262ecbb diagrams

Illustrates Design in TASK-4262ecbb.md; Design is authoritative.

## Structure

Map: WebProvider, ExaWebProvider, web tools and ExternalSourceLink added; composition, catalog, prompt and Markdown changed; runtime/activity reused.

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 host["Desktop / CLI composition"]:::changed ==> provider["ExaWebProvider"]:::added
 runtime["Agent runtime / activity"] ==> tools["web_search / web_read"]:::added
 tools ==> port["WebProvider"]:::added
 port ==> provider
 provider ==> exa["Exa MCP"]
 markdown["Markdown"]:::changed ==> link["ExternalSourceLink"]:::added
 link ==> ipc["confirmed app.openExternal"]
```

## Sequence

```mermaid
sequenceDiagram
 participant Agent
 participant Tool as Web tool
 participant Adapter as ExaWebProvider
 participant Exa as Exa MCP
 Agent->>Tool: query or URL
 Tool->>Adapter: search/read with AbortSignal
 Adapter->>Exa: initialize then tools/call
 Exa-->>Adapter: source content
 Adapter-->>Tool: bounded normalized sources
 Adapter->>Exa: close transport
 Tool-->>Agent: JSON with source URLs
```

## State

```mermaid
stateDiagram-v2
 [*] --> Initializing
 Initializing --> Calling: initialized
 Calling --> Closed: result or error
 Initializing --> Closed: abort / timeout / error
 Calling --> Closed: abort / timeout
 Closed --> [*]
```

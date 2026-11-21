# TASK-a6ef0284 diagrams

## Structure

```mermaid
flowchart LR
    classDef changed fill:#faeeda,stroke:#854f0b
    editor["CustomEditor"]:::changed --> registry["provider-presets"]:::changed
    editor --> main["ProviderSettings / ProviderGateway"]:::changed
    main --> resolve["resolveProviderBinding"]:::changed
    registry --> resolve
    resolve --> credentials["CredentialFile"]
    resolve --> gateway["createPiAiGateway"]:::changed
    gateway --> adapter["pi-ai Chat Completions"]
```

Changed nodes are the editor, registry, main, resolver and gateway. CredentialFile and the adapter are reused.

## Sequence

```mermaid
sequenceDiagram
    participant U as CustomEditor
    participant M as ProviderGateway
    participant R as resolveProviderBinding
    participant C as CredentialFile
    participant P as Provider
    U->>M: Discover with plan, region and workspace
    M->>R: Validate and derive exact scope
    M->>C: Read matching slot when using a saved key
    M->>P: GET fixed catalog if documented
    M-->>U: IDs or explicit entry result
    M->>P: POST scoped chat request
    P-->>M: Stream tool call
    M->>P: POST continuation with matching tool result
```

## State

The preset binding uses the existing connection lifecycle.

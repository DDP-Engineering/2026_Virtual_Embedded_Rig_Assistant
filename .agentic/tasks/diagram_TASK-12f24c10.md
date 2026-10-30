# TASK-12f24c10 diagrams

Illustrates Design in TASK-12f24c10.md; Design is authoritative.

## Structure

Map: WebAccessPanel, WebAccessService and ConfiguredWebProvider added; settings/IPC/Exa composition changed; CredentialFile reused.

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 page["WebAccessPanel"]:::added ==> ipc["web.access IPC"]:::changed
 ipc ==> service["WebAccessService"]:::added
 service ==> settings["SettingsService"]:::changed
 service ==> credentials["CredentialFile"]
 service ==> policy["ConfiguredWebProvider"]:::added
 agent["Agent tools"] ==> policy
 policy ==> exa["ExaWebProvider"]:::changed
 exa --> remote["Exa MCP"]
```

## Sequence

```mermaid
sequenceDiagram
 participant UI as Web access settings
 participant Main as WebAccessService
 participant Store as CredentialFile
 participant Policy as ConfiguredWebProvider
 participant Exa as Exa MCP
 UI->>Main: save preferences / optional key
 Main->>Policy: gate and revoke active calls
 Main->>Store: checkpoint / save key
 Main->>Main: commit non-secret preferences
 Main-->>UI: saved metadata
 UI->>Main: test selected authentication
 Main->>Policy: public search with temporary key
 Policy->>Exa: MCP call with selected header
 Exa-->>UI: bounded connection result via Main
```

## State

```mermaid
stateDiagram-v2
 [*] --> Idle
 Idle --> Testing: Test connection
 Testing --> Result: success / failure
 Testing --> Idle: close / cancel / revoke
 Result --> Idle: close
 Idle --> Saving: Save
 Saving --> Idle: commit / rollback
```

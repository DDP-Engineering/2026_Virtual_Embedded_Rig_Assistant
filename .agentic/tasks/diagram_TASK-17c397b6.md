# TASK-17c397b6 diagrams
Illustrates Design; Design is authoritative.

## Structure
Node map: PluginStore, WorkbenchService, ProgramTools, Plugins UI, CLI changed; machine snapshot reused representation; ProvisionerHosts added.
```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 UI["Plugins UI"]:::changed ==> Store["PluginStore"]:::changed
 Hosts["ProvisionerHosts"]:::added ==> Store
 UI ==> Hosts
 CLI["CLI"]:::changed ==> Store
 Store ==> Snapshot["machine snapshot"]
 WB["WorkbenchService"]:::changed ==> Store
 Tools["ProgramTools"]:::changed ==> Store
```
## Sequence
```mermaid
sequenceDiagram
 participant User
 participant UI as Plugins UI
 participant Store as PluginStore
 participant Runtime
 User->>UI: review scoped package
 UI->>Store: reviewScoped
 Store-->>UI: manifest and hash
 User->>UI: trust hash
 UI->>Store: trustScoped
 Store->>Store: verify source and save machine snapshot
 Runtime->>Store: load and recheck before spawn
 Store-->>Runtime: trusted snapshot or refusal
```
## State
```mermaid
stateDiagram-v2
 [*] --> Untrusted: discover
 Untrusted --> Trusted: explicit user hash review
 Trusted --> Changed: package edit or removal
 Changed --> Trusted: review current hash
 Changed --> Trusted: restore selected trusted bytes
 Trusted --> Collision: installed id collision
 Collision --> Untrusted: resolve collision
```

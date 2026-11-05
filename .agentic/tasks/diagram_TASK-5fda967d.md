# TASK-5fda967d diagrams

Illustrates Design in TASK-5fda967d.md. Design is authoritative.

Node map: Plugins UI, IPC and Provisioner changed; PluginListingHost/worker added; PluginStore reused unchanged; lightweight session list changed.

## Structure

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 ui["Plugins UI"]:::changed ==> ipc["plugins.check / installArchive"]:::changed
 ipc ==> prov["Provisioner"]:::changed
 ui ==> listing["PluginListingHost worker"]:::added
 listing ==> store["PluginStore.list"]
 prov --> store
 poll["session.list current DB projection"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
 participant UI as Plugins UI
 participant Main as Desktop IPC
 participant Core as Provisioner
 UI->>Main: installArchive(id,program,packageSHA,workbench)
 Main->>Main: verify identity, native picker, verify identity
 Main->>Core: install staged local archive
 Core->>Core: opened bytes SHA before cache reuse
 Core->>Core: extract safely, probe, record version
 Core-->>UI: statuses
```

## State

```mermaid
stateDiagram-v2
 [*] --> Unchecked
 Unchecked --> Checking: explicit check
 Checking --> Ready: valid probe
 Checking --> Missing: not found
 Checking --> Unavailable: probe/range failure
 Missing --> Installing: user install/archive
 Installing --> Ready: verified install
 Installing --> Missing: refused/failed
 Ready --> Checking: recheck
 Unavailable --> Checking: retry
```

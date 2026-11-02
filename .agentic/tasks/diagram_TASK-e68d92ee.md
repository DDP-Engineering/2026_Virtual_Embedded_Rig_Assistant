# TASK-e68d92ee diagrams

Illustrates `## Design` in `TASK-e68d92ee.md`. The Design text is authoritative.

Node classes: added = provisioning.ts, archive.ts, prepare-uv.mjs, uv-manifest.json, CLI plugin.ts,
IPC plugins.programs/provision; changed = shared plugins.ts schema, settings.ts, store.ts
(recordPrograms), program-tools.ts (env, version), desktop main index.ts, sessions.ts (cache), CLI
run.ts, package.mjs, electron-builder.yml; unchanged = runner, NodeProcessHost, approvals.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    manifest["shared plugins.ts<br/>range, download form, statuses"]:::changed
    settings["shared settings.ts<br/>plugins.index / proxy"]:::changed
    prov["core provisioning.ts<br/>Provisioner (resolve, statuses, install)"]:::added
    archive["core archive.ts<br/>zip, tar via system tar, tree check"]:::added
    store["core store.ts<br/>recordPrograms"]:::changed
    tools["core program-tools.ts<br/>env merge, resolved version"]:::changed
    runner["core ProgramRunner"]
    host["ProcessHost"]
    main["desktop main index.ts<br/>plugins.programs / provision"]:::changed
    sessions["desktop sessions.ts<br/>cached prompt entries"]:::changed
    cli["CLI plugin.ts<br/>vera plugin install"]:::added
    clirun["CLI run.ts"]:::changed
    prep["scripts/prepare-uv.mjs + uv-manifest.json"]:::added
    pkg["package.mjs + electron-builder.yml<br/>resources/uv"]:::changed
    manifest --> prov
    settings --> prov
    prov --> archive
    prov --> store
    prov --> host
    archive --> host
    tools --> prov
    tools --> runner
    main --> prov
    main --> sessions
    sessions --> tools
    cli --> prov
    clirun --> prov
    prep --> pkg
    pkg -. "uv binary" .-> prov
```

## Sequence

```mermaid
sequenceDiagram
    participant User
    participant Main as desktop main / CLI
    participant Prov as Provisioner
    participant Store as PluginStore
    participant Host as ProcessHost (uv, tar, probe)
    participant Net as fetch
    User->>Main: plugins.provision {id} / vera plugin install
    Main->>Prov: install(id)
    Prov->>Store: load(id)
    loop each program not ready (one at a time)
        alt pip / script
            Prov->>Host: uv tool install / uv sync --script (runtime env)
        else download
            Prov->>Net: GET url
            Net-->>Prov: bytes (hashed while streamed)
            Prov->>Host: tar -xf (tar archives) or zip in core
        end
        Prov->>Host: probe version (executable + version.args)
    end
    Prov->>Store: recordPrograms(id, sha256, versions)
    Prov-->>Main: statuses
    Main->>Main: sessions.invalidatePrograms()
    Note over Main,Prov: later: run_program -> resolve (no install) -> runner.start
```

## State

```mermaid
stateDiagram-v2
    [*] --> unavailable: platform / launcher / no uv
    [*] --> missing: not installed (pip, script, download) or not found (find)
    missing --> ready: install + probe in range
    missing --> missing: install fails (install, download, sha256, archive)
    missing --> unavailable: probe out of range / unreadable
    ready --> missing: plugin reinstalled (install.json programs = {})
    ready --> unavailable: found program upgraded out of range (after invalidation)
```

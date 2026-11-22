# TASK-52e81374 diagrams

Illustrates `## Design` in `TASK-52e81374.md`. The Design text is authoritative.

Node classes: added = `components.mjs`, `build-components.mjs`, `dictation/archive.ts`, `components/ part`; changed = `verify-delivery.mjs`, `runtime.ts`, `models.ts`, `main routes`, `browser-settings.tsx`, `dictation-settings.tsx`; unchanged = `release.ts`, `catalog.ts`, `integrity checks`, `extractZip`, native picker.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    release["browser/release.ts pins"]
    catalog["dictation/catalog.ts pins"]
    build["build-components.mjs"]:::added --> lib["components.mjs"]:::added
    lib --> release
    lib --> catalog
    lib ==> part[("components/ part + SHA256SUMS + notices")]:::added
    verify["verify-delivery.mjs"]:::changed --> lib
    ui1["browser-settings.tsx"]:::changed -->|browser.runtime.installFile| routes["main routes"]:::changed
    ui2["dictation-settings.tsx"]:::changed -->|dictation.installFile| routes
    routes --> picker["native file picker"]
    routes --> runtime["browser/runtime.ts"]:::changed
    routes --> models["dictation/models.ts"]:::changed
    runtime --> release
    models --> archive["dictation/archive.ts"]:::added
    archive --> extract["core extractZip"]
    models --> catalog
    runtime --> checks["integrity checks"]
    models --> checks
```

## Sequence

```mermaid
sequenceDiagram
    participant UI as Settings renderer
    participant Main as Desktop main
    participant Dlg as Native picker
    participant Job as Runtime / model job
    UI->>Main: installFile (no path)
    Main->>Dlg: showOpenDialog(zip)
    alt closed without a file
        Dlg-->>Main: canceled
        Main-->>UI: current state, nothing started
    else file chosen
        Dlg-->>Main: path
        Main->>Job: provision({file}) / installArchive(id, file)
        Job->>Job: copy or extract into staging, verify pins
        alt verified
            Job->>Job: atomic rename to installed name
            Main-->>UI: ready / installed
        else mismatch or unreadable
            Job->>Job: discard staging
            Main-->>UI: failed (integrity / storage)
        end
    end
```

## State

```mermaid
stateDiagram-v2
    [*] --> missing
    missing --> verifying: Install from file (browser)
    verifying --> installing: archive matches pin
    verifying --> failed: integrity / storage
    installing --> ready: tree verified, renamed
    installing --> failed: integrity
    verifying --> cancelled: Cancel
    failed --> verifying: Install from file again
    missing --> downloading_fromFile: Install from file (model)
    downloading_fromFile --> installed: inventory and hashes match
    downloading_fromFile --> failed: integrity / space / storage
```

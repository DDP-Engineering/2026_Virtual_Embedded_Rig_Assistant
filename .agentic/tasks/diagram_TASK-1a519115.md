# TASK-1a519115 diagrams

Illustrates `## Design` in `TASK-1a519115.md`. The Design text is authoritative.

Node classes: added = `plugin-catalog.ts` (shared), `catalog-source.ts`, `catalog.ts`, CLI `catalog.ts`,
`catalog-checks.ts`, `plugin-catalog.tsx`, `prepare-plugins.mjs`, catalog source files; changed =
`store.ts` (exported reader, install origin), `program-rules.ts` (`ruleNamesProgram`), main `index.ts`,
`plugins.tsx`, `settings.ts`, `package.mjs`; unchanged = `net.fetch`, the Review screen's store review.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    source[("05_Software/plugins: packs.yaml, catalog.yaml, plugin folders")]:::changed
    cli["CLI vera catalog check/build"]:::added
    csrc["core catalog-source.ts"]:::added
    shared["shared plugin-catalog.ts"]:::added
    rules["shared program-rules.ts ruleNamesProgram"]:::changed
    store["core PluginStore readPluginPackage/install origin"]:::changed
    release[("release folder: index.json + zips")]
    prep["scripts/prepare-plugins.mjs"]:::added
    pkg["scripts/package.mjs resources/plugins"]:::changed
    client["core PluginCatalog view/review/install"]:::added
    main["desktop main IPC + CatalogChecks"]:::changed
    ui["renderer plugin-catalog.tsx + plugins.tsx"]:::changed
    settings["shared settings plugins.catalog"]:::changed
    source --> cli --> csrc
    csrc --> store
    csrc --> shared
    csrc --> rules
    csrc --> release
    prep --> cli
    prep --> pkg
    release --> client
    client --> store
    client --> shared
    main --> client
    settings --> main
    ui --> main
```

## Sequence

```mermaid
sequenceDiagram
    participant U as User (Plugins page)
    participant M as Desktop main
    participant C as PluginCatalog
    participant H as Catalog host / bundled folder
    participant S as PluginStore
    U->>M: plugins.catalog {refresh}
    M->>C: view()
    C->>H: GET index.json
    H-->>C: index (validated, else bundled fallback)
    C-->>U: plugins, packs, installed, update marks
    U->>M: plugins.catalogReview {id}
    M->>C: review(id)
    C->>H: GET <id>-<version>.zip
    C->>C: size == bytes, SHA-256 == sha256, keep zip
    C->>S: readPluginPackage(zip)
    C->>C: id/version match, no downgrade, required?
    C-->>U: review + required
    U->>M: plugins.catalogInstall {id, sha256} (after the review screen, or at once when not required)
    M->>C: install(id, sha256)
    C->>C: re-hash kept zip against the entry
    C->>S: install(zip, sha256, {tier, url})
    C-->>U: installed summary (tier official/community)
```

## State

```mermaid
stateDiagram-v2
    [*] --> Browsing
    Browsing --> Reviewing: Install / Install selected / Update (required)
    Browsing --> Installing: Update (review not required)
    Reviewing --> Installing: Install
    Reviewing --> Browsing: Cancel (queue cleared)
    Installing --> Reviewing: next queued plugin
    Installing --> Browsing: queue empty
    Installing --> Browsing: error shown
```

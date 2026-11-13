# TASK-2c5054ba diagrams

Illustrates `## Design` in `TASK-2c5054ba.md`. The Design text is authoritative.

Node classes: added - parts-search.ts, partsSearch settings, parts_search tool, ConfiguredPartsProvider,
partsJson, five adapters, provider.ts, PartsAccessService, PartsAccessPanel, parts-search plugin,
parts-compare; changed - SessionsHost (computes the plugin gate, passes `parts`), CLI run (env credentials),
Settings dialog (new section), tool registry (new builtin); unchanged - CredentialFile, SettingsService,
WorkbenchService.loadPlugins, ProgramRunner.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    panel["PartsAccessPanel (renderer)"]:::added -- "parts.access.* IPC" --> service["PartsAccessService (main)"]:::added
    settingsUi["Settings dialog"]:::changed --> panel
    service --> creds[("CredentialFile parts:&lt;id&gt;")]
    service --> settings[("SettingsService partsSearch")]
    service --> provider["ConfiguredPartsProvider (core)"]:::added
    sessions["SessionsHost"]:::changed --> provider
    sessions --> plugins["WorkbenchService.loadPlugins"]
    cli["CLI run (env credentials)"]:::changed --> provider
    registry["tool registry"]:::changed --> tool["parts_search tool"]:::added
    tool --> provider
    provider --> adapters["mouser / digikey / tme / farnell / rutronik adapters"]:::added
    adapters --> http["partsJson (fixed endpoints)"]:::added
    adapters --> normalize["provider.ts normalize + group"]:::added
    http --> suppliers(("supplier APIs"))
    plugin["parts-search plugin (skills)"]:::added --> compare["parts-compare script"]:::added
    runner["ProgramRunner"] --> compare
    compare --> results[("electronics-results/&lt;run-id&gt;")]
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent
    participant Tool as parts_search
    participant Gate as ConfiguredPartsProvider
    participant Store as CredentialFile
    participant Adapter as supplier adapter
    participant API as supplier API
    Agent->>Tool: query or mpn, supplier, limit
    Tool->>Gate: search(request, signal)
    Gate->>Gate: gate: Web access, official plugin, supplier enabled
    Gate->>Store: read parts:<id>
    Store-->>Gate: credential or none (key-required)
    Gate->>Gate: gate again, generation unchanged
    Gate->>Adapter: search (token from store or one shared token request)
    Adapter->>API: fixed endpoint, 30 s, no redirect
    API-->>Adapter: 200 / 401 / 429 / partial
    Adapter-->>Gate: items + status (401: one token refresh, 429: one bounded retry)
    Gate-->>Tool: devices grouped, supplier statuses, notes
    Tool-->>Agent: result (no credential, no URL with a key)
    Agent->>Agent: read datasheets, write request
    Agent->>Tool: run_program parts-compare compare --input request.json
```

## State

```mermaid
stateDiagram-v2
    [*] --> requested
    requested --> keyRequired: no credential
    requested --> sent: credential read, gate holds
    sent --> ok: 200, all items read
    sent --> partial: errors next to results / unreadable items
    sent --> failed: errors only / wrong shape
    sent --> refresh: 401 with token (DigiKey, TME)
    refresh --> sent: new token, once
    sent --> auth: 401 or 403 (after refresh)
    sent --> retry: 429
    retry --> sent: after min(Retry-After, 5 s), once
    retry --> rateLimited: 429 again
    sent --> timeout: 30 s
    sent --> unavailable: other status, unreachable, over 4 MiB
    sent --> cancelled: caller abort or revocation
    keyRequired --> [*]
    ok --> [*]
    partial --> [*]
    failed --> [*]
    auth --> [*]
    rateLimited --> [*]
    timeout --> [*]
    unavailable --> [*]
    cancelled --> [*]
```

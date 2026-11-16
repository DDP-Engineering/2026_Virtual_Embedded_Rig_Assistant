# TASK-b74c88bb diagrams

Illustrates `## Design` in `TASK-b74c88bb.md`. The Design text is authoritative.

Node map: added - shared_eplan, core_eplan, eplan_tool, helper, plugin, fixtures; changed - documentation (csvRecords
exported with a delimiter), tools_gating (new entries), registry (new tools); unchanged - result_change, commit,
doc_run, model.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    shared_eplan["shared eplan.ts (profile, outcome schemas)"]:::added
    core_eplan["core electrical/eplan.ts"]:::added
    eplan_tool["core electrical/eplan-tool.ts (eplan, eplan_change, eplan_check)"]:::added
    documentation["electrical/documentation.ts csvRecords"]:::changed
    tools_gating["electrical/tools.ts electricalPluginTools"]:::changed
    registry["tools/registry.ts"]:::changed
    result_change["electrical/result-change.ts prepareResultChange"]
    commit["tools/changes.ts commitChange"]
    doc_run[("documentation result.json")]
    model[("electrical-automation-model.json")]
    helper["plugins/eplan/scripts/eplan_tool.py"]:::added
    plugin["plugins/eplan plugin.yaml rules"]:::added
    fixtures["tests/fixtures/eplan"]:::added
    core_eplan ==> shared_eplan
    core_eplan ==> documentation
    eplan_tool ==> core_eplan
    eplan_tool ==> result_change
    eplan_tool ==> commit
    eplan_tool ==> doc_run
    eplan_tool ==> model
    registry ==> eplan_tool
    tools_gating ==> eplan_tool
    plugin ==> helper
    helper ==> shared_eplan
    fixtures ==> core_eplan
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent
    participant VERA as eplan / eplan_change / eplan_check
    participant Helper as eplan-tool
    participant EPLAN as EPLAN.exe
    Agent->>Helper: export --profile (run_program, device-read)
    Helper->>EPLAN: ProjectAction /OpenMode:ReadOnly devicelist EXPORT, XMActionDCCommonExport
    Helper-->>Agent: outcome.json + devices.csv, terminals.txt, connections.txt
    Agent->>VERA: eplan view reconcile (documentation run)
    Agent->>VERA: eplan_change candidate (base sha256) -> approval -> new .csv
    Agent->>Helper: import --candidate --sha256 --copy (run_program, device-write)
    Helper->>EPLAN: projectmanagement CREATESNAPSHOTCOPY, devicelist IMPORT on copy (Exclusive), reports, re-export
    Helper-->>Agent: outcome.json (completed | failed | interrupted | refused)
    Agent->>VERA: eplan_check (base, candidate, re-export, outcome) -> approval -> result.json
```

## State

```mermaid
stateDiagram-v2
    [*] --> refused: invalid input, wrong project, conflict, no EPLAN 2025
    [*] --> running: checks passed
    running --> failed: step exit != 0, no file, timeout (licence, lock, unsaved)
    running --> interrupted: Stop
    running --> completed: every step exit 0 with its file
    completed --> verified: eplan_check identity, unchanged, applied, outcome pass
    completed --> not_applied: eplan_check finds a difference
    refused --> [*]
    failed --> [*]
    interrupted --> [*]
```

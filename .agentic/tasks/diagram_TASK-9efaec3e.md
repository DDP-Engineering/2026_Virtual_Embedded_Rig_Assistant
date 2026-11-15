# TASK-9efaec3e diagrams

Illustrates `## Design` in `TASK-9efaec3e.md`. The Design text is authoritative.

Node map: added = xml-strict, qet, qet-templates, qet-check, qet-tool; changed = tools.ts gating, result-change;
unchanged = commitChange, model files, motor_drives results.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    tool["qet-tool.ts (qelectrotech, _change, _check)"]:::added --> reader["qet.ts readQetProject"]:::added
    reader --> xml["xml-strict.ts parseStrictXml"]:::added
    tool --> tpl["qet-templates.ts renderTemplate"]:::added
    tool --> chk["qet-check.ts checks, reconcile"]:::added
    chk --> reader
    tool --> commit["commitChange (write queue)"]
    tool --> rc["result-change.ts prepareResultChange"]:::changed
    tool --> model[("electrical-automation-model.json")]
    tool --> md[("motor_drives result")]
    gate["tools.ts electricalPluginTools"]:::changed --> tool
```

## Sequence

```mermaid
sequenceDiagram
    participant A as Agent
    participant T as qelectrotech_change
    participant R as reader + checks
    participant W as write flow
    A->>T: candidate {motorDrivesRun, motor, path}
    T->>T: read model, result (current?), assembly
    T->>T: renderTemplate(assembly)
    T->>R: readQetProject(xml) + assemblyChecks
    R-->>T: checks (all pass or refuse)
    T->>W: prepared change (before absent)
    W-->>A: approval, apply: {path, sha256, checks}
```

## State

Not drawn: the change adds no lifecycle or status field; candidates are plain files and results keep the existing
current/stale freshness.

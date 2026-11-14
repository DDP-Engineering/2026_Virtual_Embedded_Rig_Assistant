# TASK-cf769025 diagrams

Illustrates `## Design` in `TASK-cf769025.md`. The Design text is authoritative.

Node map: added - lab_validate.py, cli, request, importers, preprocess, metrics, align, decide, report, aggregate
; changed - catalog.yaml and packs.yaml (new entries); unchanged - runner, scpi capture folder, ngspice/ltspice run folder, CSV file.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    runner["core ProgramRunner (safe rules)"] ==> entry["lab_validate.py"]:::added
    entry ==> cli["cli: operations"]:::added
    cli ==> request["request: validate"]:::added
    cli ==> importers["importers registry"]:::added
    importers -.reads.-> scpi[("scpi capture run folder")]
    importers -.reads.-> spice[("ngspice/ltspice run folder")]
    importers -.reads.-> csv[("CSV / sigrok CSV")]
    importers ==> preprocess["preprocess"]:::added
    preprocess ==> metrics["metrics registry"]:::added
    preprocess ==> align["align + error stats"]:::added
    metrics ==> decide["decide: criteria, verdict"]:::added
    align ==> decide
    decide ==> report["report: run folder"]:::added
    cli ==> aggregate["aggregate (report op)"]:::added
    aggregate -.reads.-> report
    catalog["catalog.yaml / packs.yaml"]:::changed -.lists.-> entry
```

## Sequence

```mermaid
sequenceDiagram
    participant A as Agent
    participant R as ProgramRunner
    participant H as lab-validate
    participant F as Workbench files
    A->>R: run_program lab-validate compare --request v.json
    R->>H: start (safe, no approval)
    H->>F: read request, sources (hash-checked)
    H->>H: normalize, preprocess, measure, align, decide (in memory)
    H->>F: create embedded-lab-results/<run-id>/ exclusively, write result.json, report.md, csv, svg
    H-->>R: summary JSON, exit 0/1/3 (2 = refused, nothing written)
    R-->>A: tool output with the verdict and the report path
```

## State

```mermaid
stateDiagram-v2
    [*] --> evaluated: value ok
    [*] --> incomplete: value unknown or limiting diagnostic or condition missing/differing
    evaluated --> pass: rule satisfied (simple or guarded with U)
    evaluated --> fail: rule violated beyond U
    evaluated --> incomplete: U straddles the limit or guarded without U
    pass --> [*]
    fail --> [*]
    incomplete --> [*]
```

# TASK-80043c39 diagrams

Illustrates `## Design` in `TASK-80043c39.md`. The Design text is authoritative.

Node classes: added - ngspice plugin manifest, ngspice-tool (cli, request, netlist, engine, measure, sweep, compare,
report), the 7z form, the uses resolution; changed - downloadForm, provisioner extraction and resolve; unchanged -
ProgramRunner, program tools, ngspice engine.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    manifest["ngspice plugin.yaml (ngspice, ngspice-tool uses ngspice)"]:::added --> prov["Provisioner"]:::changed
    form["downloadForm: 7z (Windows)"]:::changed --> prov
    prov -- "bsdtar, bounded exit 1" --> engineDir[("pinned ngspice-47")]
    prov -- "resolve uses -> VERA_PROGRAM_NGSPICE" --> runner["ProgramRunner"]
    runner --> cli["ngspice-tool cli"]:::added
    cli --> request["request.py"]:::added
    cli --> netlist["netlist.py (allowlist, includes, models, pins)"]:::added
    cli --> engine["engine.py (copy, effective netlist, ngspice -b -n)"]:::added
    engine --> engineDir
    cli --> measure["measure.py"]:::added
    cli --> sweep["sweep.py"]:::added
    cli --> compare["compare.py"]:::added
    cli --> report["report.py"]:::added
    report --> runs[("electronics-results/<run-id>")]
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent
    participant Runner as ProgramRunner
    participant Tool as ngspice-tool
    participant Engine as ngspice
    Agent->>Runner: run_program ngspice-tool run --input req.json
    Runner->>Tool: start (env VERA_PROGRAM_NGSPICE)
    Tool->>Tool: read request, parse netlist chain, refuse before the engine
    Tool->>Tool: copy chain to run folder, effective.cir with control block
    Tool->>Engine: ngspice -b -n effective.cir (cwd run folder, deadline)
    Engine-->>Tool: exit, ngspice.log, series.dat
    Tool->>Tool: classify log, parse series, measure, criteria
    Tool-->>Runner: summary (result.json, report.md, series.csv, plot.svg)
    Runner-->>Agent: output; Stop kills the tree
```

## State

```mermaid
stateDiagram-v2
    [*] --> refused: request or netlist invalid (exit 2)
    [*] --> running: validated, run folder created
    running --> ok: exit 0, series present, clean log
    running --> failed: error, singular, no convergence, missing data (exit 3)
    running --> timeout: deadline, engine tree killed (exit 3)
    running --> stopped: Stop from VERA, tree killed
    ok --> [*]
    failed --> [*]
    timeout --> [*]
    refused --> [*]
    stopped --> [*]
```

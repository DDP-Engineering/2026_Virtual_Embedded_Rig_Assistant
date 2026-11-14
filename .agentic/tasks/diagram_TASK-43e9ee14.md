# TASK-43e9ee14 diagrams

Illustrates `## Design` in `TASK-43e9ee14.md`. The Design text is authoritative.

Node classes: added - ltspice plugin manifest, ltspice-tool (cli, request, netlist, schematic, engine, raw, measure,
sweep, compare, report), catalog/packs entries; changed - none; unchanged - Provisioner (find, `uses`),
ProgramRunner, the user's LTspice.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    manifest["ltspice plugin.yaml (ltspice find-only, ltspice-tool uses ltspice)"]:::added --> prov["Provisioner"]
    catalog["catalog.yaml / packs.yaml entries"]:::added --> prov
    prov -- "find + -version; uses -> VERA_PROGRAM_LTSPICE" --> runner["ProgramRunner"]
    runner --> cli["ltspice-tool cli (+ convert)"]:::added
    cli --> request["request.py (near copy)"]:::added
    cli --> netlist["netlist.py (LTspice dialect, includes, library)"]:::added
    cli --> schematic["schematic.py (.asc copy, -netlist)"]:::added
    cli --> engine["engine.py (effective.net, -b, deadline, size watchdog)"]:::added
    engine --> lt[("user's LTspice.exe")]
    schematic --> lt
    engine --> raw["raw.py (binary raw, steps)"]:::added
    cli --> measure["measure.py (byte copy)"]:::added
    cli --> sweep["sweep.py (byte copy)"]:::added
    cli --> compare["compare.py"]:::added
    cli --> report["report.py (redaction)"]:::added
    report --> runs[("electronics-results/<run-id>")]
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent
    participant Runner as ProgramRunner
    participant Tool as ltspice-tool
    participant LT as LTspice.exe
    Agent->>Runner: run_program ltspice-tool run --input req.json
    Runner->>Tool: start (env VERA_PROGRAM_LTSPICE)
    Tool->>Tool: read request; .asc? copy schematic folder
    Tool->>LT: -netlist input/x.asc (only for schematics)
    LT-->>Tool: input/x.net
    Tool->>Tool: check netlist chain, refuse before the engine
    Tool->>Tool: copy includes, effective.net (.temp, .save, analysis, .step)
    Tool->>LT: -b effective.net (cwd run folder, deadline, size watchdog)
    LT-->>Tool: exit, effective.log, effective.raw
    Tool->>Tool: classify log, parse raw (steps), measure, criteria
    Tool-->>Runner: summary (result.json, report.md, series.csv, plot.svg)
    Runner-->>Agent: output; Stop kills the tree
```

## State

```mermaid
stateDiagram-v2
    [*] --> refused: request, netlist, schematic invalid or LTspice not installed (exit 2)
    [*] --> converting: schematic given
    converting --> failed: no netlist written (exit 3)
    converting --> running: netlist checked
    [*] --> running: netlist checked, run folder created
    running --> ok: exit 0, complete raw, clean log
    running --> failed: model, subckt, singular, convergence, partial, vector (exit 3)
    running --> limit: raw beyond the data limit, engine killed (failed, exit 3)
    running --> timeout: deadline, engine killed (exit 3)
    running --> stopped: Stop from VERA, tree killed
    ok --> [*]
```

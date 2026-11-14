# TASK-7c2a9322 diagrams

Illustrates `## Design` in `TASK-7c2a9322.md`. The Design text is authoritative.

Node map: added - `plugin.yaml` (kicad), `kicad_tool.py`, `kicad_support/cli.py`, `operations.py`, `project.py`,
`sexpr.py`, `discovery.py`, `kicad.py`, `netlist.py`, `board.py`, `checks.py`, `bom.py`, `exports.py`,
`review.py`, `document.py`, `kicad_support/workspace.py`, `elec_support/workspace.py`; changed -
`elec_support/report.py`, `cli.py`, `quantities.py` and `contract.py` (path rules and text helpers moved out), `catalog.yaml` and `packs.yaml`, the provisioner (probes and uv
calls without a process group on Windows); unchanged - the program runner and kicad-cli.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    manifest["kicad/plugin.yaml kicad-cli find, kicad-tool script"]:::added ==> runner["ProgramRunner"]
    manifest ==> provisioner["Provisioner probes and uv, attached on Windows"]:::changed
    runner ==> entry["scripts/kicad_tool.py"]:::added
    entry ==> cli["kicad_support/cli.py options, exit codes"]:::added
    cli ==> workspace["kicad_support/workspace.py path rules"]:::added
    cli ==> ops["operations.py seven operations"]:::added
    ops ==> project["project.py file set, hashes, work copy, references per instance"]:::added
    project ==> sexpr["sexpr.py parser"]:::added
    ops ==> discovery["discovery.py locate KiCad 10"]:::added
    ops ==> kicad["kicad.py command builders, subprocess"]:::added
    kicad ==> kicadcli["kicad-cli (user's KiCad 10)"]
    ops ==> netlist["netlist.py instances, nets"]:::added
    ops ==> board["board.py layers, stackup, tracks"]:::added
    ops ==> checks["checks.py ERC/DRC"]:::added
    ops ==> bom["bom.py"]:::added
    ops ==> exports["exports.py kinds, layers, format checks"]:::added
    ops ==> review["review.py report.md"]:::added
    cli ==> document["document.py result, fitting"]:::added
    netlist ==> sexpr
    board ==> sexpr
    elecws["elec_support/workspace.py byte-identical copy"]:::added -.- workspace
    elecreport["elec_support/report.py, cli.py wrappers"]:::changed ==> elecws
    elecq["elec_support/quantities.py, contract.py text helpers"]:::changed ==> elecws
    catalog["catalog.yaml, packs.yaml"]:::changed ==> manifest
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent as Agent run_program
    participant Runner as ProgramRunner
    participant Tool as kicad_tool.py
    participant FS as working directory
    participant Tmp as temp work folder
    participant KiCad as kicad-cli
    Agent->>Runner: kicad-tool drc --project board/x.kicad_pro
    Runner->>Tool: uv run --offline --script, stdin closed
    Tool->>FS: judge paths, read file set once, SHA-256, parse
    alt a usage, path, project, kicad or layer problem
        Tool-->>Runner: error document, exit 2, nothing written
    else accepted
        Tool->>KiCad: version
        Tool->>Tmp: write the bytes read into project/
        Tool->>KiCad: pcb drc ... -o out/drc.json project/x.kicad_pcb
        KiCad->>Tmp: out/drc.json, project/x.kicad_prl
        KiCad-->>Tool: exit code, output tail
        Tool->>FS: re-hash every source
        alt KiCad failed, or a source changed
            Tool-->>Runner: error document, exit 3, nothing written
        else completed
            Tool->>FS: exclusive mkdir run folder, re-check, copy outputs, result.json, report.md
            Tool-->>Runner: fitted document, exit 0
        end
        Tool->>Tmp: remove the work folder
    end
```

## State

```mermaid
stateDiagram-v2
    [*] --> Validating
    Validating --> Refused: usage, path, project, kicad, layer
    Validating --> Running: work copy written
    Running --> Failed: kicad-cli error, timeout, missing output
    Running --> Verifying: last kicad-cli call done
    Verifying --> Failed: a source changed
    Verifying --> Writing: sources unchanged
    Writing --> Failed: run folder exists, moved out, or write error (folder removed)
    Writing --> Completed: result.json, report.md, artifacts
    Running --> Stopped: tree killed (temp folder may remain)
    Refused --> [*]: exit 2
    Failed --> [*]: exit 3
    Completed --> [*]: exit 0
    Stopped --> [*]
```

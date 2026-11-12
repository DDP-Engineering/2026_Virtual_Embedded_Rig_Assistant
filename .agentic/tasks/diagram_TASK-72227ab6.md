# TASK-72227ab6 diagrams

Illustrates `## Design` in `TASK-72227ab6.md`. The Design text is authoritative.

Node map: added - `elec_calc.py`, `cli.py`, `engine.py`, `contract.py`, `quantities.py`, `waveforms.py`,
`electrical.py`, `losses.py`, `thermal.py`, `tolerance.py`, `report.py`, `plugin.yaml`; changed -
`catalog.yaml` and `packs.yaml`, `plugin-catalog.ts`, `plugin-library-controls.tsx`; unchanged - the
program runner and provisioner.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    runner["ProgramRunner and Provisioner"] ==> cli["scripts/elec_calc.py"]:::added
    manifest["plugin.yaml program elec-calc"]:::added ==> runner
    cli ==> main["elec_support/cli.py main, operation help"]:::added
    main ==> engine["elec_support/engine.py run_operation"]:::added
    engine ==> contract["contract.py Reader, Result, CalcError"]:::added
    contract ==> quantities["quantities.py units and prefixes"]:::added
    engine ==> electrical["electrical.py dc, divider, rc"]:::added
    engine ==> losses["losses.py"]:::added
    engine ==> thermal["thermal.py"]:::added
    losses ==> waveforms["waveforms.py current descriptor"]:::added
    electrical ==> waveforms
    engine ==> tolerance["tolerance.py corners, Monte Carlo"]:::added
    tolerance ==> engine
    main ==> report["report.py path guards, JSON and Markdown files"]:::added
    report ==> engine
    catalog["catalog.yaml, packs.yaml"]:::changed ==> manifest
    activity["plugin-catalog.ts CATALOG_ACTIVITIES"]:::changed ==> controls["plugin-library-controls.tsx labels"]:::changed
    catalog ==> activity
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent as Agent run_program
    participant Runner as ProgramRunner
    participant CLI as elec_calc.py
    participant Engine as engine.run_operation
    participant Model as model function
    participant FS as working directory
    Agent->>Runner: elec-calc report --input calc.json
    Runner->>CLI: uv run --offline --script, stdin closed
    CLI->>FS: read calc.json, SHA-256
    loop each calculation
        CLI->>Engine: operation, input
        Engine->>Model: Reader with validated SI quantities
        Model-->>Engine: Result or CalcError
    end
    alt a refusal, or the run folder already exists
        CLI-->>Runner: error document, exit 2, nothing written
    else every calculation accepted
        CLI->>FS: exclusive mkdir of the run folder
        CLI->>FS: resolve the run folder again
        CLI->>FS: exclusive report.json, report.md
        CLI->>FS: hash calc.json again
        alt folder still inside and input unchanged
            CLI-->>Runner: summary document, exit 0
        else results directory swapped, a write failed or input changed
            CLI->>FS: remove every file and folder the run created
            CLI-->>Runner: error document (output), exit 3
        end
    end
    Runner-->>Agent: output, exitCode, risk safe
```

## State

Not drawn: the design adds no lifecycle; a result's `status` is decided once per run.

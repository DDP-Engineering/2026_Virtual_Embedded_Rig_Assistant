# TASK-f059e085 diagrams

Illustrates `## Design` in `TASK-f059e085.md`. The Design text is authoritative.

Node map: added - renode-sim cli, profiles, firmware, testsets, engine, operations, result, report, renode program,
plugin profiles/test sets; unchanged - VERA runner, run_program, provisioner, workbench files, Renode engine.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    agent["run_program"] ==> runner["ProgramRunner"]
    runner ==> cli["renode-sim cli.py"]:::added
    prov["provisioner (download, sha256)"] -.-> engineprog["renode program"]:::added
    cli ==> profiles["profiles.py (repl/resc validators)"]:::added
    cli ==> firmware["firmware.py (elf.py copy)"]:::added
    cli ==> testsets["testsets.py"]:::added
    cli ==> ops["operations.py (steps, statuses)"]:::added
    ops ==> engine["engine.py (console, slices, log)"]:::added
    ops ==> result["result.py (progressive result.json)"]:::added
    engine ==> renode[["Renode 1.17.0 process"]]
    engineprog -.-> engine
    cli ==> report["report.py (md, html, junit, --hil)"]:::added
    profiles -.-> files[("plugin profiles/testsets and workbench renode/")]:::added
    result ==> folder[("embedded-lab-results/run-id")]
    report ==> folder
```

## Sequence

```mermaid
sequenceDiagram
    participant R as VERA runner
    participant H as renode-sim
    participant E as Renode (stdio console)
    participant F as run folder
    R->>H: test --profile --firmware --arch --boot-address --test-set
    H->>H: validate profile, engine files, test set, ELF
    H->>F: copy inputs, result.json state running
    H->>E: start headless, logFile, approved resc commands, LoadELF, VectorTableOffset, CreateFileBackend
    loop each slice until the step ends or a budget is used
        H->>E: emulation RunFor slice
        E-->>F: UART bytes, engine log
        H->>F: read new lines, unmodeled accesses
        H->>E: stimulus / observable read (declared only)
        H->>F: heartbeat, case results
    end
    H->>E: GetTimeSourceInfo, quit (kill after 10 s)
    H->>F: result.json state done, junit.xml
    H-->>R: exit code and summary
```

## State

```mermaid
stateDiagram-v2
    [*] --> refused: options, paths or option values invalid (exit 2, no folder)
    [*] --> blocked: profile, test set, firmware, engine or run path does not fit (folder, exit 3)
    [*] --> running: run folder created, engine started
    running --> error: engine start, crash, answer to a setup command, logged error, start check
    running --> done: all cases evaluated
    running --> timeout: real budget ended (engine killed)
    running --> interrupted: Stop or runner kill (result.json stays running)
    interrupted --> stopped: report after heartbeat older than 90 s
    done --> [*]
```

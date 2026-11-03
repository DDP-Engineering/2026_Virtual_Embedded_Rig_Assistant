# TASK-10445e04 diagrams

Illustrates `## Design` in `TASK-10445e04.md`. The Design text is authoritative.

Node map: added = plugins/esp32-esptool/plugin.yaml, skill esp32-flash, fake_esptool.py stub, integration test;
no class = run_program, ApprovalGate, ProgramRunner, Provisioner, uv, esptool, serial-monitor (reused unchanged).

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    manifest["plugins/esp32-esptool/plugin.yaml<br/>program esptool, rules"]:::added
    skill["skills/esp32-flash/SKILL.md"]:::added
    serialmon["plugins/serial-monitor"]
    tool["run_program"]
    gate["ApprovalGate (file hashes)"]
    runner["ProgramRunner"]
    prov["Provisioner (pip kind)"]
    uv["uv tool install esptool>=5,<6"]
    esptool["tools/esp32-esptool/bin/esptool"]
    stub["tests/fixtures/esp32-esptool/fake_esptool.py"]:::added
    test["tests/integration/esp32-esptool.test.ts"]:::added
    manifest ==> serialmon
    manifest --> tool
    skill --> tool
    tool --> gate --> runner --> esptool
    tool --> prov --> uv --> esptool
    test ==> manifest
    test ==> stub
    stub -.-> esptool
```

## Sequence

```mermaid
sequenceDiagram
    participant A as Agent
    participant T as run_program
    participant G as ApprovalGate
    participant R as ProgramRunner
    participant E as esptool
    participant S as serial (serial-monitor)
    A->>T: esptool --port COM7 chip-id
    T->>G: device-read (ask)
    G-->>T: user approves
    T->>R: start
    R->>E: chip-id
    E-->>A: Chip type ESP32-S3
    A->>T: esptool --chip esp32s3 --port COM7 write-flash 0x0 bootloader.bin 0x8000 partition-table.bin 0x10000 app.bin
    T->>G: device-write, files with SHA-256
    G-->>T: user approves
    T->>R: start (files hashed again, CONFLICT if changed)
    R->>E: write-flash
    E-->>A: Hash of data verified (per file), hard reset
    A->>T: serial capture --port COM7 --reset --until main_task
    T->>G: device-read (ask)
    G-->>T: user approves
    T->>R: start
    R->>S: capture
    S-->>A: boot log
```

## State

Not drawn: the plugin adds no lifecycle or status field; approval states belong to the unchanged platform.

# TASK-39da0f51 diagrams

Illustrates `## Design` in `TASK-39da0f51.md`. The Design text is authoritative.

Node classes: added - power-profiler package (power-profile and power-analyze helpers, power_support modules,
profile); changed - shared lab-resources (kind power-monitor), lab-validation (integral metric, power-capture
importer, units C/J), HIL adapters/compile/executor (power steps, captures flag), scpi registry reader (skips
power-monitor entries); unchanged - program-tools / resource-registry, ProgramRunner and ResourceLeases.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    reg[("lab/resources.json")] --> labres["shared lab-resources (kind power-monitor)"]:::changed
    labres --> tools["program-tools / resource-registry"]
    tools --> runner["ProgramRunner + ResourceLeases"]
    hil["HIL adapters power.identify / power.capture"]:::changed --> runner
    runner --> live["power-profile helper"]:::added
    runner --> off["power-analyze helper"]:::added
    live --> meter["power_support: meter, capture, lifecycle"]:::added
    meter --> drv["pyjoulescope_driver 2.5.5 (PyPI)"]
    drv --> js["JS220"]
    live --> cap[("embedded-lab-results/run-id: result.json + samples.csv")]
    off --> cap
    off --> ana["power_support: measure, segment, compare, battery (series.py copy)"]:::added
    ana --> req[("lab-validation-request.json")]
    req --> lv["lab-validate: integral + power-capture importer"]:::changed
    cap --> lv
    reg --> scpi["scpi registry reader"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
    participant R as ProgramRunner
    participant H as power-profile capture
    participant D as pyjoulescope_driver
    participant M as JS220
    R->>H: spawn (lease held, VERA_RUN_CONTROL)
    H->>H: registry, profile, acquisition, firmware checks
    H->>D: device_paths(), open(path, restore)
    H->>D: query range mode/select, h/fs, metadata
    alt range mode off
        H-->>R: blocked current-path-off (no publish)
    end
    H->>D: publish h/fs, range mode/select, signal ctrl (physical pending)
    D->>M: settings
    M-->>D: i, v, p, range, gpi streams
    D-->>H: messages with sample_id (skips = gaps, NaN = missing)
    R-->>H: stop file (Stop/timeout) or @/!remove
    H->>D: signals off, restore previous settings, read back
    H-->>R: state.json released + confirmed | unknown
    H->>H: write result.json + samples.csv
```

## State

```mermaid
stateDiagram-v2
    [*] --> start
    start --> identified: device present, model ok
    start --> blocked: missing / profile / path off
    identified --> acting: first publish (physical pending)
    acting --> cleaning: duration reached / stop / removal / stall
    cleaning --> released: readback == previous (confirmed)
    cleaning --> released: device gone or readback differs (unknown)
    released --> [*]
    blocked --> [*]
```

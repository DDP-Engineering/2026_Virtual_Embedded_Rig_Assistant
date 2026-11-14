# TASK-0bc542d8 diagrams

Illustrates `## Design` in `TASK-0bc542d8.md`. The Design text is authoritative.

Node map: added - circuitpython plugin.yaml, circuitpython_tool.py, cli, volumes, ports, inspection, bundle, deploy,
console, report + workspace, skills, fake-serial console, fixture bundle builder; changed - ProgramRunner (volume
claims); unchanged - approval gate, ResourceLeases, provisioner/uv, circup 3.1.0, pyserial 3.5, GitHub releases.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    agent["agent run_program"] --> gate["approval gate (files hashed: --source, --libraries, --expect-from)"]
    gate --> runner["ProgramRunner serial + volume claims"]:::changed
    runner --> leases[("ResourceLeases folder")]
    prov["provisioner / uv"] --> manifest["circuitpython plugin.yaml"]:::added
    runner --> tool["circuitpython_tool.py"]:::added
    tool --> cli["cli"]:::added
    cli --> volumes["volumes"]:::added
    cli --> ports["ports"]:::added
    cli --> inspection["inspection"]:::added
    cli --> bundle["bundle"]:::added
    cli --> deploy["deploy"]:::added
    cli --> console["console"]:::added
    cli --> report["report + workspace"]:::added
    bundle --> circup["circup 3.1.0 conventions"]
    inspection --> circup
    bundle --> github["GitHub release assets (pinned tag)"]
    bundle --> cache[("~/.vera-circuitpython/bundles")]
    bundle --> set[("run folder: library-set.json + libraries/")]
    deploy --> set
    volumes --> drive[("CIRCUITPY drive")]
    deploy --> drive
    console --> serialport["pyserial port"]
    serialport --> board["CircuitPython board"]
    drive --> board
```

## Sequence

```mermaid
sequenceDiagram
    participant A as agent
    participant V as VERA gate + runner
    participant T as circuitpython-tool
    participant G as GitHub release
    participant D as CIRCUITPY drive
    participant S as serial console
    A->>V: prepare-libraries --library X --circuitpython 9 --bundle-tag T
    V->>T: run (device-write: network)
    T->>G: py and 9.x-mpy zips of tag T (unless cached, hash verified)
    T-->>A: library-set.json (file hashes)
    A->>V: deploy --volume E: --identity K --libraries set --source code.py --target /code.py --capture 10 --port COM7
    V->>V: bind file hashes, lease volume:E: and serial:COM7
    V->>T: run
    T->>D: list volumes, boot_out.txt, checks (selection, firmware, set, space, read-only)
    T->>S: open port before writes
    loop each file (libraries, then code)
        T->>D: write .vera-part, read back, replace, read back
    end
    D-->>S: firmware autoreloads code.py
    S-->>T: console: code.py output, traceback or done
    T-->>A: result (files confirmed, run verdict, autoreload)
```

## State

```mermaid
stateDiagram-v2
    [*] --> unconfirmed
    unconfirmed --> confirmed: part written, read back, replaced, read back
    unconfirmed --> failed: hash-mismatch / conflict / no-space / read-only / write-failed
    unconfirmed --> unconfirmed: helper stopped or volume gone (result incomplete)
    confirmed --> [*]
    failed --> [*]
```

# TASK-06f52fc5 diagrams

Illustrates `## Design` in `TASK-06f52fc5.md`. The Design text is authoritative.

Node map: added - bus-tools plugin.yaml, bus_tool.py, cli, profile, registry, ports, adapter + bpio + cobs,
operations, lifecycle, report + workspace, skills, fake-serial Bus Pirate; changed - lab-resources.ts (kind
bus-adapter), scpi registry reader; unchanged - approval gate, resource-registry.ts, ProgramRunner, ResourceLeases,
provisioner/uv, flatbuffers 25.12.19, pyserial 3.5.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    agent["agent run_program"] --> gate["approval gate (--bus hashed, registry hashed)"]
    gate --> claims["resource-registry claimedResources"]
    claims --> kinds["lab-resources.ts bus-adapter keys"]:::changed
    gate --> runner["ProgramRunner leases + supervision"]
    runner --> leases[("ResourceLeases folder")]
    runner --> tool["bus_tool.py"]:::added
    runner -.cleanup release.-> tool
    tool --> cli["cli"]:::added
    cli --> registry["registry"]:::added
    cli --> profile["profile"]:::added
    cli --> ports["ports"]:::added
    cli --> ops["operations"]:::added
    ops --> adapter["adapter + bpio + cobs"]:::added
    ops --> life["lifecycle (state.json, stop)"]:::added
    cli --> report["report + workspace"]:::added
    registry --> file[("lab/resources.json")]
    scpi["scpi registry reader"]:::changed --> file
    adapter --> fb["flatbuffers 25.12.19"]
    adapter --> serial["pyserial 3.5 binary port"]
    serial --> bp["Bus Pirate 5/6 BPIO2"]
    bp --> dut["DUT: I2C / SPI / UART"]
```

## Sequence

```mermaid
sequenceDiagram
    participant A as agent
    participant R as ProgramRunner
    participant T as bus-tool
    participant B as Bus Pirate (BPIO2)
    A->>R: read-register --adapter bp --bus bme280.bus.json (approved)
    R->>R: lease serial:COM35, serial:COM34, usb:... (BUSY if held)
    R->>T: spawn with BUS_REGISTRY, VERA_REGISTRY_SHA256, VERA_RUN_CONTROL
    T->>T: registry hash, profile, register, ports + identity
    T->>B: StatusRequest
    B-->>T: StatusResponse (hardware 5, BPIO 2.x)
    T->>B: ConfigurationRequest I2C, pull-ups, psu off
    T->>B: StatusRequest (read-back)
    T->>B: DataRequest [0xEC, 0xD0], read 1
    B-->>T: DataResponse 0x60 (or error NACK, once)
    T->>B: ConfigurationRequest HiZ, pull-ups off, psu off
    T->>B: StatusRequest (read-back)
    T-->>R: exit 0, state.json released/confirmed
    R->>R: release leases (cleanup run only if not released/confirmed)
```

## State

```mermaid
stateDiagram-v2
    [*] --> start
    start --> identified: status reply supported
    start --> released: blocked before any request (physical unchanged)
    identified --> acting: configuration sent (physical pending)
    identified --> released: identify done (unchanged)
    acting --> cleaning: transaction done, failed, stopped or no reply
    cleaning --> released: final state read back (confirmed)
    cleaning --> released: no read-back (unknown)
    acting --> released: port lost (unknown)
    released --> [*]
```

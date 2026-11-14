# TASK-6b092dfc diagrams

Illustrates `## Design` in `TASK-6b092dfc.md`. The Design text is authoritative.

Node classes: added - gdb-debug package (gdb-elf and gdb-debug helpers, gdb_support modules, profiles); changed -
shared lab-resources (kind probe), scpi registry reader (skips probe entries); unchanged - program-tools /
resource-registry, ProgramRunner and ResourceLeases, the user's GDB and OpenOCD.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    reg[("lab/resources.json")] --> labres["shared lab-resources (kind probe)"]:::changed
    labres --> tools["program-tools / resource-registry"]
    tools --> runner["ProgramRunner + ResourceLeases"]
    runner --> elfh["gdb-elf helper"]:::added
    runner --> dbgh["gdb-debug helper"]:::added
    dbgh --> support["gdb_support: mi, session, openocd, operations"]:::added
    elfh --> elfmod["gdb_support: elf, dwarf, symbols, faults"]:::added
    dbgh --> elfmod
    support --> ocd["OpenOCD (user install)"]
    support --> gdb["arm-none-eabi-gdb (user install)"]
    gdb --> ocd
    ocd --> probe["probe + target"]
    reg --> scpi["scpi registry reader"]:::changed
    support --> results[("embedded-lab-results/run-id")]
```

## Sequence

```mermaid
sequenceDiagram
    participant R as ProgramRunner
    participant H as gdb-debug helper
    participant O as OpenOCD
    participant G as GDB (MI)
    participant T as Target
    R->>H: spawn (lease held, VERA_RUN_CONTROL)
    H->>H: validate options, registry, profile, ELF
    H->>O: start (profile scripts, adapter serial, 127.0.0.1:p, telnet/tcl off)
    O-->>H: Listening on port p
    H->>G: start -nx, auto-load off (pipes)
    H->>G: architecture, symbols, mem regions
    H->>G: target-select remote 127.0.0.1:p
    G->>O: connect
    O->>T: halt (gdb-attach event)
    H->>G: CPUID, compare-sections, registers, frames, fault registers
    G-->>H: results with matching tokens, async stops as events
    H->>G: target-detach, gdb-exit
    G->>O: disconnect
    O->>T: halt or resume (gdb-detach event)
    O-->>H: VERA-DETACH halted or running
    H->>O: terminate
    H-->>R: result.json, exit code
```

## State

```mermaid
stateDiagram-v2
    [*] --> validating
    validating --> refused: bad option, ELF or profile
    validating --> starting
    starting --> failed: OpenOCD or GDB not ready
    starting --> connected: target-select connected, core halted
    connected --> blocked: CPUID or architecture mismatch
    connected --> acting
    acting --> running: continue or step
    running --> halted: requested stop
    running --> halted: timeout or Stop then interrupt
    running --> unknown: MI timeout
    running --> disconnected: remote error or GDB exit
    halted --> acting
    acting --> detaching: done
    blocked --> detaching
    unknown --> detaching
    disconnected --> detaching
    failed --> detaching
    detaching --> released: marker confirms policy state
    detaching --> released: no marker, physical unknown
    released --> [*]
    refused --> [*]
```

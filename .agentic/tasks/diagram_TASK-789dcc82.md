# TASK-789dcc82 diagrams

Illustrates `## Design` in `TASK-789dcc82.md`. The Design text is authoritative.

Node classes: added - shared hil-plan schema, core hil compile/adapters/executor/result, hil-testing package (helper
report, skill); changed - plugin manifest schema (program.plan), program-tools (plan hand-off), program-request (plan
field), ProgramRunner (hold, parent), ResourceLeases (parent borrow); unchanged - ApprovalGate, approval card / CLI
prompt, probe-rs, serial-monitor, scpi-instruments and lab-validation plugins, ProcessHost.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    plan[("hil/*.json plan")] --> schema["shared hil-plan.ts"]:::added
    manifest["plugins.ts: program.plan"]:::changed --> tools
    tools["program-tools (plan hand-off)"]:::changed --> compile["hil/compile + adapters"]:::added
    schema --> compile
    compile --> req["program-request (plan field)"]:::changed
    req --> gate["ApprovalGate"]
    gate --> card["approval card / CLI prompt"]
    tools --> exec["hil/executor + result"]:::added
    exec --> runner["ProgramRunner (hold, parent)"]:::changed
    runner --> leases["ResourceLeases (parent borrow)"]:::changed
    runner --> host["ProcessHost"]
    host --> progs["probe-rs / esptool / serial / scpi / lab-validate"]
    host --> helper["hil report helper"]:::added
    exec --> results[("embedded-lab-results/<run-id>")]
    helper --> results
```

## Sequence

```mermaid
sequenceDiagram
    participant A as Agent
    participant T as program-tools
    participant C as hil compile
    participant G as ApprovalGate
    participant E as hil executor
    participant R as ProgramRunner
    A->>T: run_program hil run hil/plan.json
    T->>C: compile(plan, runId)
    C-->>T: expansion + requests per operation
    T->>G: one run_program request (max risk, notes, plan)
    G-->>T: approved
    T->>C: compile again (same runId)
    T->>G: consume (CONFLICT if changed)
    T->>E: execute
    E->>R: hold(plan claims) -> plan run + leases
    loop each step / attempt
        E->>R: start(child, parent=plan) after re-hash
        R-->>E: RunResult (exit, physical)
    end
    E->>R: cleanup steps, then release
    E->>R: hil report --run folder
    E-->>A: summary, exit code, physical
```

## State

```mermaid
stateDiagram-v2
    [*] --> prepared: compile ok
    prepared --> awaitingApproval: approval asked
    awaitingApproval --> [*]: denied / CONFLICT
    awaitingApproval --> running: consumed
    running --> cleaningUp: steps done / stop / budget / error / blocked
    cleaningUp --> done: cleanup steps ran, lease released
    done --> [*]: status pass, fail, blocked, error or incomplete
```

# TASK-a31dbad3 diagrams

Illustrates `## Design` in `TASK-a31dbad3.md`. The Design text is authoritative.

Node classes from the Design: added - raspberry-pi-linux plugin.yaml, pi-tool (cli, ssh, remote, operations), the
remote helper and its supervisor; changed - lab-resources.ts (kind linux-board), plugins.ts (sshAgent), program-tools.ts
(refusal and inherit), runner.ts (RunRequest.inherit), scpi registry.py (skips linux-board); unchanged - the lease
registry, the system SSH agent, sshd, systemd.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    manifest["raspberry-pi-linux plugin.yaml"]:::added
    schema["shared plugins.ts sshAgent"]:::changed
    labres["shared lab-resources.ts linux-board"]:::changed
    tools["core program-tools.ts"]:::changed
    runner["core runner.ts inherit"]:::changed
    leases["core leases.ts ResourceLeases"]
    scpi["scpi_support/registry.py"]:::changed
    cli["pi_support/cli.py"]:::added
    ops["pi_support/operations.py"]:::added
    ssh["pi_support/ssh.py"]:::added
    stubs["pi_support/remote.py"]:::added
    agent[("system SSH agent")]
    sshd["board sshd"]
    helper["remote/vera_pi_remote.py"]:::added
    supervisor["supervise()"]:::added
    systemd["systemctl --user / journalctl"]
    manifest --> schema
    manifest --> labres
    tools --> runner
    tools --> labres
    runner --> leases
    runner -- "SSH_AUTH_SOCK" --> cli
    scpi -.-> labres
    cli --> ops
    ops --> ssh
    ssh --> stubs
    ssh -- "sign" --> agent
    ssh -- "pinned host key, two constant commands" --> sshd
    sshd --> helper
    helper --> supervisor
    helper --> systemd
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent as agent
    participant VERA as program-tools and runner
    participant Tool as pi-tool
    participant SSHD as board sshd
    participant Helper as vera_pi_remote.py
    participant Sup as supervisor
    Agent->>VERA: run_program pi-tool run-task --board pi
    VERA->>VERA: approval, board lease, SSH_AUTH_SOCK
    VERA->>Tool: start with VERA_RUN_CONTROL
    Tool->>SSHD: connect, host key pinned, agent key
    Tool->>SSHD: run stub (request on stdin)
    SSHD->>Helper: sh -c constant command
    Helper->>Sup: start detached supervisor
    Sup->>Sup: task in own process group, budget, limit
    loop until final or stop
        Tool->>Helper: task-wait
    end
    VERA-->>Tool: stop file (Stop)
    Tool->>Helper: task-stop
    Helper->>Sup: stop file
    Sup-->>Helper: final status stopped
    Helper-->>Tool: confirmed
    Tool-->>VERA: released, physical confirmed
```

## State

```mermaid
stateDiagram-v2
    [*] --> starting
    starting --> running: supervisor started the task
    starting --> start_failed: exec failed
    running --> exited: task ended
    running --> budget_exceeded: budget passed
    running --> output_limit: output over the limit
    running --> stopped: stop file
    running --> supervisor_lost: supervisor gone, task gone
    running --> lost_by_reboot: boot id changed
    exited --> [*]
    budget_exceeded --> [*]
    output_limit --> [*]
    stopped --> [*]
    start_failed --> [*]
    supervisor_lost --> [*]
    lost_by_reboot --> [*]
```

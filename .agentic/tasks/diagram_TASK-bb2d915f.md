# TASK-bb2d915f diagrams

Illustrates `## Design` in `TASK-bb2d915f.md`. The Design text is authoritative.

Node map: added = tshark-options, wireshark-tshark package, fixture, integration test;
changed = plugins.ts schema (enum), program-rules classifyCommand (dispatch), catalog/packs;
unchanged = program-request, program-tools, Provisioner, ApprovalGate, ProgramRunner.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    pkg["plugins/wireshark-tshark<br/>plugin.yaml + skills"]:::added
    catalog["catalog.yaml / packs.yaml"]:::changed
    schema["shared plugins.ts<br/>optionSyntax enum"]:::changed
    rules["shared program-rules<br/>classifyCommand"]:::changed
    proj["shared tshark-options<br/>tsharkRuleArguments"]:::added
    request["core program-request"]
    tools["core program-tools"]
    prov["core Provisioner (find + hint)"]
    runner["ProgramRunner"]
    fixture["fixtures/wireshark-tshark<br/>sample.pcapng"]:::added
    test["integration wireshark-tshark.test"]:::added
    pkg --> schema
    catalog --> pkg
    request --> rules
    tools --> rules
    rules --> proj
    prov --> pkg
    tools --> runner
    test --> fixture
    test --> request
```

## Sequence

```mermaid
sequenceDiagram
    participant Agent as Agent (replay)
    participant Tools as run_program
    participant Rules as classifyCommand
    participant Proj as tsharkRuleArguments
    participant Gate as ApprovalGate
    participant Runner as ProgramRunner / tshark
    Agent->>Tools: tshark -r sample.pcapng -Y coap ...
    Tools->>Rules: rules, args, optionSyntax tshark
    Rules->>Proj: raw argv
    Proj-->>Rules: [<file>]
    Rules-->>Tools: safe
    Tools->>Runner: raw argv (no approval)
    Runner-->>Agent: real tshark output
    Agent->>Tools: tshark -i 1 -c 5
    Tools->>Rules: classify
    Rules-->>Tools: device-read
    Tools->>Gate: wait for user (ask)
    Gate-->>Tools: denied, no process
```

## State

Not drawn: the change adds no lifecycle or status field; program states reuse the existing provisioner states.

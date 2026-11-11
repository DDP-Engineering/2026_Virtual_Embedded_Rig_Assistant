# TASK-46fcedc2 diagrams

Illustrates `## Design` in `TASK-46fcedc2.md`. The Design text is authoritative.

Node map: added = microchip-pymcuprog package, pymcuprog-options projection, fixture, test; changed = plugins.ts enum,
classifyCommand dispatch, catalog/packs; unchanged = Provisioner, ApprovalGate, ProgramRunner.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    pkg["plugins/microchip-pymcuprog<br/>plugin.yaml + skills"]:::added
    catalog["catalog.yaml / packs.yaml"]:::changed
    schema["shared plugins.ts<br/>optionSyntax enum"]:::changed
    rules["shared program-rules<br/>classifyCommand"]:::changed
    proj["shared pymcuprog-options<br/>pymcuprogRuleArguments"]:::added
    prov["Provisioner (pip via uv)"]
    gate["ApprovalGate"]
    test["integration microchip-pymcuprog.test"]:::added
    catalog --> pkg
    pkg --> schema
    rules --> proj
    gate --> rules
    prov --> pkg
    test --> gate
```

## Sequence

Not drawn: the flow is the existing run_program path (classify, gate, runner) shown for PLG-15 and PLG-14.

## State

Not drawn: no new lifecycle.
